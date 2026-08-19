import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CameraDiscoveryService } from './discovery.service';

const prisma = new PrismaClient();
const service = new CameraDiscoveryService(prisma);
const suffix = randomUUID().slice(0, 8);
const organizationIds: string[] = [];
const metadata = { ipAddress: '127.0.0.1', userAgent: 'DiscoveryTest' };

async function tenant(label: string, status: 'ONLINE' | 'OFFLINE' = 'ONLINE') {
  const organization = await prisma.organization.create({
    data: { name: `Discovery ${label}`, slug: `discovery-${label}-${suffix}` },
  });
  organizationIds.push(organization.id);
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      name: label,
      email: `${label}-${suffix}@test.invalid`,
      normalizedEmail: `${label}-${suffix}@test.invalid`,
      passwordHash: 'test',
      status: 'ACTIVE',
      role: 'OWNER',
    },
  });
  const membership = await prisma.organizationMembership.create({
    data: { organizationId: organization.id, userId: user.id, role: 'OWNER', status: 'ACTIVE' },
  });
  const gateway = await prisma.gateway.create({
    data: {
      organizationId: organization.id,
      name: `Gateway ${label}`,
      deviceId: randomUUID(),
      secretHash: 'test-only',
      status,
      protocolVersion: '1',
      lastSeenAt: new Date(),
    },
  });
  return {
    organization,
    user,
    gateway,
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
  await prisma.gatewayMessage.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.cameraDiscoveryCandidate.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.cameraDiscoverySession.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.gatewayCommand.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.camera.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.gateway.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organizationMembership.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await prisma.$disconnect();
});

