import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { VerificationCredentialService } from './verification-credential.service';
import { CameraOnboardingCompletionService } from './completion.service';
import { QrAnalysisService } from './qr-analysis.service';
import { CameraDiscoveryService } from './discovery.service';
import { CameraVerificationService } from './verification.service';
import { GatewayService } from '../gateways/gateway.service';
import { CameraHealthService } from '../camera-health/camera-health.service';

const prisma = new PrismaClient();
const service = new CameraOnboardingCompletionService(prisma);
const ephemeral = new VerificationCredentialService();
const suffix = randomUUID().slice(0, 8);
const organizations: string[] = [];
const metadata = { ipAddress: '127.0.0.1', userAgent: 'CompletionTest' };

async function fixture(label: string, maxCameras = 5, serial = `${label}-serial`) {
  const organization = await prisma.organization.create({
    data: { name: `Completion ${label}`, slug: `completion-${label}-${suffix}` },
  });
  organizations.push(organization.id);
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      name: label,
      email: `${label}-${suffix}@completion.test`,
      normalizedEmail: `${label}-${suffix}@completion.test`,
      passwordHash: 'test',
      status: 'ACTIVE',
      role: 'OWNER',
    },
  });
  const membership = await prisma.organizationMembership.create({
    data: { organizationId: organization.id, userId: user.id, status: 'ACTIVE', role: 'OWNER' },
  });
  const plan = await prisma.plan.create({
    data: {
      name: `Completion ${label}`,
      slug: `completion-${label}-${suffix}`,
      code: `CMP-${label}-${suffix}`.slice(0, 32),
      maxCameras,
      maxUsers: 5,
      maxStorageBytes: 1_000_000n,
      retentionDays: 1,
      enabledFeatures: ['LIVE_VIEW'],
    },
  });
  await prisma.subscription.create({
    data: {
      organizationId: organization.id,
      planId: plan.id,
      status: 'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
    },
  });
  const pair = generateKeyPairSync('x25519');
  const gateway = await prisma.gateway.create({
    data: {
      organizationId: organization.id,
      name: `Gateway ${label}`,
      deviceId: randomUUID(),
      secretHash: 'test',
      status: 'ONLINE',
      version: '0.3.0',
      protocolVersion: '1',
      encryptionPublicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    },
  });
  const discovery = await prisma.cameraDiscoverySession.create({
    data: {
      organizationId: organization.id,
      gatewayId: gateway.id,
      userId: user.id,
      expectedModel: 'C200',
      expectedIdentifiers: [{ type: 'SERIAL_NUMBER', value: serial, confidence: 'EXACT' }],
      status: 'COMPLETED',
      expiresAt: new Date(Date.now() + 600_000),
    },
  });
  const candidate = await prisma.cameraDiscoveryCandidate.create({
    data: {
      organizationId: organization.id,
      sessionId: discovery.id,
      fingerprint: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64),
      networkAddress: '192.168.1.20',
      servicePort: 80,
      endpointReference: `urn:uuid:${randomUUID()}`,
      manufacturer: 'TP-Link',
      model: 'C200',
      classification: 'CAMERA_CANDIDATE',
      confidence: 'EXACT',
    },
  });
  await prisma.cameraDiscoverySession.update({
    where: { id: discovery.id },
    data: { confirmedCandidateId: candidate.id, completedAt: new Date() },
  });
  const verification = await prisma.cameraVerificationSession.create({
    data: {
      organizationId: organization.id,
      gatewayId: gateway.id,
      userId: user.id,
      discoverySessionId: discovery.id,
      candidateId: candidate.id,
      status: 'COMPLETED',
      result: 'VERIFIED',
      credentialsConfigured: true,
      confirmedAt: new Date(),
      completedAt: new Date(),
      expiresAt: new Date(Date.now() + 300_000),
      detectedIdentity: { manufacturer: 'TP-Link', model: 'C200', serialNumber: serial },
      detectedCapabilities: { onvif: true, rtsp: true, ptz: true },
      evidence: { onvifDeviceInformation: true, rtspHandshake: true },
    },
  });
  await ephemeral.store(prisma, organization.id, verification.id, verification.expiresAt, {
    username: 'admin',
    password: `secret-${label}`,
  });
  const context = {
    organizationId: organization.id,
    userId: user.id,
    membershipId: membership.id,
    role: 'OWNER' as const,
  };
  return { organization, user, gateway, discovery, candidate, verification, context, plan };
}

