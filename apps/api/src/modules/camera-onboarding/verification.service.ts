import { randomUUID } from 'node:crypto';
import { Prisma, type CameraVerificationResult, type PrismaClient } from '@prisma/client';
import { AuthError } from '../auth/auth.errors';
import type { RequestMetadata } from '../auth/auth.types';
import type { TenantContext } from '../tenancy/tenant-context';
import { realtimeService } from '../realtime/realtime.service';
import { encryptVerificationCredentials } from '../streams/stream-envelope';
import type { GatewayVerificationResult } from './verification.schemas';
import { VerificationCredentialService } from './verification-credential.service';

const SESSION_TTL_MS = 5 * 60_000;
const COMMAND_TTL_MS = 45_000;
const fail = (status: number, code: string, message: string) =>
  new AuthError(status, code, message);
const normalize = (value?: string | null) =>
  value?.normalize('NFKC').trim().replace(/[^a-zA-Z0-9]+/g, '').toLowerCase() ?? '';
const gatewaySupportsVerification = (version?: string | null) => {
  const [major = 0, minor = 0] = (version ?? '').split('.').map(Number);
  return major > 0 || minor >= 2;
};

export class CameraVerificationService {
  private readonly ephemeralCredentials = new VerificationCredentialService();
  constructor(private readonly prisma: PrismaClient) {}

  async start(
    context: TenantContext,
    input: { discoverySessionId: string; candidateId: string },
    metadata: RequestMetadata,
  ) {
    await this.cleanup();
    const discovery = await this.prisma.cameraDiscoverySession.findFirst({
      where: {
        id: input.discoverySessionId,
        organizationId: context.organizationId,
        confirmedCandidateId: input.candidateId,
        status: 'COMPLETED',
      },
      include: {
        gateway: true,
        candidates: { where: { id: input.candidateId } },
      },
    });
    const candidate = discovery?.candidates[0];
    if (!discovery || !candidate)
      throw fail(409, 'CANDIDATE_NOT_CONFIRMED', 'Confirm the discovered camera before verification');
    if (candidate.alreadyRegistered)
      throw fail(409, 'ALREADY_REGISTERED', 'Camera is already registered');
    if (discovery.gateway.status !== 'ONLINE')
      throw fail(409, 'GATEWAY_OFFLINE', 'Gateway is offline');
    if (!gatewaySupportsVerification(discovery.gateway.version))
      throw fail(409, 'GATEWAY_UPDATE_REQUIRED', 'Gateway must support camera verification');

    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    const session = await this.prisma.cameraVerificationSession.create({
      data: {
        organizationId: context.organizationId,
        gatewayId: discovery.gatewayId,
        userId: context.userId,
        discoverySessionId: discovery.id,
        candidateId: candidate.id,
        catalogVariantId: discovery.catalogVariantId,
        status: 'WAITING_FOR_CREDENTIALS',
        confirmedAt: new Date(),
        expiresAt,
      },
    });
    await this.audit(context, metadata, 'CAMERA_VERIFICATION_STARTED', session.id, {
      gatewayId: discovery.gatewayId,
      candidateId: candidate.id,
    });
    return this.view(context, session.id);
  }

