import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CameraCredentialService } from '../cameras/camera-credential.service';
import { StreamSessionService } from './stream-session.service';

const prisma = new PrismaClient();
const service = new StreamSessionService(prisma);
const credentials = new CameraCredentialService();
const suffix = randomUUID().slice(0, 8);
const organizationIds: string[] = [];
let planId = '';
const publicKey = generateKeyPairSync('x25519')
  .publicKey.export({ type: 'spki', format: 'pem' })
  .toString();
const metadata = { ipAddress: '127.0.0.1' };
async function tenant(label: string, gatewayStatus: 'ONLINE' | 'OFFLINE' = 'ONLINE') {
  const organization = await prisma.organization.create({
    data: {
      name: `Stream ${label}`,
      slug: `stream-${label}-${suffix}`,
      resourceCounter: { create: {} },
      storageUsage: { create: {} },
    },
  });
  organizationIds.push(organization.id);
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      name: 'Viewer',
      email: `${label}-${suffix}@example.test`,
      normalizedEmail: `${label}-${suffix}@example.test`,
      passwordHash: 'test',
      role: 'VIEWER',
      status: 'ACTIVE',
    },
  });
  const membership = await prisma.organizationMembership.create({
    data: { organizationId: organization.id, userId: user.id, role: 'VIEWER', status: 'ACTIVE' },
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
  const gateway = await prisma.gateway.create({
    data: {
      organizationId: organization.id,
      name: 'Edge',
      deviceId: randomUUID(),
      secretHash: 'test',
      status: gatewayStatus,
      lastSeenAt: new Date(),
      encryptionPublicKey: publicKey,
    },
  });
  const camera = await prisma.camera.create({
    data: {
      organizationId: organization.id,
      gatewayId: gateway.id,
      name: 'RTSP',
      protocol: 'RTSP',
      administrativeStatus: 'ACTIVE',
    },
  });
  await credentials.store(prisma, organization.id, camera.id, {
    username: 'cam',
    password: 'secret',
    stream: { host: '192.168.1.10', port: 554, path: '/live', transport: 'tcp' },
  });
  return {
    organization,
    user,
    gateway,
    camera,
    context: {
      organizationId: organization.id,
      userId: user.id,
      membershipId: membership.id,
      role: 'VIEWER' as const,
    },
  };
}
beforeAll(async () => {
  await prisma.$connect();
  const plan = await prisma.plan.create({
    data: {
      name: 'Stream test',
      slug: `stream-test-${suffix}`,
      code: `STREAM_${suffix.toUpperCase()}`,
      maxCameras: 10,
      maxStorageBytes: 1000n,
      retentionDays: 1,
      maxUsers: 10,
      enabledFeatures: ['LIVE_VIEW'],
    },
  });
  planId = plan.id;
});
afterAll(async () => {
  await prisma.gatewayMessage.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.gatewayCommand.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.streamSession.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.cameraCredential.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.camera.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.gateway.deleteMany({ where: { organizationId: { in: organizationIds } } });
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

describe('stream sessions', () => {
  it('creates one temporary START_STREAM command and reuses an idempotency key', async () => {
    const current = await tenant('create');
    const key = randomUUID();
    const first = await service.create(current.context, current.camera.id, key, metadata);
    const duplicate = await service.create(current.context, current.camera.id, key, metadata);
    expect(first.session.status).toBe('STARTING');
    expect(duplicate.session.id).toBe(first.session.id);
    expect(first.playbackToken).toBe(duplicate.playbackToken);
    expect(
      await prisma.gatewayCommand.count({
        where: { streamSessionId: first.session.id, type: 'START_STREAM' },
      }),
    ).toBe(1);
    expect(
      JSON.stringify(
        await prisma.gatewayCommand.findFirst({ where: { streamSessionId: first.session.id } }),
      ),
    ).not.toContain('secret');
  });
  it('blocks session creation and lookup across tenants', async () => {
    const a = await tenant('tenant-a');
    const b = await tenant('tenant-b');
    await expect(
      service.create(a.context, b.camera.id, randomUUID(), metadata),
    ).rejects.toMatchObject({ code: 'CAMERA_NOT_FOUND' });
    const created = await service.create(b.context, b.camera.id, randomUUID(), metadata);
    await expect(service.get(a.context, created.session.id)).rejects.toMatchObject({
      code: 'STREAM_NOT_AUTHORIZED',
    });
    await expect(service.stop(a.context, created.session.id, metadata)).rejects.toMatchObject({
      code: 'STREAM_NOT_AUTHORIZED',
    });
    await expect(
      service.authorizeGatewayMedia(
        {
          gatewayId: a.gateway.id,
          organizationId: a.organization.id,
          deviceId: a.gateway.deviceId,
        },
        created.session.id,
      ),
    ).rejects.toMatchObject({ code: 'GATEWAY_UNAUTHORIZED' });
  });
  it('returns controlled errors for offline gateway and disabled camera', async () => {
    const offline = await tenant('offline', 'OFFLINE');
    await expect(
      service.create(offline.context, offline.camera.id, randomUUID(), metadata),
    ).rejects.toMatchObject({ code: 'GATEWAY_OFFLINE' });
    const disabled = await tenant('disabled');
    await prisma.camera.update({
      where: { id: disabled.camera.id },
      data: { administrativeStatus: 'DISABLED' },
    });
    await expect(
      service.create(disabled.context, disabled.camera.id, randomUUID(), metadata),
    ).rejects.toMatchObject({ code: 'CAMERA_DISABLED' });
  });
  it('authorizes only the temporary viewer token', async () => {
    const current = await tenant('token');
    const created = await service.create(
      current.context,
      current.camera.id,
      randomUUID(),
      metadata,
    );
    await expect(
      service.authorizeViewer(created.session.id, created.playbackToken),
    ).resolves.toMatchObject({ id: created.session.id });
    await expect(service.authorizeViewer(created.session.id, 'wrong')).rejects.toMatchObject({
      code: 'STREAM_NOT_AUTHORIZED',
    });
  });
  it('expires abandoned sessions and queues an idempotent STOP_STREAM', async () => {
    const current = await tenant('expire');
    const created = await service.create(
      current.context,
      current.camera.id,
      randomUUID(),
      metadata,
    );
    await prisma.streamSession.update({
      where: { id: created.session.id },
      data: { expiresAt: new Date(0) },
    });
    expect(await service.cleanup(current.organization.id)).toBe(1);
    expect(
      await prisma.streamSession.findUniqueOrThrow({ where: { id: created.session.id } }),
    ).toMatchObject({ status: 'EXPIRED', errorCode: 'STREAM_SESSION_EXPIRED' });
    expect(
      await prisma.gatewayCommand.count({
        where: { streamSessionId: created.session.id, type: 'STOP_STREAM' },
      }),
    ).toBe(1);
  });
  it('makes repeated user STOP safe without duplicate commands', async () => {
    const current = await tenant('stop');
    const created = await service.create(
      current.context,
      current.camera.id,
      randomUUID(),
      metadata,
    );
    await service.stop(current.context, created.session.id, metadata);
    const repeated = await service.stop(current.context, created.session.id, metadata);
    expect(JSON.stringify(repeated)).not.toMatch(/tokenHash|userId|idempotencyKey/);
    expect(
      await prisma.gatewayCommand.count({
        where: { streamSessionId: created.session.id, type: 'STOP_STREAM' },
      }),
    ).toBe(1);
  });
});
