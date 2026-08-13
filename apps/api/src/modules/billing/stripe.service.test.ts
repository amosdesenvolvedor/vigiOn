import type Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
vi.mock('../../config/env', () => ({
  env: {
    BILLING_ENVIRONMENT: 'test',
    STRIPE_PRICE_BASIC: 'price_basic',
    STRIPE_PRICE_PRO: 'price_pro',
    STRIPE_PRICE_BUSINESS: 'price_business',
  },
}));
import type { PaymentProvider } from './payment-provider';
import { StripeBillingService } from './stripe.service';

const provider = {
  available: true,
  portal: vi.fn(async (customerId: string) => ({ url: `https://billing.test/${customerId}` })),
} as unknown as PaymentProvider;

describe('Stripe billing security boundaries', () => {
  it('scopes financial history and portal customer to the authenticated organization', async () => {
    const paymentFindMany = vi.fn(async () => []);
    const invoiceFindMany = vi.fn(async () => []);
    const organizationFindUniqueOrThrow = vi.fn(async () => ({ stripeCustomerId: 'cus_tenant_a' }));
    const prisma = {
      payment: { findMany: paymentFindMany },
      invoice: { findMany: invoiceFindMany },
      organization: { findUniqueOrThrow: organizationFindUniqueOrThrow },
      $transaction: vi.fn(async (queries: unknown[]) => Promise.all(queries)),
    } as never;
    const service = new StripeBillingService(prisma, provider);

    await service.history('org-a');
    await expect(
      service.portal({ organizationId: 'org-a', userId: 'owner-a' } as never),
    ).resolves.toEqual({ url: 'https://billing.test/cus_tenant_a' });

    expect(paymentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-a' } }),
    );
    expect(invoiceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-a' } }),
    );
    expect(organizationFindUniqueOrThrow).toHaveBeenCalledWith({ where: { id: 'org-a' } });
  });

  it('does not process a duplicate event twice', async () => {
    const prisma = {
      billingWebhookEvent: { createMany: vi.fn(async () => ({ count: 0 })) },
    } as never;
    const service = new StripeBillingService(prisma, provider);
    await expect(service.webhook({ id: 'evt_duplicate' } as Stripe.Event)).resolves.toEqual({
      duplicate: true,
    });
  });

  it('reuses the single active checkout when concurrent reservation loses the unique lock', async () => {
    const pending = {
      id: 'checkout-existing',
      organizationId: 'org-a',
      checkoutUrl: 'https://checkout.stripe.test/existing',
      status: 'PENDING',
    };
    const createCheckout = vi.fn();
    const concurrentProvider = { ...provider, createCheckout } as unknown as PaymentProvider;
    const prisma = {
      plan: { findFirst: vi.fn(async () => ({ id: 'plan-basic', priceCents: 2990, currency: 'BRL' })) },
      billingCheckoutSession: {
        findUnique: vi.fn(async () => null),
        create: vi.fn(async () => {
          throw new Prisma.PrismaClientKnownRequestError('Unique checkout lock', {
            code: 'P2002', clientVersion: '6.19.3', meta: { target: ['activeLock'] },
          });
        }),
        findFirst: vi.fn(async () => pending),
      },
    } as never;
    const service = new StripeBillingService(prisma, concurrentProvider);

    await expect(
      service.checkout(
        { organizationId: 'org-a', userId: 'owner-a' } as never,
        'BASIC',
        '4e57f5d3-8d2c-48df-a83e-493c3b41bdb1',
      ),
    ).resolves.toBe(pending);
    expect(createCheckout).not.toHaveBeenCalled();
  });

  it('rejects subscription metadata that points to another Stripe Customer', async () => {
    const update = vi.fn(async () => ({}));
    const prisma = {
      billingWebhookEvent: {
        createMany: vi.fn(async () => ({ count: 1 })),
        update,
      },
      organization: {
        findUnique: vi.fn(async () => ({ id: 'org-a', stripeCustomerId: 'cus_expected' })),
      },
    } as never;
    const service = new StripeBillingService(prisma, provider);
    const event = {
      id: 'evt_cross_tenant',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_attacker',
          customer: 'cus_attacker',
          metadata: { organizationId: 'org-a' },
          status: 'active',
          items: { data: [{ price: { id: 'price_basic' } }] },
        },
      },
    } as unknown as Stripe.Event;

    await expect(service.webhook(event)).rejects.toThrow('STRIPE_CUSTOMER_TENANT_MISMATCH');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
  });

  it('ignores unselected Stripe event types', async () => {
    const update = vi.fn(async () => ({}));
    const prisma = {
      billingWebhookEvent: { createMany: vi.fn(async () => ({ count: 1 })), update },
    } as never;
    const service = new StripeBillingService(prisma, provider);
    await expect(
      service.webhook({ id: 'evt_other', type: 'customer.subscription.paused' } as Stripe.Event),
    ).resolves.toEqual({ ignored: true });
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'IGNORED' }) }),
    );
  });
});
