import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PaymentProvider, ProviderPayment } from './payment-provider';
import { BillingPaymentService } from './billing-payment.service';

class FakeProvider implements PaymentProvider {
  available = true;
  payment: ProviderPayment | null = null;
  checkoutCalls = 0;
  async createCheckout(input: { reference: string }) {
    this.checkoutCalls += 1;
    return {
      providerCheckoutId: `pref-${input.reference}`,
      checkoutUrl: 'https://sandbox.example/checkout',
      expiresAt: new Date(Date.now() + 60_000),
    };
  }
  async getPayment() {
    if (!this.payment) throw new Error('NO_PAYMENT');
    return this.payment;
  }
  verifyWebhook() {
    return true;
  }
}

const prisma = new PrismaClient();
const provider = new FakeProvider();
const service = new BillingPaymentService(prisma, provider);
const suffix = randomUUID().slice(0, 8);
const organizationIds: string[] = [];
let planId = '';
let context: {
  organizationId: string;
  userId: string;
  membershipId: string;
  sessionId: string;
  role: 'OWNER';
};

beforeAll(async () => {
  const plan = await prisma.plan.create({
    data: {
      name: 'Billing paid test',
      slug: `paid-${suffix}`,
      code: `PAID_${suffix}`,
      priceCents: 12990,
      currency: 'BRL',
      billingInterval: 'MONTHLY',
      maxCameras: 5,
      maxStorageBytes: 1000n,
      retentionDays: 7,
      maxUsers: 3,
      enabledFeatures: ['LIVE_VIEW'],
    },
  });
  planId = plan.id;
  const organization = await prisma.organization.create({
    data: {
      name: 'Billing integration',
      slug: `billing-integration-${suffix}`,
      storageUsage: { create: {} },
      resourceCounter: { create: {} },
    },
  });
  organizationIds.push(organization.id);
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      name: 'Owner',
      email: `billing-${suffix}@test.invalid`,
      normalizedEmail: `billing-${suffix}@test.invalid`,
      passwordHash: 'x',
      status: 'ACTIVE',
      role: 'OWNER',
    },
  });
  const membership = await prisma.organizationMembership.create({
    data: { organizationId: organization.id, userId: user.id, role: 'OWNER', status: 'ACTIVE' },
  });
  const free = await prisma.plan.findFirstOrThrow({ where: { code: 'FREE' } });
  await prisma.subscription.create({
    data: {
      organizationId: organization.id,
      planId: free.id,
      status: 'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
    },
  });
  context = {
    organizationId: organization.id,
    userId: user.id,
    membershipId: membership.id,
    sessionId: 'test',
    role: 'OWNER',
  };
});
afterAll(async () => {
  await prisma.billingWebhookEvent.deleteMany({
    where: { resourceId: { startsWith: `payment-${suffix}` } },
  });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.payment.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.invoice.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.billingCheckoutSession.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.subscriptionHistory.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.subscription.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organizationMembership.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.storageUsage.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.resourceCounter.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await prisma.plan.delete({ where: { id: planId } });
  await prisma.$disconnect();
});

describe('billing checkout, tenancy and webhook idempotency', () => {
  it('uses persisted price and collapses duplicate checkout clicks', async () => {
    const key = randomUUID();
    const first = await service.checkout(context, planId, key, {});
    const second = await service.checkout(context, planId, key, {});
    expect(second.id).toBe(first.id);
    expect(first.amountCents).toBe(12990);
    expect(provider.checkoutCalls).toBe(1);
    expect(await service.checkoutStatus(randomUUID(), first.id)).toBeNull();
    provider.payment = {
      id: `payment-${suffix}`,
      externalReference: first.id,
      status: 'PAID',
      amountCents: 12990,
      currency: 'BRL',
      method: 'PIX',
      paidAt: new Date(),
    };
    expect(
      await service.receiveWebhook({
        eventId: `event-${suffix}`,
        type: 'payment',
        resourceId: provider.payment.id,
      }),
    ).toEqual({ processed: true });
    expect(
      await service.receiveWebhook({
        eventId: `event-${suffix}`,
        type: 'payment',
        resourceId: provider.payment.id,
      }),
    ).toEqual({ duplicate: true });
    expect(
      await prisma.payment.count({
        where: { organizationId: context.organizationId, status: 'PAID' },
      }),
    ).toBe(1);
    expect((await service.history(context.organizationId, 1, 10)).payments).toHaveLength(1);
    expect((await service.history(randomUUID(), 1, 10)).payments).toHaveLength(0);
  });
});
