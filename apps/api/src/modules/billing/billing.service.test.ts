import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EntitlementService } from './entitlement.service';
import { SubscriptionService } from './subscription.service';

const prisma = new PrismaClient();
const suffix = randomUUID().slice(0, 8);
const organizationIds: string[] = [];
let limitedPlanId = '';
const entitlements = new EntitlementService(prisma);
const subscriptions = new SubscriptionService(prisma);

async function organization(
  label: string,
  input?: {
    status?: 'ACTIVE' | 'TRIALING' | 'CANCELED' | 'EXPIRED';
    trialEndsAt?: Date;
    planId?: string;
  },
) {
  const record = await prisma.organization.create({
    data: {
      name: `Billing ${label}`,
      slug: `billing-${label}-${suffix}`,
      storageUsage: { create: {} },
      resourceCounter: { create: {} },
    },
  });
  organizationIds.push(record.id);
  const subscription = await prisma.subscription.create({
    data: {
      organizationId: record.id,
      planId: input?.planId ?? limitedPlanId,
      status: input?.status ?? 'ACTIVE',
      currentPeriodStart: new Date(Date.now() - 86_400_000),
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
      ...(input?.trialEndsAt ? { trialEndsAt: input.trialEndsAt } : {}),
    },
  });
  return { organization: record, subscription };
}

beforeAll(async () => {
  await prisma.$connect();
  await prisma.plan.upsert({
    where: { slug: 'free' },
    update: { code: 'FREE' },
    create: {
      name: 'Free',
      slug: 'free',
      code: 'FREE',
      maxCameras: 1,
      maxStorageBytes: 100n,
      retentionDays: 1,
      maxUsers: 1,
      enabledFeatures: ['LIVE_VIEW'],
    },
  });
  const plan = await prisma.plan.create({
    data: {
      name: 'Limited Test',
      slug: `limited-${suffix}`,
      code: `LIMITED_${suffix.toUpperCase()}`,
      maxCameras: 1,
      maxStorageBytes: 100n,
      retentionDays: 7,
      maxUsers: 1,
      trialDays: 7,
      enabledFeatures: ['LIVE_VIEW', 'RECORDING'],
    },
  });
  limitedPlanId = plan.id;
});

afterAll(async () => {
  await prisma.limitEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.subscriptionHistory.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.subscription.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.storageUsage.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.resourceCounter.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await prisma.plan.delete({ where: { id: limitedPlanId } });
  await prisma.$disconnect();
});

describe('plans, subscriptions and centralized entitlements', () => {
  it('creates, lists, limits and deactivates a configurable plan', async () => {
    const listed = await subscriptions.listPlans();
    expect(listed).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: limitedPlanId, maxCameras: 1 })]),
    );
    await prisma.plan.update({ where: { id: limitedPlanId }, data: { status: 'INACTIVE' } });
    expect((await subscriptions.listPlans()).some(({ id }) => id === limitedPlanId)).toBe(false);
    await prisma.plan.update({ where: { id: limitedPlanId }, data: { status: 'ACTIVE' } });
  });

  it('distinguishes FREE, trial, canceled, active and expired states', async () => {
    expect(
      subscriptions.trialState(new Date(Date.now() + 6 * 86_400_000), 'TRIALING'),
    ).toMatchObject({ state: 'ACTIVE' });
    expect(
      subscriptions.trialState(new Date(Date.now() + 2 * 86_400_000), 'TRIALING'),
    ).toMatchObject({ state: 'EXPIRING' });
    expect(subscriptions.trialState(new Date(Date.now() - 1), 'EXPIRED')).toEqual({
      state: 'EXPIRED',
      daysRemaining: 0,
    });
    const active = await organization('active');
    expect((await subscriptions.getCurrent(active.organization.id)).status).toBe('ACTIVE');
    await prisma.subscription.update({
      where: { id: active.subscription.id },
      data: { status: 'CANCELED', cancelAtPeriodEnd: true },
    });
    expect((await subscriptions.getCurrent(active.organization.id)).status).toBe('CANCELED');
  });

  it('allows exactly one of two concurrent camera reservations', async () => {
    const current = await organization('camera-race');
    const results = await Promise.allSettled([
      entitlements.reserveCamera(current.organization.id),
      entitlements.reserveCamera(current.organization.id),
    ]);
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    await expect(
      prisma.resourceCounter.findUnique({ where: { organizationId: current.organization.id } }),
    ).resolves.toMatchObject({ cameraCount: 1 });
  });

  it('blocks member and storage limits with structured errors', async () => {
    const current = await organization('limits');
    await entitlements.reserveMember(current.organization.id);
    await expect(entitlements.reserveMember(current.organization.id)).rejects.toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      resource: 'USERS',
      upgradeRequired: true,
    });
    await entitlements.reserveStorage(current.organization.id, 95n);
    await expect(entitlements.reserveStorage(current.organization.id, 10n)).rejects.toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      resource: 'STORAGE',
    });
  });

  it('checks features and usage independently for each tenant', async () => {
    const tenantA = await organization('features-a');
    const tenantB = await organization('features-b');
    await entitlements.reserveCamera(tenantB.organization.id);
    expect(await entitlements.hasFeature(tenantA.organization.id, 'RECORDING')).toBe(true);
    expect(await entitlements.hasFeature(tenantA.organization.id, 'PERSON_DETECTION')).toBe(false);
    const usageA = await entitlements.getUsage(tenantA.organization.id);
    expect(usageA.cameras.current).toBe(0);
  });

  it('expires a paid trial into FREE without deleting tenant data and records history', async () => {
    const trial = await organization('expired-trial', {
      status: 'TRIALING',
      trialEndsAt: new Date(Date.now() - 1),
    });
    const result = await subscriptions.expireTrialIfNeeded(trial.organization.id);
    expect(result?.plan.code).toBe('FREE');
    expect(result?.status).toBe('ACTIVE');
    await expect(
      prisma.subscriptionHistory.count({ where: { organizationId: trial.organization.id } }),
    ).resolves.toBe(2);
    await expect(
      prisma.organization.findUnique({ where: { id: trial.organization.id } }),
    ).resolves.not.toBeNull();
  });
});
