import Stripe from 'stripe';
import { env } from '../../config/env';
import type { PaymentProvider } from './payment-provider';

export type PaidPlanCode = 'BASIC' | 'PRO' | 'BUSINESS';
const prices: Record<PaidPlanCode, string | undefined> = {
  BASIC: env.STRIPE_PRICE_BASIC,
  PRO: env.STRIPE_PRICE_PRO,
  BUSINESS: env.STRIPE_PRICE_BUSINESS,
};
export const stripePriceFor = (plan: PaidPlanCode) => prices[plan];
export const stripePlanForPrice = (priceId: string) =>
  Object.entries(prices).find(([, configured]) => configured === priceId)?.[0] as
    | PaidPlanCode
    | undefined;

export const mapStripeSubscriptionStatus = (status: Stripe.Subscription.Status) => {
  const map: Record<
    Stripe.Subscription.Status,
    'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED' | 'SUSPENDED'
  > = {
    trialing: 'TRIALING',
    active: 'ACTIVE',
    past_due: 'PAST_DUE',
    canceled: 'CANCELED',
    unpaid: 'SUSPENDED',
    incomplete: 'PAST_DUE',
    incomplete_expired: 'CANCELED',
    paused: 'SUSPENDED',
  };
  return map[status];
};

export class StripePaymentProvider implements PaymentProvider {
  readonly client: Stripe | null;
  readonly available: boolean;
  constructor(client?: Stripe) {
    this.client = client ?? (env.STRIPE_SECRET_KEY ? new Stripe(env.STRIPE_SECRET_KEY) : null);
    this.available = Boolean(
      env.BILLING_ENABLED &&
        this.client &&
        env.STRIPE_WEBHOOK_SECRET &&
        prices.BASIC &&
        prices.PRO &&
        prices.BUSINESS,
    );
  }
  async createCustomer(input: {
    organizationId: string;
    ownerId: string;
    email: string;
    name: string;
  }) {
    if (!this.client) throw new Error('STRIPE_UNAVAILABLE');
    return this.client.customers.create(
      {
        email: input.email,
        name: input.name,
        metadata: { organizationId: input.organizationId, ownerId: input.ownerId },
      },
      { idempotencyKey: `customer-${input.organizationId}` },
    );
  }
  async createCheckout(input: {
    customerId: string;
    priceId: string;
    organizationId: string;
    plan: PaidPlanCode;
    idempotencyKey: string;
  }) {
    if (!this.client) throw new Error('STRIPE_UNAVAILABLE');
    return this.client.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: input.customerId,
        line_items: [{ price: input.priceId, quantity: 1 }],
        success_url: `${env.FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${env.FRONTEND_URL}/billing`,
        client_reference_id: input.organizationId,
        metadata: { organizationId: input.organizationId, plan: input.plan },
        subscription_data: { metadata: { organizationId: input.organizationId, plan: input.plan } },
      },
      { idempotencyKey: input.idempotencyKey },
    );
  }
  async portal(customerId: string) {
    if (!this.client) throw new Error('STRIPE_UNAVAILABLE');
    return this.client.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${env.FRONTEND_URL}/billing`,
    });
  }
  async cancelAtPeriodEnd(subscriptionId: string) {
    if (!this.client) throw new Error('STRIPE_UNAVAILABLE');
    return this.client.subscriptions.update(subscriptionId, { cancel_at_period_end: true });
  }
  async retrieveSubscription(subscriptionId: string) {
    if (!this.client) throw new Error('STRIPE_UNAVAILABLE');
    return this.client.subscriptions.retrieve(subscriptionId);
  }
  async changePlan(subscriptionId: string, itemId: string, priceId: string, downgrade: boolean) {
    if (!this.client) throw new Error('STRIPE_UNAVAILABLE');
    return this.client.subscriptions.update(subscriptionId, {
      items: [{ id: itemId, price: priceId }],
      proration_behavior: downgrade ? 'none' : 'create_prorations',
    });
  }
  webhook(raw: Buffer, signature: string) {
    if (!this.client || !env.STRIPE_WEBHOOK_SECRET) throw new Error('STRIPE_WEBHOOK_UNAVAILABLE');
    return this.client.webhooks.constructEvent(raw, signature, env.STRIPE_WEBHOOK_SECRET);
  }
}
export const stripeProvider = new StripePaymentProvider();
