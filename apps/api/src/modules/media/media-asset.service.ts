import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma, type PrismaClient, type StorageFileType } from '@prisma/client';
import { env } from '../../config/env';
import type { RequestMetadata } from '../auth/auth.types';
import { AuthError } from '../auth/auth.errors';
import { EntitlementService } from '../billing/entitlement.service';
import { CameraCredentialService } from '../cameras/camera-credential.service';
import { encryptForGateway } from '../streams/stream-envelope';
import type { TenantContext } from '../tenancy/tenant-context';
import type { ObjectStorageService } from './object-storage.service';

const error = (status: number, code: string, message: string) =>
  new AuthError(status, code, message);
const activeStatuses = ['PENDING', 'CAPTURING', 'UPLOADING'] as const;

export class MediaAssetService {
  private readonly entitlements: EntitlementService;
  private readonly credentials = new CameraCredentialService();
  constructor(
    private readonly prisma: PrismaClient,
    private readonly storage: ObjectStorageService,
  ) {
    this.entitlements = new EntitlementService(prisma);
  }

  async request(
    context: TenantContext,
    cameraId: string,
    type: 'SNAPSHOT' | 'RECORDING',
    idempotencyKey: string,
    metadata: RequestMetadata,
  ) {
    const duplicate = await this.prisma.storageFile.findFirst({
      where: {
        organizationId: context.organizationId,
        requestedById: context.userId,
        idempotencyKey,
      },
    });
    if (duplicate) return dto(duplicate);
    await this.entitlements.requireFeature(context.organizationId, 'CLOUD_STORAGE');
    if (type === 'RECORDING')
      await this.entitlements.requireFeature(context.organizationId, 'RECORDING');
    const camera = await this.prisma.camera.findFirst({
      where: { id: cameraId, organizationId: context.organizationId, deletedAt: null },
      include: { gateway: true },
    });
    if (!camera) throw error(404, 'CAMERA_NOT_FOUND', 'Camera not found');
    if (camera.administrativeStatus !== 'ACTIVE')
      throw error(409, 'CAMERA_DISABLED', 'Camera is disabled');
    if (camera.protocol !== 'RTSP')
      throw error(409, 'UNSUPPORTED_PROTOCOL', 'Camera protocol does not support capture');
    if (!camera.gateway || camera.gateway.status !== 'ONLINE' || camera.gateway.deletedAt)
      throw error(409, 'GATEWAY_OFFLINE', 'Gateway is offline');
    if (!camera.gateway.encryptionPublicKey)
      throw error(409, 'GATEWAY_ENCRYPTION_UNAVAILABLE', 'Gateway must reconnect before capture');
    if (
      type === 'RECORDING' &&
      (await this.prisma.storageFile.count({
        where: {
          organizationId: context.organizationId,
          cameraId,
          type: 'RECORDING',
          status: { in: [...activeStatuses] },
        },
      }))
    )
      throw error(409, 'RECORDING_ALREADY_ACTIVE', 'Camera already has an active recording');
    const source = await this.credentials.retrieveForBackend(context.organizationId, cameraId);
    if (!source?.stream)
      throw error(409, 'CAMERA_STREAM_NOT_CONFIGURED', 'Camera stream is not configured');
    const reservation = BigInt(
      type === 'SNAPSHOT' ? env.SNAPSHOT_MAX_BYTES : env.RECORDING_MAX_BYTES,
    );
    const { plan } = await this.entitlements.getEntitlements(context.organizationId);
    await this.entitlements.reserveStorage(context.organizationId, reservation);
    const assetId = randomUUID();
    const now = new Date();
    const extension = type === 'SNAPSHOT' ? 'jpg' : 'mp4';
    const storageKey = `organizations/${context.organizationId}/cameras/${cameraId}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${String(now.getUTCDate()).padStart(2, '0')}/${assetId}.${extension}`;
    try {
      const asset = await this.prisma.$transaction(async (tx) => {
        const created = await tx.storageFile.create({
          data: {
            id: assetId,
            organizationId: context.organizationId,
            cameraId,
            gatewayId: camera.gatewayId,
            requestedById: context.userId,
            idempotencyKey,
            type,
            status: type === 'SNAPSHOT' ? 'PENDING' : 'CAPTURING',
            storageProvider: 's3',
            storageKey,
            fileName: `${type.toLowerCase()}-${assetId}.${extension}`,
            mimeType: type === 'SNAPSHOT' ? 'image/jpeg' : 'video/mp4',
            reservedBytes: reservation,
            expiresAt: new Date(now.getTime() + plan.retentionDays * 86_400_000),
          },
        });
        await tx.gatewayCommand.create({
          data: {
            organizationId: context.organizationId,
            gatewayId: camera.gatewayId!,
            cameraId,
            commandId: randomUUID(),
            type: type === 'SNAPSHOT' ? 'CAPTURE_SNAPSHOT' : 'START_RECORDING',
            payload: {
              assetId,
              cameraId,
              encryptedSource: encryptForGateway(camera.gateway!.encryptionPublicKey!, source),
              uploadPath: `/media-assets/${assetId}/content`,
              maxBytes: reservation.toString(),
              ...(type === 'RECORDING'
                ? { maxDurationSeconds: env.RECORDING_SEGMENT_SECONDS }
                : {}),
            } as unknown as Prisma.InputJsonValue,
            expiresAt: new Date(Date.now() + env.GATEWAY_COMMAND_TTL_SECONDS * 1000),
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.userId,
            action: type === 'SNAPSHOT' ? 'SNAPSHOT_REQUESTED' : 'RECORDING_STARTED',
            entityType: 'StorageFile',
            entityId: assetId,
            metadata: { cameraId, gatewayId: camera.gatewayId, ...metadata },
          },
        });
        return created;
      });
      console.info(
        JSON.stringify({
          event: type === 'SNAPSHOT' ? 'snapshot.requested' : 'recording.started',
          mediaAssetId: asset.id,
          organizationId: context.organizationId,
          cameraId,
          gatewayId: camera.gatewayId,
        }),
      );
      return dto(asset);
    } catch (caught) {
      await this.entitlements.releaseStorage(context.organizationId, reservation);
      throw caught;
    }
  }