  async provideCredentials(
    context: TenantContext,
    id: string,
    credentials: { username: string; password: string },
    metadata: RequestMetadata,
  ) {
    const session = await this.owned(context, id);
    if (session.expiresAt <= new Date()) throw fail(410, 'VERIFICATION_EXPIRED', 'Verification expired');
    if (!['PENDING', 'WAITING_FOR_CREDENTIALS', 'FAILED'].includes(session.status))
      throw fail(409, 'VERIFICATION_NOT_WAITING', 'Verification is not waiting for credentials');
    const recentAttempts = await this.prisma.cameraVerificationSession.count({
      where: {
        organizationId: context.organizationId,
        gatewayId: session.gatewayId,
        candidateId: session.candidateId,
        userId: context.userId,
        credentialsConfigured: true,
        updatedAt: { gte: new Date(Date.now() - 15 * 60_000) },
      },
    });
    if (recentAttempts >= 5)
      throw fail(429, 'VERIFICATION_ATTEMPTS_LIMIT', 'Wait before trying credentials again');
    const gateway = await this.prisma.gateway.findFirst({
      where: { id: session.gatewayId, organizationId: context.organizationId, status: 'ONLINE' },
      select: { encryptionPublicKey: true, version: true },
    });
    if (!gateway?.encryptionPublicKey)
      throw fail(409, 'GATEWAY_ENCRYPTION_UNAVAILABLE', 'Gateway must reconnect before verification');
    if (!gatewaySupportsVerification(gateway.version))
      throw fail(409, 'GATEWAY_UPDATE_REQUIRED', 'Gateway must support camera verification');
    const candidate = await this.prisma.cameraDiscoveryCandidate.findFirstOrThrow({
      where: { id: session.candidateId, organizationId: context.organizationId },
      select: { networkAddress: true, servicePort: true },
    });
    const commandId = randomUUID();
    const encryptedCredentials = encryptVerificationCredentials(gateway.encryptionPublicKey, credentials);
    await this.prisma.$transaction(async (tx) => {
      await tx.cameraVerificationSession.update({
        where: { id },
        data: {
          status: 'DISPATCHED',
          result: null,
          credentialsConfigured: true,
          commandId,
          startedAt: new Date(),
          completedAt: null,
          errorCode: null,
        },
      });
      await this.ephemeralCredentials.store(
        tx,
        context.organizationId,
        id,
        session.expiresAt,
        credentials,
      );
      await tx.gatewayCommand.create({
        data: {
          organizationId: context.organizationId,
          gatewayId: session.gatewayId,
          commandId,
          type: 'CAMERA_VERIFICATION_START',
          payload: {
            verificationSessionId: id,
            target: { address: candidate.networkAddress, port: candidate.servicePort },
            encryptedCredentials: { ...encryptedCredentials },
            protocolVersion: '1',
            timeoutSeconds: 20,
          },
          expiresAt: new Date(Date.now() + COMMAND_TTL_MS),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: 'CAMERA_VERIFICATION_CREDENTIALS_SUBMITTED',
          entityType: 'CameraVerificationSession',
          entityId: id,
          metadata: { gatewayId: session.gatewayId },
          ...metadata,
        },
      });
    });
    realtimeService.publish(context.organizationId, 'CAMERA_VERIFICATION_CHANGED', id);
    return this.view(context, id);
  }

  async view(context: TenantContext, id: string) {
    await this.expire(id, context.organizationId);
    const session = await this.prisma.cameraVerificationSession.findFirst({
      where: { id, organizationId: context.organizationId },
      select: {
        id: true, gatewayId: true, discoverySessionId: true, candidateId: true, status: true,
        result: true, detectedIdentity: true, detectedCapabilities: true, evidence: true,
        credentialsConfigured: true, errorCode: true, expiresAt: true, completedAt: true,
      },
    });
    if (!session) throw fail(404, 'VERIFICATION_NOT_FOUND', 'Verification not found');
    return session;
  }

  async cancel(context: TenantContext, id: string, metadata: RequestMetadata) {
    const session = await this.owned(context, id);
    if (['COMPLETED', 'CONSUMED', 'CANCELED', 'EXPIRED'].includes(session.status)) return this.view(context, id);
    const commandId = randomUUID();
    await this.prisma.$transaction([
      this.prisma.cameraVerificationSession.update({
        where: { id }, data: { status: 'CANCELED', result: 'CANCELED', completedAt: new Date() },
      }),
      this.prisma.gatewayCommand.updateMany({
        where: { commandId: session.commandId ?? '', organizationId: context.organizationId },
        data: { payload: Prisma.JsonNull, status: 'FAILED', completedAt: new Date() },
      }),
      this.prisma.cameraVerificationCredential.deleteMany({
        where: { organizationId: context.organizationId, verificationSessionId: id },
      }),
      this.prisma.gatewayCommand.create({
        data: {
          organizationId: context.organizationId, gatewayId: session.gatewayId, commandId,
          type: 'CAMERA_VERIFICATION_CANCEL', payload: { verificationSessionId: id, protocolVersion: '1' },
          expiresAt: new Date(Date.now() + 60_000),
        },
      }),
      this.prisma.auditLog.create({
        data: { organizationId: context.organizationId, actorUserId: context.userId,
          action: 'CAMERA_VERIFICATION_CANCELED', entityType: 'CameraVerificationSession', entityId: id, ...metadata },
      }),
    ]);
    realtimeService.publish(context.organizationId, 'CAMERA_VERIFICATION_CHANGED', id);
    return this.view(context, id);
  }