beforeAll(() => prisma.$connect());
afterAll(async () => {
  await prisma.cameraEvent.deleteMany({ where: { organizationId: { in: organizations } } });
  await prisma.gatewayMessage.deleteMany({ where: { organizationId: { in: organizations } } });
  await prisma.gatewayCommand.deleteMany({ where: { organizationId: { in: organizations } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizations } } });
  await prisma.cameraIdentifier.deleteMany({ where: { organizationId: { in: organizations } } });
  await prisma.camera.deleteMany({ where: { organizationId: { in: organizations } } });
  await prisma.cameraVerificationCredential.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await prisma.cameraVerificationSession.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await prisma.cameraDiscoveryCandidate.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await prisma.cameraDiscoverySession.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await prisma.gateway.deleteMany({ where: { organizationId: { in: organizations } } });
  await prisma.resourceCounter.deleteMany({ where: { organizationId: { in: organizations } } });
  await prisma.subscription.deleteMany({ where: { organizationId: { in: organizations } } });
  await prisma.organizationMembership.deleteMany({
    where: { organizationId: { in: organizations } },
  });
  await prisma.user.deleteMany({ where: { organizationId: { in: organizations } } });
  await prisma.plan.deleteMany({ where: { slug: { startsWith: 'completion-' } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
  await prisma.$disconnect();
});

describe('camera onboarding completion', () => {
  it('creates once, consumes verification, promotes credentials and queues a sanitized registration', async () => {
    const current = await fixture('success');
    const camera = await service.complete(
      current.context,
      { verificationSessionId: current.verification.id, name: 'Entrada', location: 'Recepção' },
      randomUUID(),
      metadata,
    );
    expect(camera).toMatchObject({
      name: 'Entrada',
      creationSource: 'ONBOARDING',
      gatewayId: current.gateway.id,
      connectionStatus: 'UNKNOWN',
      administrativeStatus: 'ACTIVE',
    });
    expect(JSON.stringify(camera)).not.toContain('secret-success');
    expect(await prisma.cameraCredential.count({ where: { cameraId: camera.id } })).toBe(1);
    expect(
      await prisma.cameraVerificationCredential.count({
        where: { verificationSessionId: current.verification.id },
      }),
    ).toBe(0);
    expect(
      await prisma.cameraVerificationSession.findUniqueOrThrow({
        where: { id: current.verification.id },
      }),
    ).toMatchObject({ status: 'CONSUMED', consumedAt: expect.any(Date) });
    const command = await prisma.gatewayCommand.findFirstOrThrow({
      where: { cameraId: camera.id, type: 'CAMERA_REGISTER' },
    });
    expect(JSON.stringify(command.payload)).not.toContain('secret-success');
    expect(command.payload).toMatchObject({ cameraId: camera.id });
    await new GatewayService(prisma).acknowledge(
      {
        gatewayId: current.gateway.id,
        organizationId: current.organization.id,
        deviceId: current.gateway.deviceId,
      },
      { messageId: randomUUID(), commandId: command.commandId, status: 'SUCCESS' },
    );
    expect(
      await prisma.gatewayCommand.findUniqueOrThrow({ where: { id: command.id } }),
    ).toMatchObject({ status: 'SUCCEEDED', payload: null });
    expect(await prisma.camera.findUniqueOrThrow({ where: { id: camera.id } })).toMatchObject({
      connectionStatus: 'UNKNOWN',
    });
  });

  it('is idempotent under concurrent completion of the same verification', async () => {
    const current = await fixture('idempotent');
    const calls = await Promise.all([
      service.complete(
        current.context,
        { verificationSessionId: current.verification.id, name: 'Porta' },
        randomUUID(),
        metadata,
      ),
      service.complete(
        current.context,
        { verificationSessionId: current.verification.id, name: 'Porta' },
        randomUUID(),
        metadata,
      ),
    ]);
    expect(new Set(calls.map((camera) => camera.id)).size).toBe(1);
    expect(
      await prisma.camera.count({ where: { verificationSessionId: current.verification.id } }),
    ).toBe(1);
    expect(
      await prisma.gatewayCommand.count({
        where: { cameraId: calls[0]!.id, type: 'CAMERA_REGISTER' },
      }),
    ).toBe(1);
  });

  it('allows only one concurrent creation at the final plan slot', async () => {
    const first = await fixture('slot', 1, 'slot-a');
    const secondDiscovery = await prisma.cameraDiscoverySession.create({
      data: {
        organizationId: first.organization.id,
        gatewayId: first.gateway.id,
        userId: first.user.id,
        expectedModel: 'C210',
        status: 'COMPLETED',
        expectedIdentifiers: [{ type: 'SERIAL_NUMBER', value: 'slot-b', confidence: 'EXACT' }],
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    const secondCandidate = await prisma.cameraDiscoveryCandidate.create({
      data: {
        organizationId: first.organization.id,
        sessionId: secondDiscovery.id,
        fingerprint: 'b'.repeat(64),
        networkAddress: '192.168.1.21',
        servicePort: 80,
        endpointReference: `urn:uuid:${randomUUID()}`,
        model: 'C210',
        classification: 'CAMERA_CANDIDATE',
        confidence: 'EXACT',
      },
    });
    await prisma.cameraDiscoverySession.update({
      where: { id: secondDiscovery.id },
      data: { confirmedCandidateId: secondCandidate.id },
    });
    const second = await prisma.cameraVerificationSession.create({
      data: {
        organizationId: first.organization.id,
        gatewayId: first.gateway.id,
        userId: first.user.id,
        discoverySessionId: secondDiscovery.id,
        candidateId: secondCandidate.id,
        status: 'COMPLETED',
        result: 'VERIFIED',
        credentialsConfigured: true,
        confirmedAt: new Date(),
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + 300_000),
        detectedIdentity: { model: 'C210', serialNumber: 'slot-b' },
        detectedCapabilities: { onvif: true, rtsp: true },
      },
    });
    await ephemeral.store(prisma, first.organization.id, second.id, second.expiresAt, {
      username: 'a',
      password: 'b',
    });
    const settled = await Promise.allSettled([
      service.complete(
        first.context,
        { verificationSessionId: first.verification.id, name: 'A' },
        randomUUID(),
        metadata,
      ),
      service.complete(
        first.context,
        { verificationSessionId: second.id, name: 'B' },
        randomUUID(),
        metadata,
      ),
    ]);
    expect(settled.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
    expect(await prisma.camera.count({ where: { organizationId: first.organization.id } })).toBe(1);
  });

  it('blocks another tenant, expired and unverified sessions', async () => {
    const owner = await fixture('owner');
    const stranger = await fixture('stranger');
    await expect(
      service.complete(
        stranger.context,
        { verificationSessionId: owner.verification.id, name: 'Invasão' },
        randomUUID(),
        metadata,
      ),
    ).rejects.toMatchObject({ code: 'VERIFICATION_NOT_FOUND' });
    await prisma.cameraVerificationSession.update({
      where: { id: owner.verification.id },
      data: { status: 'FAILED', result: 'AUTHENTICATION_FAILED' },
    });
    await expect(
      service.complete(
        owner.context,
        { verificationSessionId: owner.verification.id, name: 'Falha' },
        randomUUID(),
        metadata,
      ),
    ).rejects.toMatchObject({ code: 'VERIFICATION_NOT_COMPLETED' });
  });

  it('runs the automated QR → discovery → verification → Camera → Gateway → health flow 1→7', async () => {
    const current = await fixture('e2e');
    await prisma.cameraVerificationCredential.deleteMany({
      where: { verificationSessionId: current.verification.id },
    });
    await prisma.cameraVerificationSession.delete({ where: { id: current.verification.id } });
    await prisma.cameraDiscoveryCandidate.delete({ where: { id: current.candidate.id } });
    await prisma.cameraDiscoverySession.delete({ where: { id: current.discovery.id } });
    const qr = await new QrAnalysisService(prisma).analyze(
      'manufacturer=TP-Link;model=C200;serial=e2e-serial',
    );
    expect(qr.modelCandidate?.value).toBe('C200');
    const discoveryService = new CameraDiscoveryService(prisma);
    const discovery = await discoveryService.start(
      current.context,
      {
        gatewayId: current.gateway.id,
        expectedManufacturer: qr.manufacturerCandidate?.value,
        expectedModel: qr.modelCandidate?.value,
        identifiers: qr.identifiers.flatMap((item) =>
          ['SERIAL_NUMBER', 'UID', 'DEVICE_ID', 'MAC_ADDRESS'].includes(item.type)
            ? [
                {
                  type: item.type as 'SERIAL_NUMBER' | 'UID' | 'DEVICE_ID' | 'MAC_ADDRESS',
                  value: item.value,
                  confidence: 'EXACT' as const,
                },
              ]
            : [],
        ),
      },
      metadata,
    );
    const discoveryCommand = await prisma.gatewayCommand.findFirstOrThrow({
      where: { organizationId: current.organization.id, type: 'CAMERA_DISCOVERY_START' },
      orderBy: { createdAt: 'desc' },
    });
    await discoveryService.ingest(
      {
        gatewayId: current.gateway.id,
        organizationId: current.organization.id,
        deviceId: current.gateway.deviceId,
      },
      {
        messageId: randomUUID(),
        commandId: discoveryCommand.commandId,
        sessionId: discovery.id,
        protocolVersion: '1',
        status: 'COMPLETED',
        candidates: [
          {
            networkAddress: '192.168.1.50',
            servicePort: 80,
            endpointReference: `urn:uuid:${randomUUID()}`,
            manufacturer: 'TP-Link',
            model: 'C200',
            authenticationRequired: true,
            evidence: 'ONVIF_WS_DISCOVERY',
          },
        ],
      },
    );
    const found = (await discoveryService.view(current.context, discovery.id)).candidates[0]!;
    await discoveryService.confirm(current.context, discovery.id, found.id, metadata);
    const verificationService = new CameraVerificationService(prisma);
    const verification = await verificationService.start(
      current.context,
      { discoverySessionId: discovery.id, candidateId: found.id },
      metadata,
    );
    await verificationService.provideCredentials(
      current.context,
      verification.id,
      { username: 'admin', password: 'e2e-secret' },
      metadata,
    );
    const verificationCommand = await prisma.gatewayCommand.findFirstOrThrow({
      where: { organizationId: current.organization.id, type: 'CAMERA_VERIFICATION_START' },
      orderBy: { createdAt: 'desc' },
    });
    await verificationService.ingest(
      {
        gatewayId: current.gateway.id,
        organizationId: current.organization.id,
        deviceId: current.gateway.deviceId,
      },
      {
        messageId: randomUUID(),
        commandId: verificationCommand.commandId,
        verificationSessionId: verification.id,
        protocolVersion: '1',
        result: 'VERIFIED',
        identity: { manufacturer: 'TP-Link', model: 'C200', serialNumber: 'e2e-serial' },
        capabilities: {
          onvif: true,
          media: true,
          media2: false,
          rtsp: true,
          ptz: true,
          events: true,
          imaging: true,
          profiles: 1,
          codecs: ['H264'],
          tracks: 1,
        },
        stream: { port: 554, path: '/stream1', transport: 'tcp' },
        evidence: {
          onvifDeviceInformation: true,
          onvifCapabilities: true,
          mediaProfiles: true,
          streamUriValidated: true,
          rtspHandshake: true,
        },
      },
    );
    const camera = await service.complete(
      current.context,
      { verificationSessionId: verification.id, name: 'E2E Entrada' },
      randomUUID(),
      metadata,
    );
    expect(camera).toMatchObject({
      creationSource: 'ONBOARDING',
      protocol: 'ONVIF',
      connectionStatus: 'UNKNOWN',
      gatewayId: current.gateway.id,
    });
    const register = await prisma.gatewayCommand.findFirstOrThrow({
      where: {
        cameraId: camera.id,
        type: 'CAMERA_REGISTER',
      },
    });
    const gatewayAuth = {
      gatewayId: current.gateway.id,
      organizationId: current.organization.id,
      deviceId: current.gateway.deviceId,
    };
    await new GatewayService(prisma).acknowledge(gatewayAuth, {
      messageId: randomUUID(),
      commandId: register.commandId,
      status: 'SUCCESS',
    });
    await new CameraHealthService(prisma).ingest(gatewayAuth, {
      messageId: randomUUID(),
      protocolVersion: '1',
      entries: [
        {
          cameraId: camera.id,
          generation: 1,
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
});
