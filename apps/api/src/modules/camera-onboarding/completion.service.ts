import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type CameraIdentifierType, type PrismaClient } from '@prisma/client';
import { AuthError } from '../auth/auth.errors';
import type { RequestMetadata } from '../auth/auth.types';
import { EntitlementService } from '../billing/entitlement.service';
import { PlanLimitError } from '../billing/plan-limit.error';
import { CameraCredentialService } from '../cameras/camera-credential.service';
import { realtimeService } from '../realtime/realtime.service';
import { encryptRegistrationCredentials } from '../streams/stream-envelope';
import type { TenantContext } from '../tenancy/tenant-context';
import { VerificationCredentialService } from './verification-credential.service';

const fail = (status: number, code: string, message: string) => new AuthError(status, code, message);
const hashIdentifier = (value: string) => createHash('sha256')
  .update(value.normalize('NFKC').trim().toLowerCase()).digest('hex');
const supportsRegistration = (version?: string | null) => {
  const [major = 0, minor = 0] = (version ?? '').split('.').map(Number);
  return major > 0 || minor >= 3;
};
const cameraSelect = {
  id: true, gatewayId: true, catalogVariantId: true, creationSource: true, name: true, location: true,
  administrativeStatus: true, connectionStatus: true, connectionType: true, protocol: true,
  manufacturer: true, model: true, detectedCapabilities: true, capabilityEvidence: true,
  createdAt: true, updatedAt: true,
} satisfies Prisma.CameraSelect;

type CompletionInput = { verificationSessionId: string; name: string; location?: string | null | undefined };
type Identifier = { type: CameraIdentifierType; valueHash: string };
type CameraView = Prisma.CameraGetPayload<{ select: typeof cameraSelect }>;

export class CameraOnboardingCompletionService {
  private readonly entitlements: EntitlementService;
  private readonly cameraCredentials = new CameraCredentialService();
  private readonly verificationCredentials = new VerificationCredentialService();

  constructor(private readonly prisma: PrismaClient) {
    this.entitlements = new EntitlementService(prisma);
  }

