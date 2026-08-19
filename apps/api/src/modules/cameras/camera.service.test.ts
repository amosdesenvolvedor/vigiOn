import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CameraCredentialService } from './camera-credential.service';
import { CameraService } from './camera.service';
import { CameraHealthService } from '../camera-health/camera-health.service';

const prisma = new PrismaClient();
const suffix = randomUUID().slice(0, 8);
const organizationIds: string[] = [];
let planId = '';
const service = new CameraService(prisma);
const metadata = { ipAddress: '127.0.0.1', userAgent: 'CameraTest' };

async function tenant(label: string) {
  const organization = await prisma.organization.create({
    data: {
      name: `Camera ${label}`,
      slug: `camera-${label}-${suffix}`,
      resourceCounter: { create: { memberCount: 1 } },
      storageUsage: { create: {} },
    },
  });
  organizationIds.push(organization.id);
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      name: `Owner ${label}`,
      email: `${label}-${suffix}@example.test`,
      normalizedEmail: `${label}-${suffix}@example.test`,
      passwordHash: 'test-only',
      role: 'OWNER',
      status: 'ACTIVE',
    },
  });
  const membership = await prisma.organizationMembership.create({
    data: { organizationId: organization.id, userId: user.id, role: 'OWNER', status: 'ACTIVE' },
  });
  await prisma.subscription.create({
    data: {
      organizationId: organization.id,
      planId,
      status: 'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
    },
  });
  return {
    organization,
    context: {
      organizationId: organization.id,
      userId: user.id,
      membershipId: membership.id,
      role: 'OWNER' as const,
    },
  };
}

beforeAll(async () => {
  await prisma.$connect();
  const plan = await prisma.plan.create({
    data: {
      name: 'Camera Test',
      slug: `camera-test-${suffix}`,
      code: `CAMERA_TEST_${suffix.toUpperCase()}`,
      maxCameras: 10,
      maxStorageBytes: 1_000n,
      retentionDays: 1,
      maxUsers: 1,
      enabledFeatures: ['LIVE_VIEW'],
    },
  });
  planId = plan.id;
});

afterAll(async () => {
  await prisma.cameraEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.gatewayCommand.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.gatewayMessage.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.limitEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.camera.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.gateway.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.subscriptionHistory.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.subscription.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.resourceCounter.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.storageUsage.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organizationMembership.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await prisma.plan.delete({ where: { id: planId } });
  await prisma.$disconnect();
});