  async stopRecording(context: TenantContext, assetId: string, metadata: RequestMetadata) {
    const asset = await this.find(context.organizationId, assetId);
    if (asset.type !== 'RECORDING') throw error(409, 'NOT_A_RECORDING', 'Asset is not a recording');
    if (!activeStatuses.includes(asset.status as (typeof activeStatuses)[number]))
      return dto(asset);
    const existing = await this.prisma.gatewayCommand.findFirst({
      where: {
        organizationId: context.organizationId,
        type: 'STOP_RECORDING',
        payload: { path: '$.assetId', equals: asset.id },
      },
    });
    if (!existing)
      await this.prisma.$transaction([
        this.prisma.gatewayCommand.create({
          data: {
            organizationId: context.organizationId,
            gatewayId: asset.gatewayId!,
            cameraId: asset.cameraId,
            commandId: randomUUID(),
            type: 'STOP_RECORDING',
            payload: { assetId: asset.id },
            expiresAt: new Date(Date.now() + env.GATEWAY_COMMAND_TTL_SECONDS * 1000),
          },
        }),
        this.prisma.auditLog.create({
          data: {
            organizationId: context.organizationId,
            actorUserId: context.userId,
            action: 'RECORDING_STOPPED',
            entityType: 'StorageFile',
            entityId: asset.id,
            metadata: { ...metadata },
          },
        }),
      ]);
    return dto(asset);
  }

