import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type SubscriptionStatus } from '@prisma/client';
import { env } from '../../config/env';
import { AuthError } from '../auth/auth.errors';
import type { RequestMetadata } from '../auth/auth.types';
import type { TenantContext } from '../tenancy/tenant-context';
import type { PaymentProvider, ProviderPayment } from './payment-provider';

const transitionMatrix: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  TRIALING: ['ACTIVE', 'CANCELED', 'EXPIRED'],
  ACTIVE: ['PAST_DUE', 'CANCELED', 'EXPIRED'],
  PAST_DUE: ['ACTIVE', 'CANCELED', 'EXPIRED', 'SUSPENDED'],
  CANCELED: ['ACTIVE', 'EXPIRED'],
  EXPIRED: [],
  SUSPENDED: ['ACTIVE', 'CANCELED', 'EXPIRED'],
};
export const assertSubscriptionTransition = (from: SubscriptionStatus, to: SubscriptionStatus) => {
  if (!transitionMatrix[from].includes(to))
    throw new AuthError(
      409,
      'INVALID_SUBSCRIPTION_TRANSITION',
      `Cannot transition ${from} to ${to}`,
    );
};
const page = (current: number, limit: number, total: number) => ({
  page: current,
  limit,
  total,
  pages: Math.ceil(total / limit),
});

