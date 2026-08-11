import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventService } from './event.service';

const prisma = new PrismaClient();
const service = new EventService(prisma);
const suffix = randomUUID().slice(0, 8);
const organizationIds: string[] = [];

async function tenant(label: string) {
  const organization = await prisma.organization.create({
    data: {
      name: label,
      slug: `event-${label}-${suffix}`,
      resourceCounter: { create: {} },
      storageUsage: { create: {} },
    },
  });
  organizationIds.push(organization.id);
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      name: label,
      email: `${label}-${suffix}@test.invalid`,
      normalizedEmail: `${label}-${suffix}@test.invalid`,
      passwordHash: 'x',
      role: 'OWNER',
      status: 'ACTIVE',
    },
  });
  const membership = await prisma.organizationMembership.create({
    data: { organizationId: organization.id, userId: user.id, role: 'OWNER', status: 'ACTIVE' },
  });
  const gateway = await prisma.gateway.create({
    data: {
      organizationId: organization.id,
      name: 'Edge',
      deviceId: randomUUID(),
      secretHash: 'x',
      status: 'ONLINE',
      lastSeenAt: new Date(),
    },
  });
  const camera = await prisma.camera.create({
    data: {
      organizationId: organization.id,
      gatewayId: gateway.id,
      name: 'Entrada',
      protocol: 'RTSP',
    },
  });
  return {
    organization,
    gateway,
    camera,
    auth: { organizationId: organization.id, gatewayId: gateway.id, deviceId: gateway.deviceId },
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
  await prisma.cameraEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.camera.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.gateway.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organizationMembership.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.storageUsage.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.resourceCounter.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await prisma.$disconnect();
});

describe('EventService', () => {
  it('persists one logical motion event and updates its end idempotently', async () => {
    const current = await tenant('motion');
    const eventId = randomUUID();
    const occurredAt = new Date().toISOString();
    const input = {
      messageId: randomUUID(),
      eventId,
      protocolVersion: '1' as const,
      cameraId: current.camera.id,
      type: 'MOTION' as const,
      occurredAt,
      motionScore: 0.42,
    };
    expect((await service.ingest(current.auth, input)).duplicate).toBe(false);
    expect(
      (await service.ingest(current.auth, { ...input, messageId: randomUUID() })).duplicate,
    ).toBe(true);
    const endedAt = new Date().toISOString();
    await service.ingest(current.auth, {
      ...input,
      messageId: randomUUID(),
      endedAt,
      motionScore: 0.6,
    });
    const stored = await prisma.cameraEvent.findMany({
      where: { gatewayId: current.gateway.id, externalEventId: eventId },
    });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      type: 'MOTION',
      source: 'MOTION_DETECTOR',
      status: 'RESOLVED',
    });
    expect(stored[0]?.endedAt).not.toBeNull();
  });

  it('blocks gateway event injection across tenants and user cross-tenant reads', async () => {
    const a = await tenant('tenant-a');
    const b = await tenant('tenant-b');
    await expect(
      service.ingest(a.auth, {
        messageId: randomUUID(),
        eventId: randomUUID(),
        protocolVersion: '1',
        cameraId: b.camera.id,
        type: 'CAMERA_OFFLINE',
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ code: 'CAMERA_NOT_FOUND' });
    const created = await service.ingest(b.auth, {
      messageId: randomUUID(),
      eventId: randomUUID(),
      protocolVersion: '1',
      cameraId: b.camera.id,
      type: 'CAMERA_OFFLINE',
      occurredAt: new Date().toISOString(),
    });
    if (!created.event) throw new Error('Expected event creation');
    const repeatedTransition = await service.ingest(b.auth, {
      messageId: randomUUID(),
      eventId: randomUUID(),
      protocolVersion: '1',
      cameraId: b.camera.id,
      type: 'CAMERA_OFFLINE',
      occurredAt: new Date().toISOString(),
    });
    expect(repeatedTransition).toMatchObject({ duplicate: true, ignored: true, event: null });
    expect(
      await prisma.cameraEvent.count({
        where: { cameraId: b.camera.id, type: 'CAMERA_OFFLINE' },
      }),
    ).toBe(1);
    await expect(service.get(a.context, created.event.id)).rejects.toMatchObject({
      code: 'EVENT_NOT_FOUND',
    });
    expect(
      (await service.list(a.context, { page: 1, limit: 20 })).items.some(
        (event) => event.id === created.event.id,
      ),
    ).toBe(false);
  });

  it('rejects absurd gateway timestamps', async () => {
    const current = await tenant('clock');
    await expect(
      service.ingest(current.auth, {
        messageId: randomUUID(),
        eventId: randomUUID(),
        protocolVersion: '1',
        cameraId: current.camera.id,
        type: 'MOTION',
        occurredAt: '2099-01-01T00:00:00.000Z',
        motionScore: 0.5,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_EVENT_TIMESTAMP' });
  });
});