  async receiveUpload(
    auth: { gatewayId: string; organizationId: string },
    assetId: string,
    data: Buffer,
    suppliedChecksum?: string,
  ) {
    const asset = await this.prisma.storageFile.findFirst({
      where: { id: assetId, organizationId: auth.organizationId, gatewayId: auth.gatewayId },
    });
    if (!asset) throw error(404, 'MEDIA_ASSET_NOT_FOUND', 'Media asset not found');
    if (asset.status === 'AVAILABLE') return dto(asset);
    if (!activeStatuses.includes(asset.status as (typeof activeStatuses)[number]))
      throw error(409, 'MEDIA_UPLOAD_NOT_ALLOWED', 'Media upload is not allowed');
    if (!data.length || BigInt(data.length) > asset.reservedBytes)
      throw error(413, 'MEDIA_TOO_LARGE', 'Media exceeds authorized size');
    validateFile(asset.type, data);
    const checksum = createHash('sha256').update(data).digest('hex');
    if (suppliedChecksum && suppliedChecksum !== checksum)
      throw error(422, 'CHECKSUM_MISMATCH', 'Media checksum does not match');
    await this.prisma.storageFile.update({
      where: { id: asset.id },
      data: { status: 'UPLOADING' },
    });
    await this.storage.put(asset.storageKey, data, asset.mimeType);
    const completed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM StorageUsage WHERE organizationId = ${asset.organizationId} FOR UPDATE`;
      const current = await tx.storageFile.findUniqueOrThrow({ where: { id: asset.id } });
      if (current.status === 'AVAILABLE') return current;
      await tx.storageUsage.update({
        where: { organizationId: asset.organizationId },
        data: {
          reservedBytes: { decrement: current.reservedBytes },
          usedBytes: { increment: data.length },
          fileCount: { increment: 1 },
          version: { increment: 1 },
        },
      });
      return tx.storageFile.update({
        where: { id: asset.id },
        data: {
          status: 'AVAILABLE',
          sizeBytes: data.length,
          reservedBytes: 0,
          checksum,
          capturedAt: current.capturedAt ?? new Date(),
          uploadedAt: new Date(),
          errorCode: null,
        },
      });
    });
    console.info(
      JSON.stringify({
        event: 'media.upload_completed',
        mediaAssetId: asset.id,
        organizationId: asset.organizationId,
        sizeBytes: data.length,
      }),
    );
    return dto(completed);
  }

  async failUpload(
    auth: { gatewayId: string; organizationId: string },
    assetId: string,
    errorCode: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const asset = await tx.storageFile.findFirst({
        where: { id: assetId, organizationId: auth.organizationId, gatewayId: auth.gatewayId },
      });
      if (!asset) throw error(404, 'MEDIA_ASSET_NOT_FOUND', 'Media asset not found');
      if (!activeStatuses.includes(asset.status as (typeof activeStatuses)[number]))
        return dto(asset);
      await tx.$queryRaw`SELECT id FROM StorageUsage WHERE organizationId = ${asset.organizationId} FOR UPDATE`;
      if (asset.reservedBytes > 0n)
        await tx.storageUsage.update({
          where: { organizationId: asset.organizationId },
          data: {
            reservedBytes: { decrement: asset.reservedBytes },
            version: { increment: 1 },
          },
        });
      const failed = await tx.storageFile.update({
        where: { id: asset.id },
        data: { status: 'FAILED', reservedBytes: 0, errorCode },
      });
      console.error(
        JSON.stringify({
          event: 'media.upload_failed',
          mediaAssetId: asset.id,
          organizationId: asset.organizationId,
          errorCode,
        }),
      );
      return dto(failed);
    });
  }

  async list(context: TenantContext, cameraId?: string) {
    return (
      await this.prisma.storageFile.findMany({
        where: {
          organizationId: context.organizationId,
          deletedAt: null,
          ...(cameraId ? { cameraId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
      })
    ).map(dto);
  }
  async get(context: TenantContext, id: string) {
    return dto(await this.find(context.organizationId, id));
  }
  async access(context: TenantContext, id: string) {
    const asset = await this.find(context.organizationId, id);
    if (asset.status !== 'AVAILABLE')
      throw error(409, 'MEDIA_NOT_AVAILABLE', 'Media is not available');
    await this.prisma.auditLog.create({
      data: {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: 'MEDIA_ACCESSED',
        entityType: 'StorageFile',
        entityId: id,
      },
    });
    const expiresAt = Math.floor(Date.now() / 1000) + env.MEDIA_ACCESS_TTL_SECONDS;
    const token = sign(`${asset.id}.${context.organizationId}.${expiresAt}`);
    return {
      url: `/media-assets/${asset.id}/content?expires=${expiresAt}&token=${token}`,
      expiresAt: new Date(expiresAt * 1000),
    };
  }
  async content(id: string, expires: number, token: string) {
    const asset = await this.prisma.storageFile.findFirst({
      where: { id, status: 'AVAILABLE', deletedAt: null },
    });
    if (!asset || expires <= Math.floor(Date.now() / 1000))
      throw error(401, 'MEDIA_ACCESS_EXPIRED', 'Media access expired');
    const expected = sign(`${asset.id}.${asset.organizationId}.${expires}`);
    const supplied = Buffer.from(token);
    const valid =
      supplied.length === expected.length && timingSafeEqual(supplied, Buffer.from(expected));
    if (!valid) throw error(401, 'MEDIA_NOT_AUTHORIZED', 'Media access denied');
    return { asset, stream: await this.storage.get(asset.storageKey) };
  }
  async remove(
    context: TenantContext,
    id: string,
    reason: 'manual' | 'retention',
    metadata?: RequestMetadata,
  ) {
    const asset = await this.find(context.organizationId, id);
    if (['DELETED', 'EXPIRED'].includes(asset.status)) return dto(asset);
    if (
      reason === 'manual' &&
      activeStatuses.includes(asset.status as (typeof activeStatuses)[number])
    )
      throw error(409, 'MEDIA_ASSET_ACTIVE', 'Stop or finish the capture before deleting');
    await this.prisma.storageFile.update({ where: { id }, data: { status: 'DELETING' } });
    try {
      if (asset.sizeBytes > 0n) await this.storage.delete(asset.storageKey);
    } catch (caught) {
      await this.prisma.storageFile.update({ where: { id }, data: { status: asset.status } });
      throw caught;
    }
    const removed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM StorageUsage WHERE organizationId = ${asset.organizationId} FOR UPDATE`;
      const current = await tx.storageFile.findUniqueOrThrow({ where: { id } });
      if (['DELETED', 'EXPIRED'].includes(current.status)) return current;
      if (current.sizeBytes > 0n)
        await tx.storageUsage.update({
          where: { organizationId: asset.organizationId },
          data: {
            usedBytes: { decrement: current.sizeBytes },
            fileCount: { decrement: 1 },
            version: { increment: 1 },
          },
        });
      else if (current.reservedBytes > 0n)
        await tx.storageUsage.update({
          where: { organizationId: asset.organizationId },
          data: { reservedBytes: { decrement: current.reservedBytes }, version: { increment: 1 } },
        });
      const result = await tx.storageFile.update({
        where: { id },
        data: {
          status: reason === 'retention' ? 'EXPIRED' : 'DELETED',
          deletedAt: new Date(),
          reservedBytes: 0,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          ...(reason === 'manual' ? { actorUserId: context.userId } : {}),
          action: reason === 'manual' ? 'MEDIA_DELETED' : 'RETENTION_DELETED',
          entityType: 'StorageFile',
          entityId: id,
          metadata: { sizeBytes: current.sizeBytes.toString(), ...(metadata ?? {}) },
        },
      });
      return result;
    });
    return dto(removed);
  }
  async retentionBatch(limit = 50) {
    const expired = await this.prisma.storageFile.findMany({
      where: { status: 'AVAILABLE', expiresAt: { lte: new Date() }, deletedAt: null },
      take: limit,
    });
    let deleted = 0;
    for (const asset of expired) {
      try {
        await this.remove(
          { organizationId: asset.organizationId, userId: asset.requestedById ?? '' },
          asset.id,
          'retention',
        );
        deleted += 1;
      } catch {
        console.error(JSON.stringify({ event: 'retention.delete_failed', mediaAssetId: asset.id }));
      }
    }
    return deleted;
  }
  private async find(organizationId: string, id: string) {
    const asset = await this.prisma.storageFile.findFirst({ where: { id, organizationId } });
    if (!asset) throw error(404, 'MEDIA_ASSET_NOT_FOUND', 'Media asset not found');
    return asset;
  }
}