export class BillingPaymentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: PaymentProvider,
  ) {}

  configuration() {
    return {
      enabled: this.provider.available,
      provider: 'MERCADO_PAGO',
      environment: env.BILLING_ENVIRONMENT,
    };
  }

  async checkout(
    context: TenantContext,
    planId: string,
    idempotencyKey: string,
    metadata: RequestMetadata,
  ) {
    if (!this.provider.available)
      throw new AuthError(503, 'BILLING_DISABLED', 'Billing is not available');
    const plan = await this.prisma.plan.findFirst({
      where: { id: planId, status: 'ACTIVE', isPublic: true },
    });
    if (!plan) throw new AuthError(404, 'PLAN_NOT_AVAILABLE', 'Plan is not available');
    if (plan.code === 'FREE' || !plan.priceCents || plan.priceCents <= 0)
      throw new AuthError(409, 'PLAN_NOT_BILLABLE', 'Plan is not available for checkout');
    if (plan.currency !== 'BRL' || plan.billingInterval !== 'MONTHLY')
      throw new AuthError(409, 'PRICE_NOT_SUPPORTED', 'Price configuration is not supported');
    const existing = await this.prisma.billingCheckoutSession.findUnique({
      where: {
        organizationId_idempotencyKey: { organizationId: context.organizationId, idempotencyKey },
      },
    });
    if (existing) return existing;
    const pending = await this.prisma.billingCheckoutSession.findFirst({
      where: {
        organizationId: context.organizationId,
        planId,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) return pending;
    const current = await this.prisma.subscription.findFirst({
      where: { organizationId: context.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    const id = randomUUID();
    await this.prisma.billingCheckoutSession.create({
      data: {
        id,
        organizationId: context.organizationId,
        subscriptionId: current?.id ?? null,
        planId: plan.id,
        requestedById: context.userId,
        idempotencyKey,
        amountCents: plan.priceCents,
        currency: plan.currency,
        expiresAt: new Date(Date.now() + 30 * 60_000),
      },
    });
    try {
      const owner = await this.prisma.user.findUniqueOrThrow({
        where: { id: context.userId },
        select: { email: true },
      });
      const result = await this.provider.createCheckout({
        reference: id,
        title: `VigiOn ${plan.name}`,
        amountCents: plan.priceCents,
        currency: plan.currency,
        payerEmail: owner.email,
        idempotencyKey,
      });
      return await this.prisma.$transaction(async (tx) => {
        const session = await tx.billingCheckoutSession.update({
          where: { id },
          data: {
            providerCheckoutId: result.providerCheckoutId,
            checkoutUrl: result.checkoutUrl,
            expiresAt: result.expiresAt,
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.userId,
            action: 'BILLING_CHECKOUT_STARTED',
            entityType: 'BillingCheckoutSession',
            entityId: id,
            metadata: {
              planId: plan.id,
              amountCents: plan.priceCents,
              currency: plan.currency,
              ...metadata,
            },
          },
        });
        return session;
      });
    } catch (error) {
      await this.prisma.billingCheckoutSession.update({
        where: { id },
        data: {
          status: 'FAILED',
          errorCode: error instanceof Error ? error.message.slice(0, 64) : 'PROVIDER_ERROR',
        },
      });
      throw error;
    }
  }

  async history(organizationId: string, currentPage: number, limit: number) {
    const where = { organizationId };
    const [payments, paymentTotal, invoices, invoiceTotal] = await this.prisma.$transaction([
      this.prisma.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (currentPage - 1) * limit,
        take: limit,
        select: {
          id: true,
          status: true,
          amountCents: true,
          currency: true,
          paymentMethod: true,
          paidAt: true,
          createdAt: true,
          description: true,
        },
      }),
      this.prisma.payment.count({ where }),
      this.prisma.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (currentPage - 1) * limit,
        take: limit,
        select: {
          id: true,
          status: true,
          amountCents: true,
          currency: true,
          periodStart: true,
          periodEnd: true,
          dueAt: true,
          paidAt: true,
          createdAt: true,
        },
      }),
      this.prisma.invoice.count({ where }),
    ]);
    return {
      payments,
      invoices,
      pagination: {
        payments: page(currentPage, limit, paymentTotal),
        invoices: page(currentPage, limit, invoiceTotal),
      },
    };
  }

  checkoutStatus(organizationId: string, id: string) {
    return this.prisma.billingCheckoutSession.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        status: true,
        amountCents: true,
        currency: true,
        checkoutUrl: true,
        expiresAt: true,
        completedAt: true,
        plan: { select: { id: true, name: true, code: true } },
      },
    });
  }

  reconcileExpiredCheckouts() {
    return this.prisma.billingCheckoutSession.updateMany({
      where: { status: 'PENDING', expiresAt: { lte: new Date() } },
      data: { status: 'EXPIRED' },
    });
  }

  async receiveWebhook(input: { eventId: string; type: string; resourceId: string }) {
    const inserted = await this.prisma.billingWebhookEvent.createMany({
      data: [
        {
          provider: 'MERCADO_PAGO',
          providerEventId: input.eventId,
          type: input.type.slice(0, 100),
          resourceId: input.resourceId,
        },
      ],
      skipDuplicates: true,
    });
    if (!inserted.count) return { duplicate: true };
    if (input.type !== 'payment') {
      await this.prisma.billingWebhookEvent.update({
        where: {
          provider_providerEventId: { provider: 'MERCADO_PAGO', providerEventId: input.eventId },
        },
        data: { status: 'IGNORED', processedAt: new Date() },
      });
      return { ignored: true };
    }
    try {
      const payment = await this.provider.getPayment(input.resourceId);
      await this.applyPayment(payment);
      await this.prisma.billingWebhookEvent.update({
        where: {
          provider_providerEventId: { provider: 'MERCADO_PAGO', providerEventId: input.eventId },
        },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      return { processed: true };
    } catch (error) {
      await this.prisma.billingWebhookEvent.update({
        where: {
          provider_providerEventId: { provider: 'MERCADO_PAGO', providerEventId: input.eventId },
        },
        data: {
          status: 'FAILED',
          errorCode: error instanceof Error ? error.message.slice(0, 64) : 'PROCESSING_FAILED',
        },
      });
      throw error;
    }
  }

  private async applyPayment(payment: ProviderPayment) {
    if (!payment.externalReference) throw new Error('PAYMENT_REFERENCE_MISSING');
    const checkout = await this.prisma.billingCheckoutSession.findUnique({
      where: { id: payment.externalReference },
      include: { plan: true, subscription: true },
    });
    if (!checkout) throw new Error('CHECKOUT_NOT_FOUND');
    if (payment.amountCents !== checkout.amountCents || payment.currency !== checkout.currency)
      throw new Error('PAYMENT_AMOUNT_MISMATCH');
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.payment.findUnique({ where: { providerPaymentId: payment.id } });
      const invoice =
        payment.status === 'PAID'
          ? await tx.invoice.upsert({
              where: { providerInvoiceId: `mp-payment-${payment.id}` },
              create: {
                organizationId: checkout.organizationId,
                subscriptionId: checkout.subscriptionId,
                providerInvoiceId: `mp-payment-${payment.id}`,
                status: 'PAID',
                amountCents: payment.amountCents,
                currency: payment.currency,
                periodStart: new Date(),
                periodEnd: new Date(Date.now() + 30 * 86_400_000),
                paidAt: payment.paidAt ?? new Date(),
              },
              update: { status: 'PAID', paidAt: payment.paidAt ?? new Date() },
            })
          : null;
      await tx.payment.upsert({
        where: { providerPaymentId: payment.id },
        create: {
          organizationId: checkout.organizationId,
          subscriptionId: checkout.subscriptionId,
          invoiceId: invoice?.id ?? null,
          checkoutSessionId: checkout.id,
          providerPaymentId: payment.id,
          status: payment.status,
          amountCents: payment.amountCents,
          currency: payment.currency,
          paymentMethod: payment.method,
          description: `VigiOn ${checkout.plan.name}`,
          paidAt: payment.status === 'PAID' ? (payment.paidAt ?? new Date()) : null,
          failedAt: payment.status === 'FAILED' ? new Date() : null,
        },
        update: {
          status: payment.status,
          ...(invoice ? { invoiceId: invoice.id } : {}),
          ...(payment.status === 'PAID' ? { paidAt: payment.paidAt ?? new Date() } : {}),
          ...(payment.status === 'FAILED' ? { failedAt: new Date() } : {}),
        },
      });
      if (payment.status !== 'PAID' || existing?.status === 'PAID') return;
      const now = new Date();
      const periodEnd = new Date(now.getTime() + 30 * 86_400_000);
      if (
        checkout.subscription &&
        !['EXPIRED', 'CANCELED'].includes(checkout.subscription.status)
      ) {
        assertSubscriptionTransition(checkout.subscription.status, 'EXPIRED');
        await tx.subscription.update({
          where: { id: checkout.subscription.id },
          data: { status: 'EXPIRED', endedAt: now },
        });
      }
      const next = await tx.subscription.create({
        data: {
          organizationId: checkout.organizationId,
          planId: checkout.planId,
          status: 'ACTIVE',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
      });
      await tx.subscriptionHistory.create({
        data: {
          organizationId: checkout.organizationId,
          subscriptionId: next.id,
          planId: checkout.planId,
          planCode: checkout.plan.code,
          planVersion: checkout.plan.version,
          status: 'ACTIVE',
          reason: 'PAYMENT_CONFIRMED',
          limitsSnapshot: {
            maxCameras: checkout.plan.maxCameras,
            maxStorageBytes: checkout.plan.maxStorageBytes.toString(),
            retentionDays: checkout.plan.retentionDays,
            maxUsers: checkout.plan.maxUsers,
          },
          featuresSnapshot: checkout.plan.enabledFeatures as Prisma.InputJsonValue,
          periodStart: now,
          periodEnd,
        },
      });
      await tx.billingCheckoutSession.update({
        where: { id: checkout.id },
        data: { status: 'COMPLETED', completedAt: now },
      });
      await tx.auditLog.create({
        data: {
          organizationId: checkout.organizationId,
          action: 'PAYMENT_CONFIRMED',
          entityType: 'Payment',
          entityId: payment.id,
          metadata: {
            planId: checkout.planId,
            amountCents: payment.amountCents,
            currency: payment.currency,
          },
        },
      });
    });
  }
}
