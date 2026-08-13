import { describe, expect, it, vi } from 'vitest';
vi.mock('../../config/env', () => ({
  env: {
    BILLING_ENABLED: true,
    STRIPE_SECRET_KEY: 'sk_test_example',
    STRIPE_WEBHOOK_SECRET: 'whsec_example',
    STRIPE_PRICE_BASIC: 'price_basic',
    STRIPE_PRICE_PRO: 'price_pro',
    STRIPE_PRICE_BUSINESS: 'price_business',
    FRONTEND_URL: 'https://vigion.test',
  },
}));
import Stripe from 'stripe';
import {
  mapStripeSubscriptionStatus,
  StripePaymentProvider,
  stripePlanForPrice,
  stripePriceFor,
} from './stripe.provider';

describe('Stripe provider mappings', () => {
  it('maps only configured internal plans and prices', () => {
    expect(stripePriceFor('PRO')).toBe('price_pro');
    expect(stripePlanForPrice('price_business')).toBe('BUSINESS');
    expect(stripePlanForPrice('price_attacker')).toBeUndefined();
  });
  it('accepts a genuine Stripe test signature and rejects a forged one', () => {
    const payload = JSON.stringify({ id: 'evt_test', type: 'invoice.paid', data: { object: {} } });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: 'whsec_example',
    });
    const provider = new StripePaymentProvider(new Stripe('sk_test_example'));
    expect(provider.webhook(Buffer.from(payload), signature).id).toBe('evt_test');
    expect(() => provider.webhook(Buffer.from(payload), 't=1,v1=forged')).toThrow();
  });
  it('maps financial status conservatively', () => {
    expect(mapStripeSubscriptionStatus('active')).toBe('ACTIVE');
    expect(mapStripeSubscriptionStatus('past_due')).toBe('PAST_DUE');
    expect(mapStripeSubscriptionStatus('unpaid')).toBe('SUSPENDED');
    expect(mapStripeSubscriptionStatus('canceled')).toBe('CANCELED');
    expect(mapStripeSubscriptionStatus('future_unknown_status')).toBe('SUSPENDED');
  });
});
