import type Stripe from 'stripe';
import type { PaidPlanCode } from './stripe.provider';

export interface PaymentProvider {
  readonly available: boolean;
  createCustomer(input: {
    organizationId: string;
    ownerId: string;
    email: string;
    name: string;
  }): Promise<{ id: string }>;
  createCheckout(input: {
    customerId: string;
    priceId: string;
    organizationId: string;
    plan: PaidPlanCode;
    idempotencyKey: string;
  }): Promise<{ id: string; url: string | null; expires_at: number }>;
  portal(customerId: string): Promise<{ url: string }>;
  cancelAtPeriodEnd(subscriptionId: string): Promise<unknown>;
  retrieveSubscription(subscriptionId: string): Promise<Stripe.Subscription>;
  changePlan(
    subscriptionId: string,
    itemId: string,
    priceId: string,
    downgrade: boolean,
  ): Promise<unknown>;
  webhook(raw: Buffer, signature: string): Stripe.Event;
}