  async ingest(auth: NonNullable<Express.Request['gatewayAuth']>, input: GatewayVerificationResult) {
    try {
      await this.prisma.gatewayMessage.create({
        data: { organizationId: auth.organizationId, gatewayId: auth.gatewayId,
          messageId: input.messageId, type: 'CAMERA_VERIFICATION_RESULT' },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        return { accepted: true, duplicate: true };
      throw error;
    }
    const session = await this.prisma.cameraVerificationSession.findFirst({
      where: { id: input.verificationSessionId, organizationId: auth.organizationId,
        gatewayId: auth.gatewayId, commandId: input.commandId },
      include: { discoverySession: true },
    });
    if (!session) throw fail(404, 'VERIFICATION_NOT_FOUND', 'Verification not found');
    const command = await this.prisma.gatewayCommand.findFirst({
      where: { commandId: input.commandId, organizationId: auth.organizationId,
        gatewayId: auth.gatewayId, type: 'CAMERA_VERIFICATION_START' },
    });
    if (!command) throw fail(404, 'COMMAND_NOT_FOUND', 'Verification command not found');
    if (session.expiresAt <= new Date() || ['CANCELED', 'EXPIRED'].includes(session.status))
      return { accepted: false, late: true };

    let result: CameraVerificationResult = input.result;
    const expectedModel = normalize(session.discoverySession.expectedModel);
    const detectedModel = normalize(input.identity?.model);
    if (expectedModel && detectedModel && expectedModel !== detectedModel) result = 'MODEL_MISMATCH';
    const successful = ['VERIFIED', 'PARTIALLY_VERIFIED'].includes(result);
    await this.prisma.$transaction([
      this.prisma.cameraVerificationSession.update({
        where: { id: session.id },
        data: {
          status: successful ? 'COMPLETED' : 'FAILED', result,
          detectedIdentity: input.identity ?? Prisma.JsonNull,
          detectedCapabilities: input.capabilities ?? Prisma.JsonNull,
          verifiedStream: input.stream ?? Prisma.JsonNull,
          evidence: input.evidence, errorCode: input.errorCode ?? null, completedAt: new Date(),
        },
      }),
      this.prisma.gatewayCommand.update({
        where: { id: command.id },
        data: { payload: Prisma.JsonNull, result: { result },
          status: successful ? 'SUCCEEDED' : 'FAILED', completedAt: new Date() },
      }),
    ]);
    realtimeService.publish(auth.organizationId, 'CAMERA_VERIFICATION_CHANGED', session.id);
    return { accepted: true, duplicate: false };
  }

  async cleanup() {
    const now = new Date();
    await this.prisma.cameraVerificationCredential.deleteMany({ where: { expiresAt: { lte: now } } });
    const expired = await this.prisma.cameraVerificationSession.findMany({
      where: { expiresAt: { lte: now }, status: { notIn: ['COMPLETED', 'CONSUMED', 'CANCELED', 'EXPIRED'] } },
      select: { id: true, commandId: true }, take: 100,
    });
    if (!expired.length) return;
    await this.prisma.$transaction([
      this.prisma.cameraVerificationSession.updateMany({
        where: { id: { in: expired.map((item) => item.id) } },
        data: { status: 'EXPIRED', completedAt: now, errorCode: 'VERIFICATION_EXPIRED' },
      }),
      this.prisma.gatewayCommand.updateMany({
        where: { commandId: { in: expired.flatMap((item) => item.commandId ? [item.commandId] : []) } },
        data: { payload: Prisma.JsonNull, status: 'EXPIRED', completedAt: now },
      }),
      this.prisma.cameraVerificationCredential.deleteMany({
        where: { verificationSessionId: { in: expired.map((item) => item.id) } },
      }),
    ]);
  }

  private async expire(id: string, organizationId: string) {
    const current = await this.prisma.cameraVerificationSession.findFirst({
      where: { id, organizationId }, select: { expiresAt: true, status: true, commandId: true },
    });
    if (current && current.expiresAt <= new Date() && !['COMPLETED', 'CONSUMED', 'CANCELED', 'EXPIRED'].includes(current.status))
      await this.cleanup();
  }

  private async owned(context: TenantContext, id: string) {
    const session = await this.prisma.cameraVerificationSession.findFirst({
      where: { id, organizationId: context.organizationId },
    });
    if (!session) throw fail(404, 'VERIFICATION_NOT_FOUND', 'Verification not found');
    return session;
  }

  private async audit(context: TenantContext, metadata: RequestMetadata, action: string, id: string, extra: object) {
    await this.prisma.auditLog.create({ data: { organizationId: context.organizationId,
      actorUserId: context.userId, action, entityType: 'CameraVerificationSession', entityId: id,
      metadata: extra, ...metadata } });
  }
}
