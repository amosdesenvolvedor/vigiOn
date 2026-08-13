import { Prisma, type PrismaClient } from '@prisma/client';
import type Stripe from 'stripe';
import { env } from '../../config/env';
import { AuthError } from '../auth/auth.errors';
import type { TenantContext } from '../tenancy/tenant-context';
import {
  mapStripeSubscriptionStatus,
  stripePlanForPrice,
  stripePriceFor,
  type PaidPlanCode,
} from './stripe.provider';
import type { PaymentProvider } from './payment-provider';

const unix = (seconds: number) => new Date(seconds * 1000);
export class StripeBillingService {
  constructor(
    private prisma: PrismaClient,
    private provider: PaymentProvider,
  ) {}
  configuration() {
    return { enabled: this.provider.available, provider: 'STRIPE', mode: env.BILLING_ENVIRONMENT };
  }
  async history(organizationId: string) {
    const [payments, invoices] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          status: true,
          amountCents: true,
          currency: true,
          paymentMethod: true,
          createdAt: true,
        },
      }),
      this.prisma.invoice.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, status: true, amountCents: true, currency: true, createdAt: true },
      }),
    ]);
    return { payments, invoices };
  }
  reconcileExpiredCheckouts() {
    return this.prisma.billingCheckoutSession.updateMany({
      where: { provider: 'STRIPE', status: 'PENDING', expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRED' },
    });
  }
  async customer(organizationId: string, userId: string) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      include: { users: { where: { id: userId }, take: 1 } },
    });
    if (organization.stripeCustomerId) return organization.stripeCustomerId;
    const owner = organization.users[0];
    if (!owner) throw new AuthError(403, 'OWNER_NOT_FOUND', 'Owner not found');
    const created = await this.provider.createCustomer({
      organizationId,
      ownerId: userId,
      email: owner.email,
      name: organization.name,
    });
    const claimed = await this.prisma.organization.updateMany({
      where: { id: organizationId, stripeCustomerId: null },
      data: { stripeCustomerId: created.id },
    });
    if (claimed.count)
      console.info(
        JSON.stringify({
          event: 'stripe.customer.created',
          organizationId,
          stripeCustomerId: created.id,
        }),
      );
    return (await this.prisma.organization.findUniqueOrThrow({ where: { id: organizationId } }))
      .stripeCustomerId!;
  }
  async checkout(context: TenantContext, plan: PaidPlanCode, key: string) {
    if (!this.provider.available)
      throw new AuthError(503, 'BILLING_DISABLED', 'Billing is not available');
    const priceId = stripePriceFor(plan);
    if (!priceId) throw new AuthError(503, 'STRIPE_PRICE_MISSING', 'Plan price is not configured');
    const planRecord = await this.prisma.plan.findFirst({
      where: { code: plan, status: 'ACTIVE', isPublic: true },
      orderBy: { version: 'desc' },
    });
    if (!planRecord) throw new AuthError(404, 'PLAN_NOT_AVAILABLE', 'Plan is not available');
    const existing = await this.prisma.billingCheckoutSession.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: context.organizationId,
          idempotencyKey: key,
        },
      },
    });
    if (existing) return existing;
    const customerId = await this.customer(context.organizationId, context.userId);
    const session = await this.provider.createCheckout({
      customerId,
      priceId,
      organizationId: context.organizationId,
      plan,
      idempotencyKey: key,
    });
    const local = await this.prisma.billingCheckoutSession.create({
      data: {
        organizationId: context.organizationId,
        planId: planRecord.id,
        requestedById: context.userId,
        provider: 'STRIPE',
        providerCheckoutId: session.id,
        idempotencyKey: key,
        amountCents: planRecord.priceCents!,
        currency: planRecord.currency,
        checkoutUrl: session.url,
        expiresAt: unix(session.expires_at),
      },
    });
    console.info(
      JSON.stringify({
        event: 'stripe.checkout.created',
        organizationId: context.organizationId,
        checkoutSessionId: session.id,
      }),
    );
    return local;
  }
  async portal(context: TenantContext) {
    const organization = await this.prisma.organization.findUniqueOrThrow({
      where: { id: context.organizationId },
    });
    if (!organization.stripeCustomerId)
      throw new AuthError(409, 'STRIPE_CUSTOMER_MISSING', 'Billing portal is not available');
    return this.provider.portal(organization.stripeCustomerId);
  }
  async cancel(context: TenantContext) {
    const subscription = await this.current(context.organizationId);
    if (!subscription.providerSubscriptionId)
      throw new AuthError(409, 'STRIPE_SUBSCRIPTION_MISSING', 'Paid subscription is not available');
    await this.provider.cancelAtPeriodEnd(subscription.providerSubscriptionId);
    return this.prisma.subscription.update({
      where: { id: subscription.id },
      data: { cancelAtPeriodEnd: true },
    });
  }
  async change(context: TenantContext, plan: PaidPlanCode) {
    const subscription = await this.current(context.organizationId);
    const priceId = stripePriceFor(plan);
    if (!subscription.providerSubscriptionId || !priceId)
      throw new AuthError(409, 'STRIPE_SUBSCRIPTION_MISSING', 'Paid subscription is not available');
    const remote = await this.provider.retrieveSubscription(subscription.providerSubscriptionId);
    const item = remote.items.data[0];
    if (!item)
      throw new AuthError(409, 'STRIPE_ITEM_MISSING', 'Subscription item is not available');
    const target = await this.prisma.plan.findFirstOrThrow({
      where: { code: plan, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    await this.provider.changePlan(
      remote.id,
      item.id,
      priceId,
      target.priceCents! < subscription.plan.priceCents!,
    );
    return { pending: true };
  }
  async webhook(event: Stripe.Event) {
    const inserted = await this.prisma.billingWebhookEvent.createMany({
      data: [{ provider: 'STRIPE', providerEventId: event.id, type: event.type }],
      skipDuplicates: true,
    });
    if (!inserted.count) return { duplicate: true };
    try {
      if (
        event.type === 'customer.subscription.created' ||
        event.type === 'customer.subscription.updated' ||
        event.type === 'customer.subscription.deleted'
      )
        await this.syncSubscription(
          event.data.object as Stripe.Subscription,
          event.type === 'customer.subscription.deleted',
        );
      else if (event.type === 'checkout.session.completed')
        await this.checkoutCompleted(event.data.object as Stripe.Checkout.Session);
      else if (event.type === 'invoice.paid' || event.type === 'invoice.payment_failed')
        await this.syncInvoice(event.data.object as Stripe.Invoice, event.type === 'invoice.paid');
      else {
        await this.mark(event.id, 'IGNORED');
        return { ignored: true };
      }
      await this.mark(event.id, 'PROCESSED');
      console.info(
        JSON.stringify({
          event: 'stripe.webhook.processed',
          stripeEventId: event.id,
          type: event.type,
        }),
      );
      return { processed: true };
    } catch (error) {
      await this.prisma.billingWebhookEvent.update({
        where: { provider_providerEventId: { provider: 'STRIPE', providerEventId: event.id } },
        data: {
          status: 'FAILED',
          errorCode: error instanceof Error ? error.name.slice(0, 64) : 'FAILED',
        },
      });
      throw error;
    }
  }
  private current(organizationId: string) {
    return this.prisma.subscription.findFirstOrThrow({
      where: { organizationId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
  }
  private mark(id: string, status: 'PROCESSED' | 'IGNORED') {
    return this.prisma.billingWebhookEvent.update({
      where: { provider_providerEventId: { provider: 'STRIPE', providerEventId: id } },
      data: { status, processedAt: new Date() },
    });
  }
  private async checkoutCompleted(session: Stripe.Checkout.Session) {
    const organizationId = session.metadata?.organizationId;
    const customerId =
      typeof session.customer === 'string' ? session.customer : session.customer?.id;
    if (!organizationId || !customerId || typeof session.subscription !== 'string')
      throw new Error('INVALID_CHECKOUT_METADATA');
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization || organization.stripeCustomerId !== customerId)
      throw new Error('STRIPE_CUSTOMER_TENANT_MISMATCH');
    await this.prisma.billingCheckoutSession.updateMany({
      where: { providerCheckoutId: session.id, organizationId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });
  }
  private async syncSubscription(remote: Stripe.Subscription, deleted: boolean) {
    const organizationId = remote.metadata.organizationId;
    const customerId = typeof remote.customer === 'string' ? remote.customer : remote.customer.id;
    const priceId = remote.items.data[0]?.price.id;
    const planCode = priceId ? stripePlanForPrice(priceId) : undefined;
    if (!organizationId || !priceId || !planCode) throw new Error('INVALID_SUBSCRIPTION_MAPPING');
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!organization || organization.stripeCustomerId !== customerId)
      throw new Error('STRIPE_CUSTOMER_TENANT_MISMATCH');
    const plan = await this.prisma.plan.findFirstOrThrow({
      where: { code: planCode, status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    const status = deleted ? 'CANCELED' : mapStripeSubscriptionStatus(remote.status);
    const start = unix(remote.items.data[0]!.current_period_start);
    const end = unix(remote.items.data[0]!.current_period_end);
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.subscription.findUnique({
        where: { providerSubscriptionId: remote.id },
      });
      if (existing && existing.organizationId !== organizationId)
        throw new Error('STRIPE_SUBSCRIPTION_TENANT_MISMATCH');
      const record = existing
        ? await tx.subscription.update({
            where: { id: existing.id },
            data: {
              planId: plan.id,
              status,
              stripePriceId: priceId,
              currentPeriodStart: start,
              currentPeriodEnd: end,
              cancelAtPeriodEnd: remote.cancel_at_period_end,
              canceledAt: remote.canceled_at ? unix(remote.canceled_at) : null,
              endedAt: remote.ended_at ? unix(remote.ended_at) : null,
            },
          })
        : await tx.subscription.create({
            data: {
              organizationId,
              planId: plan.id,
              billingProvider: 'STRIPE',
              providerSubscriptionId: remote.id,
              stripePriceId: priceId,
              status,
              currentPeriodStart: start,
              currentPeriodEnd: end,
              cancelAtPeriodEnd: remote.cancel_at_period_end,
            },
          });
      await tx.subscriptionHistory.create({
        data: {
          organizationId,
          subscriptionId: record.id,
          planId: plan.id,
          planCode: plan.code,
          planVersion: plan.version,
          status,
          reason: 'STRIPE_SYNC',
          limitsSnapshot: {
            maxCameras: plan.maxCameras,
            maxStorageBytes: plan.maxStorageBytes.toString(),
            retentionDays: plan.retentionDays,
            maxUsers: plan.maxUsers,
          },
          featuresSnapshot: plan.enabledFeatures as Prisma.InputJsonValue,
          periodStart: start,
          periodEnd: end,
        },
      });
      if (deleted) {
        const free = await tx.plan.findFirstOrThrow({
          where: { code: 'FREE', status: 'ACTIVE' },
          orderBy: { version: 'desc' },
        });
        const now = new Date();
        const freeEnd = new Date(now.getTime() + 30 * 86_400_000);
        const fallback = await tx.subscription.create({
          data: {
            organizationId,
            planId: free.id,
            status: 'ACTIVE',
            currentPeriodStart: now,
            currentPeriodEnd: freeEnd,
          },
        });
        await tx.subscriptionHistory.create({
          data: {
            organizationId,
            subscriptionId: fallback.id,
            planId: free.id,
            planCode: free.code,
            planVersion: free.version,
            status: 'ACTIVE',
            reason: 'STRIPE_ENDED_FREE',
            limitsSnapshot: {
              maxCameras: free.maxCameras,
              maxStorageBytes: free.maxStorageBytes.toString(),
              retentionDays: free.retentionDays,
              maxUsers: free.maxUsers,
            },
            featuresSnapshot: free.enabledFeatures as Prisma.InputJsonValue,
            periodStart: now,
            periodEnd: freeEnd,
          },
        });
      }
    });
  }
  private async syncInvoice(invoice: Stripe.Invoice, paid: boolean) {
    const invoiceId = invoice.id;
    if (!invoiceId) throw new Error('INVALID_INVOICE_ID');
    const subscriptionId =
      typeof invoice.parent?.subscription_details?.subscription === 'string'
        ? invoice.parent.subscription_details.subscription
        : null;
    if (!subscriptionId) return;
    const subscription = await this.prisma.subscription.findUnique({
      where: { providerSubscriptionId: subscriptionId },
    });
    if (!subscription) return;
    await this.prisma.invoice.upsert({
      where: { providerInvoiceId: invoiceId },
      create: {
        organizationId: subscription.organizationId,
        subscriptionId: subscription.id,
        provider: 'STRIPE',
        providerInvoiceId: invoiceId,
        status: paid ? 'PAID' : 'OPEN',
        amountCents: invoice.amount_due,
        currency: invoice.currency.toUpperCase(),
        periodStart: unix(invoice.period_start),
        periodEnd: unix(invoice.period_end),
        paidAt: paid ? new Date() : null,
      },
      update: { status: paid ? 'PAID' : 'OPEN', paidAt: paid ? new Date() : null },
    });
    await this.prisma.payment.upsert({
      where: { providerPaymentId: invoiceId },
      create: {
        organizationId: subscription.organizationId,
        subscriptionId: subscription.id,
        provider: 'STRIPE',
        providerPaymentId: invoiceId,
        status: paid ? 'PAID' : 'FAILED',
        amountCents: invoice.amount_due,
        currency: invoice.currency.toUpperCase(),
        paymentMethod: 'CARD',
        paidAt: paid ? new Date() : null,
        failedAt: paid ? null : new Date(),
      },
      update: {
        status: paid ? 'PAID' : 'FAILED',
        paidAt: paid ? new Date() : null,
        failedAt: paid ? null : new Date(),
      },
    });
    if (!paid)
      await this.prisma.subscription.update({
        where: { id: subscription.id },
        data: { status: 'PAST_DUE' },
      });
  }
}
