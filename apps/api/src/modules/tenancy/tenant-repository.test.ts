import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantRepository } from './tenant-repository';

const prisma = new PrismaClient();
const suffix = randomUUID().slice(0, 8);
const createdOrganizationIds: string[] = [];

beforeAll(async () => {
  await prisma.$connect();
});

afterAll(async () => {
  if (createdOrganizationIds.length > 0) {
    await prisma.notification.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    await prisma.storageFile.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: createdOrganizationIds } } });
    await prisma.cameraEvent.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    await prisma.camera.deleteMany({ where: { organizationId: { in: createdOrganizationIds } } });
    await prisma.subscription.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    await prisma.storageUsage.deleteMany({
      where: { organizationId: { in: createdOrganizationIds } },
    });
    await prisma.user.deleteMany({ where: { organizationId: { in: createdOrganizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: createdOrganizationIds } } });
  }
  await prisma.plan.deleteMany({ where: { slug: `integration-${suffix}` } });
  await prisma.$disconnect();
});

describe('data foundation and tenant isolation', () => {
  it('creates the required related records and blocks cross-tenant reads', async () => {
    const plan = await prisma.plan.create({
      data: {
        name: 'Integration',
        slug: `integration-${suffix}`,
        code: `INTEGRATION_${suffix.toUpperCase()}`,
        maxCameras: 2,
        maxStorageBytes: 1_000_000n,
        retentionDays: 7,
        maxUsers: 2,
        enabledFeatures: [],
      },
    });
    const organizationA = await prisma.organization.create({
      data: { name: 'Tenant A', slug: `tenant-a-${suffix}`, storageUsage: { create: {} } },
    });
    const organizationB = await prisma.organization.create({
      data: { name: 'Tenant B', slug: `tenant-b-${suffix}` },
    });
    createdOrganizationIds.push(organizationA.id, organizationB.id);

    const userA = await prisma.user.create({
      data: {
        organizationId: organizationA.id,
        name: 'Owner A',
        email: `owner-a-${suffix}@example.test`,
        normalizedEmail: `owner-a-${suffix}@example.test`,
        passwordHash: 'test-only-not-a-real-password-hash',
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });
    const userB = await prisma.user.create({
      data: {
        organizationId: organizationB.id,
        name: 'Owner B',
        email: `owner-b-${suffix}@example.test`,
        normalizedEmail: `owner-b-${suffix}@example.test`,
        passwordHash: 'test-only-not-a-real-password-hash',
        role: 'OWNER',
        status: 'ACTIVE',
      },
    });
    const camera = await prisma.camera.create({
      data: {
        organizationId: organizationA.id,
        name: 'Entrance',
        identifier: `camera-${suffix}`,
        protocol: 'RTSP',
      },
    });
    const event = await prisma.cameraEvent.create({
      data: {
        organizationId: organizationA.id,
        cameraId: camera.id,
        type: 'MOTION',
        detectedAt: new Date(),
      },
    });
    const notification = await prisma.notification.create({
      data: {
        organizationId: organizationA.id,
        userId: userA.id,
        eventId: event.id,
        title: 'Motion',
        message: 'Motion event received',
      },
    });
    const file = await prisma.storageFile.create({
      data: {
        organizationId: organizationA.id,
        cameraId: camera.id,
        eventId: event.id,
        type: 'EVENT_EVIDENCE',
        storageProvider: 'test',
        storageKey: `events/${suffix}.jpg`,
        fileName: 'evidence.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1024n,
      },
    });
    const subscription = await prisma.subscription.create({
      data: {
        organizationId: organizationA.id,
        planId: plan.id,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 86_400_000),
      },
    });
    const auditLog = await prisma.auditLog.create({
      data: {
        organizationId: organizationA.id,
        actorUserId: userA.id,
        action: 'CAMERA_CREATED',
        entityType: 'Camera',
        entityId: camera.id,
      },
    });

    expect(notification.eventId).toBe(event.id);
    expect(file.organizationId).toBe(organizationA.id);
    expect(subscription.planId).toBe(plan.id);
    expect(auditLog.actorUserId).toBe(userA.id);

    const tenantARepository = new TenantRepository(prisma, {
      organizationId: organizationA.id,
      userId: userA.id,
    });
    const tenantBRepository = new TenantRepository(prisma, {
      organizationId: organizationB.id,
      userId: userB.id,
    });

    await expect(tenantARepository.findCameraById(camera.id)).resolves.toMatchObject({
      id: camera.id,
    });
    await expect(tenantBRepository.findCameraById(camera.id)).resolves.toBeNull();
    await expect(tenantBRepository.findEventById(event.id)).resolves.toBeNull();
    await expect(tenantBRepository.findStorageFileById(file.id)).resolves.toBeNull();
    await expect(tenantBRepository.findSubscriptionById(subscription.id)).resolves.toBeNull();
    await expect(tenantBRepository.findAuditLogById(auditLog.id)).resolves.toBeNull();

    await expect(
      prisma.notification.create({
        data: {
          organizationId: organizationB.id,
          userId: userB.id,
          eventId: event.id,
          title: 'Invalid cross-tenant relation',
          message: 'Must fail at the database boundary',
        },
      }),
    ).rejects.toThrow();
  });
});