const sign = (value: string) =>
  createHmac('sha256', env.JWT_ACCESS_SECRET).update(value).digest('base64url');
const validateFile = (type: StorageFileType, data: Buffer) => {
  if (type === 'SNAPSHOT') {
    if (
      data.length < 4 ||
      data[0] !== 0xff ||
      data[1] !== 0xd8 ||
      data.at(-2) !== 0xff ||
      data.at(-1) !== 0xd9
    )
      throw error(415, 'INVALID_MEDIA_FILE', 'Snapshot must be a valid JPEG');
  } else if (type === 'RECORDING') {
    if (data.length < 12 || data.subarray(4, 8).toString('ascii') !== 'ftyp')
      throw error(415, 'INVALID_MEDIA_FILE', 'Recording must be an MP4 file');
  } else throw error(415, 'INVALID_MEDIA_FILE', 'Unsupported media type');
};
const dto = (asset: {
  id: string;
  cameraId: string | null;
  type: StorageFileType;
  status: string;
  fileName: string;
  mimeType: string;
  sizeBytes: bigint;
  checksum: string | null;
  capturedAt: Date | null;
  uploadedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  errorCode: string | null;
}) => ({
  id: asset.id,
  cameraId: asset.cameraId,
  type: asset.type,
  status: asset.status,
  fileName: asset.fileName,
  mimeType: asset.mimeType,
  sizeBytes: asset.sizeBytes.toString(),
  checksum: asset.checksum,
  capturedAt: asset.capturedAt,
  uploadedAt: asset.uploadedAt,
  expiresAt: asset.expiresAt,
  createdAt: asset.createdAt,
  errorCode: asset.errorCode,
});