  async complete(context: TenantContext, input: CompletionInput, idempotencyKey: string,
    metadata: RequestMetadata, retry = 0): Promise<CameraView> {
    try {
      const camera = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM CameraVerificationSession WHERE id = ${input.verificationSessionId} FOR UPDATE`;
        const session = await tx.cameraVerificationSession.findFirst({
          where: { id: input.verificationSessionId, organizationId: context.organizationId,
            userId: context.userId },
          include: { candidate: true, discoverySession: true, gateway: true, camera: { select: cameraSelect } },
        });
        if (!session) throw fail(404, 'VERIFICATION_NOT_FOUND', 'Verification not found');
        if (session.camera) return session.camera;
        if (session.expiresAt <= new Date()) throw fail(410, 'VERIFICATION_EXPIRED', 'Verification expired');
        if (session.status !== 'COMPLETED' || !['VERIFIED', 'PARTIALLY_VERIFIED'].includes(session.result ?? ''))
          throw fail(409, 'VERIFICATION_NOT_COMPLETED', 'Camera verification is not completed');
        if (!session.confirmedAt || session.discoverySession.confirmedCandidateId !== session.candidateId)
          throw fail(409, 'CANDIDATE_NOT_CONFIRMED', 'The discovered camera was not confirmed');
        if (session.candidate.alreadyRegistered)
          throw fail(409, 'CAMERA_ALREADY_REGISTERED', 'This camera is already registered');
        if (session.gateway.organizationId !== context.organizationId)
          throw fail(404, 'GATEWAY_NOT_FOUND', 'Gateway not found');
        if (!supportsRegistration(session.gateway.version))
          throw fail(409, 'GATEWAY_UPDATE_REQUIRED', 'Gateway must support camera registration');

        const credential = await this.verificationCredentials.retrieve(tx, context.organizationId, session.id);
        if (session.credentialsConfigured && !credential)
          throw fail(410, 'VERIFICATION_CREDENTIAL_EXPIRED', 'Verification credential expired');
        if (!credential) throw fail(409, 'CAMERA_CREDENTIAL_REQUIRED', 'Camera credential is required');
        const verifiedStream = this.object(session.verifiedStream);
        const permanentCredential = {
          ...credential,
          ...(typeof verifiedStream.path === 'string' && typeof verifiedStream.port === 'number'
            ? { stream: { host: session.candidate.networkAddress, port: verifiedStream.port,
                path: verifiedStream.path, transport: 'tcp' as const } }
            : {}),
        };

        const identifiers = this.identifiers(session);
        if (identifiers.length) {
          const duplicate = await tx.cameraIdentifier.findFirst({
            where: { organizationId: context.organizationId,
              OR: identifiers.map((item) => ({ type: item.type, valueHash: item.valueHash })) },
            select: { cameraId: true },
          });
          if (duplicate) throw fail(409, 'CAMERA_ALREADY_REGISTERED', 'This camera is already registered');
        }
        await this.entitlements.reserveCameraInTransaction(tx, context.organizationId);

        const capabilities = this.object(session.detectedCapabilities);
        const identity = this.object(session.detectedIdentity);
        const onvif = capabilities.onvif === true;
        const rtsp = capabilities.rtsp === true;
        const camera = await tx.camera.create({
          data: {
            organizationId: context.organizationId, gatewayId: session.gatewayId,
            catalogVariantId: session.catalogVariantId, verificationSessionId: session.id,
            creationSource: 'ONBOARDING', name: input.name, location: input.location ?? null,
            administrativeStatus: 'ACTIVE', connectionStatus: 'UNKNOWN', connectionType: 'WIFI',
            protocol: onvif ? 'ONVIF' : rtsp ? 'RTSP' : 'OTHER',
            manufacturer: this.text(identity.manufacturer, 100), model: this.text(identity.model, 100),
            detectedCapabilities: capabilities as Prisma.InputJsonObject,
            capabilityEvidence: this.object(session.evidence) as Prisma.InputJsonObject,
          },
          select: cameraSelect,
        });
        if (identifiers.length)
          await tx.cameraIdentifier.createMany({ data: identifiers.map((item) => ({
            organizationId: context.organizationId, cameraId: camera.id, ...item,
          })) });
        await this.cameraCredentials.store(tx, context.organizationId, camera.id, permanentCredential);
        await tx.cameraVerificationCredential.deleteMany({
          where: { organizationId: context.organizationId, verificationSessionId: session.id },
        });
        await tx.gatewayCommand.updateMany({
          where: { organizationId: context.organizationId, commandId: session.commandId ?? '' },
          data: { payload: Prisma.JsonNull },
        });
        await tx.cameraVerificationSession.update({
          where: { id: session.id },
          data: { status: 'CONSUMED', consumedAt: new Date(), completionIdempotencyKey: idempotencyKey },
        });
        const encryptedCredentials = session.gateway.encryptionPublicKey
          ? encryptRegistrationCredentials(session.gateway.encryptionPublicKey, permanentCredential)
          : null;
        await tx.gatewayCommand.create({
          data: { organizationId: context.organizationId, gatewayId: session.gatewayId,
            cameraId: camera.id, commandId: randomUUID(), type: 'CAMERA_REGISTER',
            payload: { cameraId: camera.id, protocolVersion: '1',
              capabilities: { onvif, rtsp },
              ...(encryptedCredentials ? { encryptedCredentials: { ...encryptedCredentials } } : { credentialsPending: true }) },
            expiresAt: new Date(Date.now() + 24 * 60 * 60_000) },
        });
        await tx.auditLog.createMany({ data: [
          { organizationId: context.organizationId, actorUserId: context.userId,
            action: 'CAMERA_ONBOARDING_COMPLETED', entityType: 'CameraVerificationSession',
            entityId: session.id, metadata: { cameraId: camera.id, gatewayId: session.gatewayId }, ...metadata },
          { organizationId: context.organizationId, actorUserId: context.userId,
            action: 'CAMERA_CREATED', entityType: 'Camera', entityId: camera.id,
            metadata: { source: 'ONBOARDING', protocol: camera.protocol }, ...metadata },
          { organizationId: context.organizationId, actorUserId: context.userId,
            action: 'CAMERA_GATEWAY_BINDING_CREATED', entityType: 'Camera', entityId: camera.id,
            metadata: { gatewayId: session.gatewayId }, ...metadata },
        ] });
        return camera;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 15_000 });
      console.info(JSON.stringify({ event: 'camera_onboarding_completed', organizationId: context.organizationId,
        cameraId: camera.id, gatewayId: camera.gatewayId }));
      realtimeService.publish(context.organizationId, 'DEVICE_STATUS_CHANGED', camera.id);
      return camera;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && retry < 2)
        return this.complete(context, input, idempotencyKey, metadata, retry + 1);
      if (error instanceof PlanLimitError) {
        console.info(JSON.stringify({ event: 'camera_onboarding_limit_reached', organizationId: context.organizationId }));
        await this.auditFailure(context, input.verificationSessionId, 'CAMERA_ONBOARDING_ENTITLEMENT_BLOCKED', metadata);
      } else if (error instanceof AuthError && error.code === 'CAMERA_ALREADY_REGISTERED') {
        console.info(JSON.stringify({ event: 'camera_onboarding_duplicate', organizationId: context.organizationId }));
        await this.auditFailure(context, input.verificationSessionId, 'CAMERA_ONBOARDING_DUPLICATE_BLOCKED', metadata);
      }
      throw error;
    }
  }

  private identifiers(session: { candidate: { endpointReference: string | null }; detectedIdentity: unknown;
    discoverySession: { expectedIdentifiers: unknown } }): Identifier[] {
    const result: Identifier[] = [];
    const allowed = new Set<CameraIdentifierType>(['SERIAL_NUMBER', 'UID', 'DEVICE_ID', 'MAC_ADDRESS', 'ONVIF_ENDPOINT_REFERENCE']);
    const expected = Array.isArray(session.discoverySession.expectedIdentifiers)
      ? session.discoverySession.expectedIdentifiers : [];
    for (const item of expected) {
      if (!item || typeof item !== 'object') continue;
      const type = (item as { type?: string }).type as CameraIdentifierType;
      const value = (item as { value?: string }).value;
      if (allowed.has(type) && typeof value === 'string' && value.trim())
        result.push({ type, valueHash: hashIdentifier(value) });
    }
    const identity = this.object(session.detectedIdentity);
    if (typeof identity.serialNumber === 'string' && identity.serialNumber.trim())
      result.push({ type: 'SERIAL_NUMBER', valueHash: hashIdentifier(identity.serialNumber) });
    if (session.candidate.endpointReference)
      result.push({ type: 'ONVIF_ENDPOINT_REFERENCE', valueHash: hashIdentifier(session.candidate.endpointReference) });
    return [...new Map(result.map((item) => [`${item.type}:${item.valueHash}`, item])).values()];
  }

  private object(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  }
  private text(value: unknown, max: number) { return typeof value === 'string' ? value.slice(0, max) : null; }
  private async auditFailure(context: TenantContext, id: string, action: string, metadata: RequestMetadata) {
    await this.prisma.auditLog.create({ data: { organizationId: context.organizationId,
      actorUserId: context.userId, action, entityType: 'CameraVerificationSession', entityId: id, ...metadata } });
  }
}
