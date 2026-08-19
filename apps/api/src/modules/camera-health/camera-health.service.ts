import { randomUUID } from 'node:crypto';
import { Prisma, type CameraConnectionStatus, type PrismaClient } from '@prisma/client';
import { AuthError } from '../auth/auth.errors';
import type { RequestMetadata } from '../auth/auth.types';
import { CameraCredentialService } from '../cameras/camera-credential.service';
import { realtimeService } from '../realtime/realtime.service';
import { encryptForGateway } from '../streams/stream-envelope';
import type { TenantContext } from '../tenancy/tenant-context';
import type { CameraHealthBatch } from './camera-health.schemas';

const fail = (status: number, code: string, message: string) =>
  new AuthError(status, code, message);
const terminalSuccess = (status: CameraConnectionStatus) =>
  status === 'ONLINE' || status === 'DEGRADED';
const MINIMUM_GATEWAY_VERSION = '0.4.0';
const versionAtLeast = (current: string | null, minimum: string) => {
  if (!current) return false;
  const left = current.split('.').slice(0, 3).map(Number);
  const right = minimum.split('.').slice(0, 3).map(Number);
  for (let index = 0; index < 3; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) return (left[index] ?? 0) > (right[index] ?? 0);
  }
  return true;
};

export class CameraHealthService {
  private readonly credentials = new CameraCredentialService();
  constructor(private readonly prisma: PrismaClient) {}

  async sync(auth: NonNullable<Express.Request['gatewayAuth']>) {
    const gateway = await this.prisma.gateway.findFirst({
      where: { id: auth.gatewayId, organizationId: auth.organizationId, deletedAt: null },
      select: { encryptionPublicKey: true, version: true },
    });
    if (!gateway?.encryptionPublicKey || !versionAtLeast(gateway.version, MINIMUM_GATEWAY_VERSION))
      return {
        revision: new Date().toISOString(),
        minimumGatewayVersion: MINIMUM_GATEWAY_VERSION,
        upgradeRequired: true,
        cameras: [],
      };
    const cameras = await this.prisma.camera.findMany({
      where: {
        organizationId: auth.organizationId,
        gatewayId: auth.gatewayId,
        administrativeStatus: 'ACTIVE',
        deletedAt: null,
      },
      include: { verificationSession: { include: { candidate: true } } },
      orderBy: { id: 'asc' },
    });
    const configured = [];
    for (const camera of cameras) {
      const source = await this.credentials.retrieveForBackend(auth.organizationId, camera.id);
      if (!source?.stream) continue;
      const capabilities = this.object(camera.detectedCapabilities);
      configured.push({
        cameraId: camera.id,
        generation: camera.healthGeneration,
        healthProfile: {
          onvif: capabilities.onvif === true,
          rtsp: capabilities.rtsp === true,
          normalIntervalSeconds: 60,
          failureThreshold: 3,
          maxBackoffSeconds: 300,
        },
        identity: {
          endpointReference: camera.verificationSession?.candidate.endpointReference ?? undefined,
          manufacturer: camera.manufacturer ?? undefined,
          model: camera.model ?? undefined,
        },
        encryptedSource: encryptForGateway(gateway.encryptionPublicKey, source),
      });
    }
    return {
      revision: new Date().toISOString(),
      minimumGatewayVersion: MINIMUM_GATEWAY_VERSION,
      upgradeRequired: false,
      cameras: configured,
    };
  }