describe('camera management and tenant isolation', () => {
  it('creates, reads, updates, disables, enables and soft-deletes a camera', async () => {
    const current = await tenant('crud');
    const camera = await service.create(
      current.context,
      {
        name: 'Entrada',
        location: 'Portão',
        connectionType: 'ETHERNET',
        protocol: 'RTSP',
        identifier: 'SERIAL-1',
      },
      metadata,
    );
    expect(camera).toMatchObject({
      administrativeStatus: 'ACTIVE',
      connectionStatus: 'UNKNOWN',
      lastSeenAt: null,
    });
    expect(await service.get(current.context, camera.id)).toMatchObject({ name: 'Entrada' });
    expect(
      await service.update(current.context, camera.id, { name: 'Entrada Principal' }, metadata),
    ).toMatchObject({ name: 'Entrada Principal' });
    expect(
      await service.setAdministrativeStatus(current.context, camera.id, 'DISABLED', metadata),
    ).toMatchObject({ administrativeStatus: 'DISABLED', connectionStatus: 'UNKNOWN' });
    expect(
      await service.setAdministrativeStatus(current.context, camera.id, 'ACTIVE', metadata),
    ).toMatchObject({ administrativeStatus: 'ACTIVE' });
    await service.remove(current.context, camera.id, metadata);
    await expect(service.get(current.context, camera.id)).rejects.toMatchObject({
      code: 'CAMERA_NOT_FOUND',
    });
  });

  it('encrypts credentials and never exposes them in camera DTOs', async () => {
    const current = await tenant('credentials');
    const camera = await service.create(
      current.context,
      {
        name: 'Cofre',
        connectionType: 'WIFI',
        protocol: 'HTTPS',
        credentials: { username: 'device-admin', password: 'SuperSecret!123' },
      },
      metadata,
    );
    const raw = await prisma.cameraCredential.findUniqueOrThrow({ where: { cameraId: camera.id } });
    expect(Buffer.from(raw.ciphertext).toString('utf8')).not.toContain('SuperSecret!123');
    expect(JSON.stringify(camera)).not.toMatch(/password|credential|secret|token/i);
    await expect(
      new CameraCredentialService().retrieveForBackend(current.organization.id, camera.id),
    ).resolves.toEqual({ username: 'device-admin', password: 'SuperSecret!123' });
  });

  it('replaces rejected credentials, re-registers and returns to ONLINE', async () => {
    const current = await tenant('credential-recovery');
    const keys = generateKeyPairSync('x25519');
    const gateway = await prisma.gateway.create({
      data: {
        organizationId: current.organization.id,
        name: 'Recovery Gateway',
        deviceId: randomUUID(),
        secretHash: 'test',
        status: 'ONLINE',
        version: '0.4.0',
        encryptionPublicKey: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      },
    });
    const camera = await service.create(
      current.context,
      {
        name: 'Recovery Camera',
        connectionType: 'WIFI',
        protocol: 'RTSP',
        credentials: {
          username: 'admin',
          password: 'old-camera-password',
          stream: { host: '192.168.1.10', port: 554, path: '/stream', transport: 'tcp' },
        },
      },
      metadata,
    );
    await prisma.camera.update({
      where: { id: camera.id },
      data: { gatewayId: gateway.id, connectionStatus: 'AUTHENTICATION_ERROR' },
    });
    await service.updateCredentials(
      current.context,
      camera.id,
      {
        username: 'admin',
        password: 'new-camera-password',
        stream: { host: '192.168.1.10', port: 554, path: '/stream', transport: 'tcp' },
      },
      metadata,
    );
    expect(
      await new CameraCredentialService().retrieveForBackend(current.organization.id, camera.id),
    ).toMatchObject({ password: 'new-camera-password' });
    const updated = await prisma.camera.findUniqueOrThrow({ where: { id: camera.id } });
    expect(updated).toMatchObject({ connectionStatus: 'CONNECTING', healthGeneration: 2 });
    const command = await prisma.gatewayCommand.findFirstOrThrow({
      where: { cameraId: camera.id, type: 'CAMERA_REGISTER' },
    });
    expect(JSON.stringify(command.payload)).not.toContain('new-camera-password');
    const auth = {
      organizationId: current.organization.id,
      gatewayId: gateway.id,
      deviceId: gateway.deviceId,
    };
    await new CameraHealthService(prisma).ingest(auth, {
      messageId: randomUUID(),
      protocolVersion: '1',
      entries: [
        {
          cameraId: camera.id,
          generation: 2,
          sequence: 1,
          observedAt: new Date().toISOString(),
          status: 'ONLINE',
          checks: { onvif: 'OK', rtsp: 'OK' },
          consecutiveFailures: 0,
        },
      ],
    });
    expect(await prisma.camera.findUniqueOrThrow({ where: { id: camera.id } })).toMatchObject({
      connectionStatus: 'ONLINE',
      lastSeenAt: expect.any(Date),
    });
  });

  it('paginates, filters and searches only in the current tenant', async () => {
    const tenantA = await tenant('list-a');
    const tenantB = await tenant('list-b');
    await service.create(
      tenantA.context,
      { name: 'Garagem', location: 'Subsolo', connectionType: 'WIFI', protocol: 'ONVIF' },
      metadata,
    );
    await service.create(
      tenantA.context,
      { name: 'Recepção', location: 'Térreo', connectionType: 'ETHERNET', protocol: 'RTSP' },
      metadata,
    );
    await service.create(
      tenantB.context,
      { name: 'Garagem externa', connectionType: 'OTHER', protocol: 'ONVIF' },
      metadata,
    );
    const result = await service.list(tenantA.context, {
      page: 1,
      limit: 1,
      protocol: 'ONVIF',
      search: 'Garagem',
      sortBy: 'name',
      sortOrder: 'asc',
    });
    expect(result.pagination).toMatchObject({ total: 1, pages: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.name).toBe('Garagem');
  });

  it('returns not found for cross-tenant get, update and delete', async () => {
    const tenantA = await tenant('isolation-a');
    const tenantB = await tenant('isolation-b');
    const cameraB = await service.create(
      tenantB.context,
      { name: 'Tenant B', connectionType: 'OTHER', protocol: 'HTTP' },
      metadata,
    );
    await expect(service.get(tenantA.context, cameraB.id)).rejects.toMatchObject({
      code: 'CAMERA_NOT_FOUND',
    });
    await expect(
      service.update(tenantA.context, cameraB.id, { name: 'Attack' }, metadata),
    ).rejects.toMatchObject({ code: 'CAMERA_NOT_FOUND' });
    await expect(service.remove(tenantA.context, cameraB.id, metadata)).rejects.toMatchObject({
      code: 'CAMERA_NOT_FOUND',
    });
  });

  it('enforces plan camera limit and required feature', async () => {
    const current = await tenant('plan-limit');
    await prisma.plan.update({ where: { id: planId }, data: { maxCameras: 1 } });
    await service.create(
      current.context,
      { name: 'Única', connectionType: 'OTHER', protocol: 'OTHER' },
      metadata,
    );
    await expect(
      service.create(
        current.context,
        { name: 'Excedente', connectionType: 'OTHER', protocol: 'OTHER' },
        metadata,
      ),
    ).rejects.toMatchObject({ code: 'PLAN_LIMIT_REACHED', resource: 'CAMERAS' });
    await prisma.plan.update({
      where: { id: planId },
      data: { maxCameras: 10, enabledFeatures: [] },
    });
    const noFeature = await tenant('no-feature');
    await expect(
      service.create(
        noFeature.context,
        { name: 'Sem feature', connectionType: 'OTHER', protocol: 'OTHER' },
        metadata,
      ),
    ).rejects.toMatchObject({ code: 'FEATURE_NOT_AVAILABLE' });
    await prisma.plan.update({ where: { id: planId }, data: { enabledFeatures: ['LIVE_VIEW'] } });
  });
});
