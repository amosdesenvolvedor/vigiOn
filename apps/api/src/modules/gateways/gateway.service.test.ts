import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GatewayService } from './gateway.service';
import { verifyGatewaySecret } from './gateway.secret';

const prisma = new PrismaClient();
const service = new GatewayService(prisma);
const suffix = randomUUID().slice(0, 8);
const organizationIds: string[] = [];
const metadata = { ipAddress: '127.0.0.1', userAgent: 'GatewayTest' };
async function tenant(label: string) {
  const organization = await prisma.organization.create({
    data: {
      name: `Gateway ${label}`,
      slug: `gateway-${label}-${suffix}`,
      resourceCounter: { create: {} },
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
      passwordHash: 'test',
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
      role: 'OWNER' as const,
    },
  };
}
async function paired(label: string) {
  const current = await tenant(label);
  const pairing = await service.generatePairing(current.context, metadata);
  const claimed = await service.claim(
    {
      pairingCode: pairing.pairingCode,
      name: `Edge ${label}`,
      version: '1.0.0',
      protocolVersion: '1',
    },
    metadata,
  );
  return {
    ...current,
    ...claimed,
    auth: {
      gatewayId: claimed.gateway.id,
      organizationId: current.organization.id,
      deviceId: claimed.gateway.deviceId,
    },
  };
}

beforeAll(() => prisma.$connect());
afterAll(async () => {
  await prisma.cameraEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.gatewayMessage.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.gatewayCommand.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.gatewayPairingCode.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.camera.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.gateway.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.resourceCounter.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.storageUsage.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organizationMembership.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await prisma.$disconnect();
});

describe('gateway pairing, communication and tenancy', () => {
  it('claims once, emits a permanent secret only once and stores only its hash', async () => {
    const current = await tenant('claim');
    const pairing = await service.generatePairing(current.context, metadata);
    const claimed = await service.claim(
      { pairingCode: pairing.pairingCode, name: 'Edge', version: '1.0.0', protocolVersion: '1' },
      metadata,
    );
    const stored = await prisma.gateway.findUniqueOrThrow({ where: { id: claimed.gateway.id } });
    expect(stored.secretHash).not.toContain(claimed.credential.secret);
    expect(verifyGatewaySecret(claimed.credential.secret, stored.secretHash)).toBe(true);
    await expect(
      service.claim(
        {
          pairingCode: pairing.pairingCode,
          name: 'Replay',
          version: '1.0.0',
          protocolVersion: '1',
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: 'PAIRING_CODE_INVALID' });
    const rotated = await service.rotateCredential(current.context, claimed.gateway.id, metadata);
    const afterRotation = await prisma.gateway.findUniqueOrThrow({
      where: { id: claimed.gateway.id },
    });
    expect(verifyGatewaySecret(claimed.credential.secret, afterRotation.secretHash)).toBe(false);
    expect(verifyGatewaySecret(rotated.secret, afterRotation.secretHash)).toBe(true);
    expect(afterRotation.status).toBe('UNKNOWN');
  });
  it('rejects invalid and expired pairing codes', async () => {
    await expect(
      service.claim(
        { pairingCode: 'VIGION-NOT-VALID-CODE', name: 'Edge', version: '1', protocolVersion: '1' },
        metadata,
      ),
    ).rejects.toMatchObject({ code: 'PAIRING_CODE_INVALID' });
    const current = await tenant('expired');
    const pairing = await service.generatePairing(current.context, metadata);
    await prisma.gatewayPairingCode.updateMany({
      where: { organizationId: current.organization.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      service.claim(
        { pairingCode: pairing.pairingCode, name: 'Edge', version: '1', protocolVersion: '1' },
        metadata,
      ),
    ).rejects.toMatchObject({ code: 'PAIRING_CODE_EXPIRED' });
  });
  it('updates heartbeat, detects duplicate messages and marks timed-out gateways offline', async () => {
    const current = await paired('heartbeat');
    const input = {
      messageId: randomUUID(),
      version: '1.1.0',
      protocolVersion: '1' as const,
      timestamp: new Date().toISOString(),
      uptime: 50,
      status: 'ONLINE' as const,
    };
    expect((await service.heartbeat(current.auth, input)).duplicate).toBe(false);
    expect((await service.heartbeat(current.auth, input)).duplicate).toBe(true);
    await prisma.gateway.update({
      where: { id: current.gateway.id },
      data: { lastSeenAt: new Date(0), status: 'ONLINE' },
    });
    expect((await service.list(current.context))[0]?.status).toBe('OFFLINE');
  });
  it('prevents cross-tenant viewing and camera association', async () => {
    const tenantA = await paired('tenant-a');
    const tenantB = await paired('tenant-b');
    const camera = await prisma.camera.create({
      data: { organizationId: tenantB.organization.id, name: 'B', protocol: 'RTSP' },
    });
    await expect(service.get(tenantA.context, tenantB.gateway.id)).rejects.toMatchObject({
      code: 'GATEWAY_NOT_FOUND',
    });
    await expect(
      service.associateCamera(tenantA.context, tenantA.gateway.id, camera.id, metadata),
    ).rejects.toMatchObject({ code: 'CAMERA_NOT_FOUND' });
  });
  it('associates, tests and acknowledges a camera idempotently', async () => {
    const current = await paired('commands');
    await service.heartbeat(current.auth, {
      messageId: randomUUID(),
      version: '1',
      protocolVersion: '1',
      timestamp: new Date().toISOString(),
      status: 'ONLINE',
    });
    const camera = await prisma.camera.create({
      data: { organizationId: current.organization.id, name: 'Local', protocol: 'ONVIF' },
    });
    await service.associateCamera(current.context, current.gateway.id, camera.id, metadata);
    const queued = await service.queueCameraTest(current.context, current.gateway.id, camera.id);
    const commands = await service.pollCommands(current.auth);
    expect(commands[0]?.commandId).toBe(queued.commandId);
    const ack = { messageId: randomUUID(), commandId: queued.commandId, status: 'SUCCESS' };
    expect((await service.acknowledge(current.auth, ack)).duplicate).toBe(false);
    expect((await service.acknowledge(current.auth, ack)).duplicate).toBe(true);
    expect(
      (await prisma.camera.findUniqueOrThrow({ where: { id: camera.id } })).connectionStatus,
    ).toBe('ONLINE');
    await service.dissociateCamera(current.context, current.gateway.id, camera.id, metadata);
    expect(
      (await prisma.camera.findUniqueOrThrow({ where: { id: camera.id } })).gatewayId,
    ).toBeNull();
  });
});