  async ingest(auth: NonNullable<Express.Request['gatewayAuth']>, input: CameraHealthBatch) {
    try {
      await this.prisma.gatewayMessage.create({
        data: {
          organizationId: auth.organizationId,
          gatewayId: auth.gatewayId,
          messageId: input.messageId,
          type: 'CAMERA_HEALTH_BATCH',
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        return { accepted: true, duplicate: true, updated: 0, ignored: input.entries.length };
      throw error;
    }
    let updated = 0;
    let ignored = 0;
    for (const entry of input.entries) {
      const observedAt = new Date(entry.observedAt);
      if (Math.abs(Date.now() - observedAt.getTime()) > 5 * 60_000) {
        ignored += 1;
        continue;
      }
      const camera = await this.prisma.camera.findFirst({
        where: {
          id: entry.cameraId,
          organizationId: auth.organizationId,
          gatewayId: auth.gatewayId,
          deletedAt: null,
        },
        select: {
          id: true,
          connectionStatus: true,
          administrativeStatus: true,
          healthSequence: true,
          healthGeneration: true,
          verificationSessionId: true,
        },
      });
      if (!camera) {
        ignored += 1;
        continue;
      }
      if (
        camera.administrativeStatus !== 'ACTIVE' ||
        camera.healthGeneration !== entry.generation ||
        BigInt(entry.sequence) <= camera.healthSequence
      ) {
        ignored += 1;
        continue;
      }
      const next = entry.status as CameraConnectionStatus;
      const changed = camera.connectionStatus !== next;
      const result = await this.prisma.camera.updateMany({
        where: {
          id: camera.id,
          organizationId: auth.organizationId,
          gatewayId: auth.gatewayId,
          healthGeneration: entry.generation,
          healthSequence: { lt: BigInt(entry.sequence) },
        },
        data: {
          connectionStatus: next,
          healthSequence: BigInt(entry.sequence),
          lastHealthCheckAt: observedAt,
          consecutiveFailures: entry.consecutiveFailures,
          healthFailureCode: entry.failureCode ?? null,
          ...(terminalSuccess(next)
            ? { lastSuccessfulHealthCheckAt: observedAt, lastSeenAt: observedAt }
            : {}),
          ...(entry.observedTarget
            ? {
                currentNetworkAddress: entry.observedTarget.address,
                currentServicePort: entry.observedTarget.servicePort,
              }
            : {}),
        },
      });
      if (!result.count) {
        ignored += 1;
        continue;
      }
      if (entry.observedTarget)
        await this.updateCredentialTarget(
          auth.organizationId,
          camera.id,
          entry.observedTarget.address,
          entry.observedTarget.servicePort,
        );
      updated += 1;
      if (changed)
        await this.transition(
          auth,
          camera.id,
          camera.connectionStatus,
          next,
          observedAt,
          entry.failureCode,
        );
    }
    return { accepted: true, duplicate: false, updated, ignored };
  }

  async requestRetry(context: TenantContext, cameraId: string, metadata: RequestMetadata) {
    const camera = await this.prisma.camera.findFirst({
      where: {
        id: cameraId,
        organizationId: context.organizationId,
        administrativeStatus: 'ACTIVE',
        deletedAt: null,
      },
      include: { gateway: true },
    });
    if (!camera?.gatewayId || !camera.gateway)
      throw fail(404, 'CAMERA_NOT_FOUND', 'Camera not found');
    if (!versionAtLeast(camera.gateway.version, MINIMUM_GATEWAY_VERSION))
      throw fail(
        409,
        'GATEWAY_UPDATE_REQUIRED',
        `Atualize o Gateway para a versão ${MINIMUM_GATEWAY_VERSION} ou superior.`,
      );
    const command = await this.prisma.$transaction(async (tx) => {
      await tx.camera.update({
        where: { id: camera.id },
        data: { connectionStatus: 'CONNECTING' },
      });
      const queued = await tx.gatewayCommand.create({
        data: {
          organizationId: context.organizationId,
          gatewayId: camera.gatewayId!,
          cameraId: camera.id,
          commandId: randomUUID(),
          type: 'CAMERA_HEALTH_CHECK',
          payload: {
            cameraId: camera.id,
            generation: camera.healthGeneration,
            protocolVersion: '1',
          },
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: 'CAMERA_HEALTH_RETRY_REQUESTED',
          entityType: 'Camera',
          entityId: camera.id,
          metadata: { gatewayId: camera.gatewayId },
          ...metadata,
        },
      });
      return queued;
    });
    realtimeService.publish(context.organizationId, 'DEVICE_STATUS_CHANGED', camera.id);
    return { commandId: command.commandId, status: 'CONNECTING' as const };
  }

  private async updateCredentialTarget(
    organizationId: string,
    cameraId: string,
    address: string,
    port: number,
  ) {
    const credential = await this.credentials.retrieveForBackend(organizationId, cameraId);
    if (!credential?.stream || credential.stream.host === address) return;
    await this.prisma.$transaction(async (tx) => {
      await this.credentials.store(tx, organizationId, cameraId, {
        ...credential,
        stream: {
          host: address,
          port,
          path: credential.stream!.path ?? '/',
          transport: credential.stream!.transport ?? 'tcp',
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          action: 'CAMERA_NETWORK_ADDRESS_UPDATED',
          entityType: 'Camera',
          entityId: cameraId,
          metadata: { evidence: 'STRONG_IDENTITY' },
        },
      });
    });
  }

  private async transition(
    auth: NonNullable<Express.Request['gatewayAuth']>,
    cameraId: string,
    previous: CameraConnectionStatus,
    next: CameraConnectionStatus,
    occurredAt: Date,
    failureCode?: string,
  ) {
    const type = next === 'ONLINE' ? 'CAMERA_ONLINE' : next === 'OFFLINE' ? 'CAMERA_OFFLINE' : null;
    if (type)
      await this.prisma.cameraEvent.create({
        data: {
          organizationId: auth.organizationId,
          gatewayId: auth.gatewayId,
          cameraId,
          externalEventId: randomUUID(),
          type,
          source: 'CONNECTIVITY_MONITOR',
          severity: type === 'CAMERA_OFFLINE' ? 'MEDIUM' : 'INFO',
          status: type === 'CAMERA_OFFLINE' ? 'OPEN' : 'RESOLVED',
          occurredAt,
          ...(type === 'CAMERA_ONLINE' ? { endedAt: occurredAt, resolvedAt: occurredAt } : {}),
          metadata: { previous, next, ...(failureCode ? { failureCode } : {}) },
        },
      });
    console.info(
      JSON.stringify({
        event: 'camera_health_transition',
        organizationId: auth.organizationId,
        gatewayId: auth.gatewayId,
        cameraId,
        previous,
        next,
        failureCode,
      }),
    );
    realtimeService.publish(auth.organizationId, 'DEVICE_STATUS_CHANGED', cameraId, occurredAt);
  }
  private object(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }
}
