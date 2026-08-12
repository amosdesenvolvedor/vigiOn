import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IntelligenceService } from './intelligence.service';
const prisma = new PrismaClient();
const service = new IntelligenceService(prisma);
const orgs: string[] = [];
async function tenant(name: string) {
  const organization = await prisma.organization.create({
    data: {
      name,
      slug: `intel-${name}-${randomUUID().slice(0, 8)}`,
      timezone: 'America/Porto_Velho',
      resourceCounter: { create: {} },
      storageUsage: { create: {} },
    },
  });
  orgs.push(organization.id);
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      name,
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
  const camera = await prisma.camera.create({
    data: { organizationId: organization.id, name: 'Entrada', protocol: 'RTSP' },
  });
  return {
    organization,
    user,
    camera,
    context: {
      organizationId: organization.id,
      userId: user.id,
      membershipId: membership.id,
      role: 'OWNER' as const,
    },
  };
}
beforeAll(() => prisma.$connect());
afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.cameraZone.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.scheduleException.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.monitoringSchedule.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.camera.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.storageUsage.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.resourceCounter.deleteMany({ where: { organizationId: { in: orgs } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs } } });
  await prisma.$disconnect();
});
describe('intelligence tenant isolation', () => {
  it('scopes schedules and zones and blocks cross-tenant IDs', async () => {
    const a = await tenant('a');
    const b = await tenant('b');
    const schedule = await service.saveSchedule(
      b.context,
      {
        cameraId: null,
        mode: 'SCHEDULED',
        intervals: [{ weekday: 1, startMinute: 480, endMinute: 1080 }],
      },
      {},
    );
    const zone = await service.saveZone(
      b.context,
      {
        cameraId: b.camera.id,
        name: 'Caixa',
        priority: 'HIGH',
        polygon: [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 0.5, y: 1 },
        ],
        enabled: true,
      },
      {},
    );
    expect(await service.listSchedules(a.context)).toHaveLength(0);
    expect(await service.listZones(a.context)).toHaveLength(0);
    await expect(
      service.addException(
        a.context,
        schedule.id,
        {
          localDate: '2026-08-12',
          mode: 'CLOSED',
          startMinute: null,
          endMinute: null,
          label: null,
        },
        {},
      ),
    ).rejects.toMatchObject({ code: 'SCHEDULE_NOT_FOUND' });
    await expect(service.deleteZone(a.context, zone.id, {})).rejects.toMatchObject({
      code: 'ZONE_NOT_FOUND',
    });
    expect(
      await prisma.cameraZone.count({ where: { id: zone.id, organizationId: b.organization.id } }),
    ).toBe(1);
  });
});
