import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CameraHealthService } from './camera-health.service';

const prisma = new PrismaClient();
const service = new CameraHealthService(prisma);
const organizations: string[] = [];

async function fixture(label: string) {
  const organization = await prisma.organization.create({
    data: {
      name: `Health ${label}`,
      slug: `health-${label}-${randomUUID().slice(0, 8)}`,
    },
  });
  organizations.push(organization.id);
  const gateway = await prisma.gateway.create({
    data: {
      organizationId: organization.id,
      name: `Gateway ${label}`,
      deviceId: randomUUID(),
      secretHash: 'test',
      status: 'ONLINE',
    },
  });
  const camera = await prisma.camera.create({
    data: {
      organizationId: organization.id,
      gatewayId: gateway.id,
      name: `Camera ${label}`,
      protocol: 'RTSP',
      connectionStatus: 'UNKNOWN',
    },
  });
  return {
    camera,
    auth: { organizationId: organization.id, gatewayId: gateway.id, deviceId: gateway.deviceId },
  };
}

const batch = (
  cameraId: string,
  sequence: number,
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'AUTHENTICATION_ERROR' = 'ONLINE',
) => ({
  messageId: randomUUID(),
  protocolVersion: '1' as const,
  entries: [
    {
      cameraId,
      generation: 1,
      sequence,
      observedAt: new Date().toISOString(),
      status,
      checks: {
        onvif:
          status === 'AUTHENTICATION_ERROR'
            ? ('AUTHENTICATION_ERROR' as const)
            : status === 'ONLINE'
              ? ('OK' as const)
              : ('FAILED' as const),
        rtsp: status === 'ONLINE' ? ('OK' as const) : ('FAILED' as const),
      },
      consecutiveFailures: status === 'ONLINE' ? 0 : sequence,
      ...(status === 'ONLINE'
        ? {}
        : {
            failureCode:
              status === 'AUTHENTICATION_ERROR' ? 'AUTHENTICATION_REJECTED' : 'HEALTH_CHECK_FAILED',
          }),
    },
  ],
});

beforeAll(() => prisma.$connect());
afterAll(async () => {
  await prisma.cameraEvent.deleteMany({ where: { organizationId: { in: organizations } } });
  await prisma.gatewayMessage.deleteMany({ where: { organizationId: { in: organizations } } });
  await prisma.camera.deleteMany({ where: { organizationId: { in: organizations } } });
  await prisma.gateway.deleteMany({ where: { organizationId: { in: organizations } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
  await prisma.$disconnect();
});

describe('camera operational health', () => {
  it('handles ONLINE → hysteresis/degraded → OFFLINE → ONLINE without event storms', async () => {
    const { camera, auth } = await fixture('transitions');
    await service.ingest(auth, batch(camera.id, 1, 'ONLINE'));
    await service.ingest(auth, batch(camera.id, 2, 'DEGRADED'));
    await service.ingest(auth, batch(camera.id, 3, 'DEGRADED'));
    await service.ingest(auth, batch(camera.id, 4, 'OFFLINE'));
    await service.ingest(auth, batch(camera.id, 5, 'OFFLINE'));
    await service.ingest(auth, batch(camera.id, 6, 'ONLINE'));
    const stored = await prisma.camera.findUniqueOrThrow({ where: { id: camera.id } });
    expect(stored.connectionStatus).toBe('ONLINE');
    expect(stored.lastSeenAt).not.toBeNull();
    expect(
      await prisma.cameraEvent.count({ where: { cameraId: camera.id, type: 'CAMERA_OFFLINE' } }),
    ).toBe(1);
    expect(
      await prisma.cameraEvent.count({ where: { cameraId: camera.id, type: 'CAMERA_ONLINE' } }),
    ).toBe(2);
  });

  it('rejects replay, out-of-order, cross-tenant spoofing and preserves auth failures', async () => {
    const first = await fixture('ordering');
    const second = await fixture('tenant');
    const newest = batch(first.camera.id, 8, 'AUTHENTICATION_ERROR');
    expect((await service.ingest(first.auth, newest)).updated).toBe(1);
    expect((await service.ingest(first.auth, newest)).duplicate).toBe(true);
    expect((await service.ingest(first.auth, batch(first.camera.id, 7, 'ONLINE'))).ignored).toBe(1);
    expect((await service.ingest(second.auth, batch(first.camera.id, 9, 'ONLINE'))).ignored).toBe(
      1,
    );
    expect(
      (await prisma.camera.findUniqueOrThrow({ where: { id: first.camera.id } })).connectionStatus,
    ).toBe('AUTHENTICATION_ERROR');
  });
});
