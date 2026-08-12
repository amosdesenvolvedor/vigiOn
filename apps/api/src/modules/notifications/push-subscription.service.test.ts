import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../lib/prisma';
import { PushSubscriptionService } from './push-subscription.service';

const service = new PushSubscriptionService(prisma);
const suffix = randomUUID().slice(0, 8);
const organizationIds: string[] = [];
const userIds: string[] = [];

beforeAll(() => prisma.$connect());
afterAll(async () => {
  await prisma.pushSubscription.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organizationMembership.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await prisma.$disconnect();
});

async function context(label: string) {
  const organization = await prisma.organization.create({
    data: { name: `Push ${label}`, slug: `push-${label}-${suffix}` },
  });
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      name: label,
      email: `${label}-${suffix}@example.com`,
      normalizedEmail: `${label}-${suffix}@example.com`,
      passwordHash: 'test',
      status: 'ACTIVE',
      role: 'OWNER',
    },
  });
  organizationIds.push(organization.id);
  userIds.push(user.id);
  return { organizationId: organization.id, userId: user.id, role: 'OWNER' as const };
}

describe('push subscriptions', () => {
  it('supports multiple devices, deduplicates and blocks subscription hijacking', async () => {
    const a = await context('a');
    const b = await context('b');
    const input = {
      endpoint: 'https://push.example.test/device-a',
      keys: { p256dh: 'p'.repeat(64), auth: 'a'.repeat(24) },
    };
    const first = await service.subscribe(a, input, 'test');
    const duplicate = await service.subscribe(a, input, 'test');
    expect(duplicate.id).toBe(first.id);
    await service.subscribe(a, { ...input, endpoint: `${input.endpoint}-2` }, 'test');
    await expect(service.subscribe(b, input, 'test')).rejects.toMatchObject({ status: 409 });
    await expect(service.unsubscribe(b, input.endpoint)).rejects.toMatchObject({ status: 404 });
    await service.unsubscribe(a, input.endpoint);
    expect(
      await prisma.pushSubscription.count({ where: { userId: a.userId, revokedAt: null } }),
    ).toBe(1);
  });
});