describe('tenant-scoped camera discovery', () => {
  it('rejects an offline and another tenant gateway', async () => {
    const owner = await tenant('owner');
    const offline = await tenant('offline', 'OFFLINE');
    await expect(
      service.start(
        owner.context,
        { gatewayId: offline.gateway.id, expectedModel: 'C200', identifiers: [] },
        metadata,
      ),
    ).rejects.toMatchObject({ code: 'GATEWAY_NOT_FOUND' });
    await expect(
      service.start(
        offline.context,
        { gatewayId: offline.gateway.id, expectedModel: 'C200', identifiers: [] },
        metadata,
      ),
    ).rejects.toMatchObject({ code: 'GATEWAY_OFFLINE' });
  });

  it('dispatches, correlates multiple identical models and deduplicates gateway results', async () => {
    const current = await tenant('multiple');
    const discovery = await service.start(
      current.context,
      {
        gatewayId: current.gateway.id,
        expectedManufacturer: 'TP-Link',
        expectedModel: 'C200',
        identifiers: [],
      },
      metadata,
    );
    const command = await prisma.gatewayCommand.findFirstOrThrow({
      where: {
        organizationId: current.organization.id,
        type: 'CAMERA_DISCOVERY_START',
        payload: { path: '$.sessionId', equals: discovery.id },
      },
    });
    const input = {
      messageId: randomUUID(),
      commandId: command.commandId,
      sessionId: discovery.id,
      protocolVersion: '1' as const,
      status: 'RESULTS' as const,
      candidates: [
        {
          networkAddress: '192.168.1.21',
          servicePort: 80,
          endpointReference: 'urn:uuid:a',
          manufacturer: 'TP-Link',
          model: 'C200',
          authenticationRequired: true,
          evidence: 'ONVIF_WS_DISCOVERY' as const,
        },
        {
          networkAddress: '192.168.1.34',
          servicePort: 80,
          endpointReference: 'urn:uuid:b',
          manufacturer: 'TP-Link',
          model: 'C200',
          authenticationRequired: false,
          evidence: 'ONVIF_WS_DISCOVERY' as const,
        },
      ],
    };
    await expect(
      service.ingest(
        {
          gatewayId: current.gateway.id,
          organizationId: current.organization.id,
          deviceId: current.gateway.deviceId,
        },
        input,
      ),
    ).resolves.toEqual({ accepted: true, duplicate: false });
    await expect(
      service.ingest(
        {
          gatewayId: current.gateway.id,
          organizationId: current.organization.id,
          deviceId: current.gateway.deviceId,
        },
        input,
      ),
    ).resolves.toEqual({ accepted: true, duplicate: true });
    const result = await service.view(current.context, discovery.id);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates.every((candidate) => candidate.confidence === 'HIGH')).toBe(true);
  });

  it('supports idempotent cancel and blocks cross-tenant session access', async () => {
    const current = await tenant('cancel');
    const stranger = await tenant('stranger');
    const discovery = await service.start(
      current.context,
      { gatewayId: current.gateway.id, expectedModel: 'C200', identifiers: [] },
      metadata,
    );
    await expect(service.view(stranger.context, discovery.id)).rejects.toMatchObject({
      code: 'DISCOVERY_NOT_FOUND',
    });
    expect((await service.cancel(current.context, discovery.id, metadata)).status).toBe('CANCELED');
    expect((await service.cancel(current.context, discovery.id, metadata)).status).toBe('CANCELED');
  });

  it('keeps MEDIUM, LOW and UNKNOWN candidates unconfirmed', async () => {
    const current = await tenant('confidence');
    const discovery = await service.start(
      current.context,
      {
        gatewayId: current.gateway.id,
        expectedManufacturer: 'TP-Link',
        expectedModel: 'C200',
        identifiers: [],
      },
      metadata,
    );
    const command = await prisma.gatewayCommand.findFirstOrThrow({
      where: {
        organizationId: current.organization.id,
        type: 'CAMERA_DISCOVERY_START',
        payload: { path: '$.sessionId', equals: discovery.id },
      },
    });
    await service.ingest(
      {
        gatewayId: current.gateway.id,
        organizationId: current.organization.id,
        deviceId: current.gateway.deviceId,
      },
      {
        messageId: randomUUID(),
        commandId: command.commandId,
        sessionId: discovery.id,
        protocolVersion: '1',
        status: 'RESULTS',
        candidates: [
          {
            networkAddress: '192.168.2.20',
            servicePort: 80,
            model: 'C200',
            authenticationRequired: false,
            evidence: 'ONVIF_WS_DISCOVERY',
          },
          {
            networkAddress: '192.168.2.21',
            servicePort: 80,
            manufacturer: 'TP-Link',
            authenticationRequired: false,
            evidence: 'ONVIF_WS_DISCOVERY',
          },
          {
            networkAddress: '192.168.2.22',
            servicePort: 80,
            authenticationRequired: false,
            evidence: 'ONVIF_WS_DISCOVERY',
          },
        ],
      },
    );
    expect(
      (await service.view(current.context, discovery.id)).candidates
        .map((candidate) => candidate.confidence)
        .sort(),
    ).toEqual(['LOW', 'MEDIUM', 'UNKNOWN']);
  });

  it('expires sessions, rejects late results and cleans old ephemeral state', async () => {
    const current = await tenant('expired');
    const discovery = await service.start(
      current.context,
      { gatewayId: current.gateway.id, expectedModel: 'C200', identifiers: [] },
      metadata,
    );
    const command = await prisma.gatewayCommand.findFirstOrThrow({
      where: {
        organizationId: current.organization.id,
        type: 'CAMERA_DISCOVERY_START',
        payload: { path: '$.sessionId', equals: discovery.id },
      },
    });
    await prisma.cameraDiscoverySession.update({
      where: { id: discovery.id },
      data: { expiresAt: new Date(Date.now() - 25 * 60 * 60_000) },
    });
    expect((await service.view(current.context, discovery.id)).status).toBe('EXPIRED');
    await expect(
      service.ingest(
        {
          gatewayId: current.gateway.id,
          organizationId: current.organization.id,
          deviceId: current.gateway.deviceId,
        },
        {
          messageId: randomUUID(),
          commandId: command.commandId,
          sessionId: discovery.id,
          protocolVersion: '1',
          status: 'COMPLETED',
          candidates: [],
        },
      ),
    ).resolves.toEqual({ accepted: false, late: true });
    await service.cleanup();
    await expect(service.view(current.context, discovery.id)).rejects.toMatchObject({
      code: 'DISCOVERY_NOT_FOUND',
    });
  });

  it('marks a strong endpoint duplicate as already registered and refuses confirmation', async () => {
    const current = await tenant('duplicate');
    await prisma.camera.create({
      data: {
        organizationId: current.organization.id,
        name: 'Existing',
        identifier: 'urn:uuid:existing',
        protocol: 'ONVIF',
      },
    });
    const discovery = await service.start(
      current.context,
      {
        gatewayId: current.gateway.id,
        expectedModel: 'C200',
        identifiers: [
          { type: 'ONVIF_ENDPOINT_REFERENCE', value: 'urn:uuid:existing', confidence: 'EXACT' },
        ],
      },
      metadata,
    );
    const command = await prisma.gatewayCommand.findFirstOrThrow({
      where: {
        organizationId: current.organization.id,
        type: 'CAMERA_DISCOVERY_START',
        payload: { path: '$.sessionId', equals: discovery.id },
      },
    });
    await service.ingest(
      {
        gatewayId: current.gateway.id,
        organizationId: current.organization.id,
        deviceId: current.gateway.deviceId,
      },
      {
        messageId: randomUUID(),
        commandId: command.commandId,
        sessionId: discovery.id,
        protocolVersion: '1',
        status: 'COMPLETED',
        candidates: [
          {
            networkAddress: '10.0.0.20',
            servicePort: 80,
            endpointReference: 'urn:uuid:existing',
            model: 'C200',
            authenticationRequired: false,
            evidence: 'ONVIF_WS_DISCOVERY',
          },
        ],
      },
    );
    const result = await service.view(current.context, discovery.id);
    expect(result.candidates[0]).toMatchObject({ confidence: 'EXACT', alreadyRegistered: true });
    await expect(
      service.confirm(current.context, discovery.id, result.candidates[0]!.id, metadata),
    ).rejects.toMatchObject({ code: 'ALREADY_REGISTERED' });
  });
});
