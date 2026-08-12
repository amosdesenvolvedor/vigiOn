import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DashboardService } from './dashboard.service';
const prisma = new PrismaClient();
const service = new DashboardService(prisma);
const orgs: string[] = [];
async function tenant(label: string) {
  const organization = await prisma.organization.create({
    data: {
      name: label,
      slug: `dash-${label}-${randomUUID().slice(0, 8)}`,
      resourceCounter: { create: {} },
      storageUsage: { create: {} },
    },
  });
  orgs.push(organization.id);
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      name: label,
      email: `${randomUUID()}@test.invalid`,
      normalizedEmail: `${randomUUID()}@test.invalid`,
      passwordHash: 'x',
      role: 'OWNER',
      status: 'ACTIVE',
    },
  });
  const membership = await prisma.organizationMembership.create({
    data: { organizationId: organization.id, userId: user.id, role: 'OWNER', status: 'ACTIVE' },
  });
  return {
    organization,
    context: {
      organizationId: organization.id,
      userId: user.id,
      membershipId: membership.id,
      sessionId: 's',
      role: 'OWNER' as const,
    },
  };
}
beforeAll(() => prisma.$connect());
afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.camera.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.storageUsage.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.resourceCounter.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.$disconnect();
});
describe('dashboard summary', () => {
  it('counts only the authenticated tenant', async () => {
    const a = await tenant('a');
    const b = await tenant('b');
    await prisma.camera.create({
      data: {
        organizationId: a.organization.id,
        name: 'A',
        protocol: 'RTSP',
        connectionStatus: 'ONLINE',
      },
    });
    await prisma.camera.create({
      data: {
        organizationId: b.organization.id,
        name: 'B',
        protocol: 'RTSP',
        connectionStatus: 'OFFLINE',
      },
    });
    const summary = await service.summary(a.context);
    expect(summary.metrics).toMatchObject({ camerasTotal: 1, camerasOnline: 1, camerasOffline: 0 });
    expect(summary.cameras.map((c) => c.name)).toEqual(['A']);
  });
});
