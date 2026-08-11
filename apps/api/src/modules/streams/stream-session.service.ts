import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import { AuthError } from '../auth/auth.errors';
import type { RequestMetadata } from '../auth/auth.types';
import { EntitlementService } from '../billing/entitlement.service';
import { CameraCredentialService } from '../cameras/camera-credential.service';
import type { TenantContext } from '../tenancy/tenant-context';
import { encryptForGateway } from './stream-envelope';
import { StreamMediaStore } from './stream-media.store';

const activeStatuses = ['REQUESTED', 'STARTING', 'ACTIVE', 'STOPPING'] as const;
const terminalStatuses = ['ENDED', 'FAILED', 'EXPIRED'] as const;
const error = (status: number, code: string, message: string) =>
  new AuthError(status, code, message);
const sessionSelect = {
  id: true,
  cameraId: true,
  gatewayId: true,
  userId: true,
  status: true,
  startedAt: true,
  lastActivityAt: true,
  expiresAt: true,
  endedAt: true,
  errorCode: true,
  createdAt: true,
  camera: { select: { name: true } },
} satisfies Prisma.StreamSessionSelect;

export class StreamSessionService {
  private readonly entitlements: EntitlementService;
  private readonly credentials = new CameraCredentialService();
  readonly media = new StreamMediaStore();

  constructor(private readonly prisma: PrismaClient) {
    this.entitlements = new EntitlementService(prisma);
  }

  private token(sessionId: string, userId: string, expiresAt: Date) {
    return createHmac('sha256', env.JWT_ACCESS_SECRET)
      .update(`${sessionId}:${userId}:${expiresAt.getTime()}`)
      .digest('base64url');
  }
  private tokenHash(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
  private dto(session: Prisma.StreamSessionGetPayload<{ select: typeof sessionSelect }>) {
    return {
      id: session.id,
      cameraId: session.cameraId,
      gatewayId: session.gatewayId,
      status: session.status,
      startedAt: session.startedAt,
      lastActivityAt: session.lastActivityAt,
      expiresAt: session.expiresAt,
      endedAt: session.endedAt,
      errorCode: session.errorCode,
      createdAt: session.createdAt,
      cameraName: session.camera.name,
    };
  }

  async create(
    context: TenantContext,
    cameraId: string,
    idempotencyKey: string,
    metadata: RequestMetadata,
  ) {
    await this.cleanup(context.organizationId);
    await this.entitlements.requireFeature(context.organizationId, 'LIVE_VIEW');
    const existing = await this.prisma.streamSession.findUnique({
      where: {
        organizationId_userId_idempotencyKey: {
          organizationId: context.organizationId,
          userId: context.userId,
          idempotencyKey,
        },
      },
      select: sessionSelect,
    });
    if (existing) {
      if (existing.cameraId !== cameraId)
        throw error(409, 'IDEMPOTENCY_CONFLICT', 'Idempotency key was used for another camera');
      return this.response(existing);
    }
    const camera = await this.prisma.camera.findFirst({
      where: { id: cameraId, organizationId: context.organizationId, deletedAt: null },
      include: { gateway: true },
    });
    if (!camera) throw error(404, 'CAMERA_NOT_FOUND', 'Camera not found');
    if (camera.administrativeStatus !== 'ACTIVE')
      throw error(409, 'CAMERA_DISABLED', 'Camera is disabled');
    if (!camera.gatewayId || !camera.gateway)
      throw error(409, 'GATEWAY_NOT_FOUND', 'Camera is not associated with a gateway');
    if (camera.gateway.status !== 'ONLINE')
      throw error(409, 'GATEWAY_OFFLINE', 'Gateway is offline');
    if (!camera.gateway.encryptionPublicKey)
      throw error(409, 'GATEWAY_ENCRYPTION_UNAVAILABLE', 'Gateway must reconnect before streaming');
    if (camera.protocol !== 'RTSP')
      throw error(422, 'UNSUPPORTED_PROTOCOL', 'Only RTSP streaming is available');
    const source = await this.credentials.retrieveForBackend(context.organizationId, camera.id);
    if (!source?.stream)
      throw error(409, 'STREAM_SOURCE_NOT_CONFIGURED', 'Camera stream source is not configured');
    const id = randomUUID();
    const expiresAt = new Date(Date.now() + env.STREAM_SESSION_TTL_SECONDS * 1000);
    const playbackToken = this.token(id, context.userId, expiresAt);
    const encryptedSource = encryptForGateway(camera.gateway.encryptionPublicKey, source);
    const session = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM Organization WHERE id = ${context.organizationId} FOR UPDATE`;
      const activeCount = await tx.streamSession.count({
        where: { organizationId: context.organizationId, status: { in: [...activeStatuses] } },
      });
      if (activeCount >= env.MAX_ACTIVE_STREAMS_PER_ORG)
        throw error(429, 'STREAM_LIMIT_REACHED', 'Simultaneous stream limit reached');
      const created = await tx.streamSession.create({
        data: {
          id,
          organizationId: context.organizationId,
          cameraId: camera.id,
          gatewayId: camera.gatewayId!,
          userId: context.userId,
          idempotencyKey,
          tokenHash: this.tokenHash(playbackToken),
          status: 'STARTING',
          expiresAt,
        },
        select: sessionSelect,
      });
      await tx.gatewayCommand.create({
        data: {
          organizationId: context.organizationId,
          gatewayId: camera.gatewayId!,
          cameraId: camera.id,
          streamSessionId: id,
          commandId: randomUUID(),
          type: 'START_STREAM',
          payload: {
            streamSessionId: id,
            cameraId: camera.id,
            encryptedSource: encryptedSource as unknown as Prisma.InputJsonObject,
          },
          expiresAt: new Date(Date.now() + env.STREAM_START_TIMEOUT_SECONDS * 1000),
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: 'STREAM_REQUESTED',
          entityType: 'StreamSession',
          entityId: id,
          metadata: { cameraId: camera.id, gatewayId: camera.gatewayId },
          ...metadata,
        },
      });
      return created;
    });
    console.info(
      JSON.stringify({
        event: 'stream.requested',
        streamSessionId: id,
        cameraId,
        gatewayId: camera.gatewayId,
        organizationId: context.organizationId,
      }),
    );
    return { ...this.response(session), playbackToken };
  }

  private response(session: Prisma.StreamSessionGetPayload<{ select: typeof sessionSelect }>) {
    return {
      session: this.dto(session),
      playbackUrl: `/stream-sessions/${session.id}/media/index.m3u8`,
      playbackToken: this.token(session.id, session.userId, session.expiresAt),
    };
  }

  async get(context: TenantContext, id: string) {
    await this.cleanup(context.organizationId);
    const session = await this.prisma.streamSession.findFirst({
      where: { id, organizationId: context.organizationId, userId: context.userId },
      select: sessionSelect,
    });
    if (!session) throw error(404, 'STREAM_NOT_AUTHORIZED', 'Stream session not found');
    return this.dto(session);
  }

  async stop(context: TenantContext, id: string, metadata: RequestMetadata) {
    const session = await this.prisma.streamSession.findFirst({
      where: { id, organizationId: context.organizationId, userId: context.userId },
    });
    if (!session) throw error(404, 'STREAM_NOT_AUTHORIZED', 'Stream session not found');
    if (
      (terminalStatuses as readonly string[]).includes(session.status) ||
      session.status === 'STOPPING'
    )
      return this.get(context, id);
    await this.prisma.$transaction([
      this.prisma.streamSession.update({ where: { id }, data: { status: 'STOPPING' } }),
      this.prisma.gatewayCommand.create({
        data: {
          organizationId: session.organizationId,
          gatewayId: session.gatewayId,
          cameraId: session.cameraId,
          streamSessionId: id,
          commandId: randomUUID(),
          type: 'STOP_STREAM',
          payload: { streamSessionId: id, cameraId: session.cameraId },
          expiresAt: new Date(Date.now() + env.GATEWAY_COMMAND_TTL_SECONDS * 1000),
        },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: 'STREAM_STOP_REQUESTED',
          entityType: 'StreamSession',
          entityId: id,
          ...metadata,
        },
      }),
    ]);
    await this.media.remove(id);
    console.info(
      JSON.stringify({ event: 'stream.stopped', streamSessionId: id, phase: 'requested' }),
    );
    return this.get(context, id);
  }

  async cleanup(organizationId?: string) {
    const now = new Date();
    const idleCutoff = new Date(Date.now() - env.STREAM_IDLE_TIMEOUT_SECONDS * 1000);
    const stale = await this.prisma.streamSession.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        status: { in: ['REQUESTED', 'STARTING', 'ACTIVE'] },
        OR: [{ expiresAt: { lte: now } }, { lastActivityAt: { lte: idleCutoff } }],
      },
      take: 100,
    });
    for (const session of stale) {
      const expired = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.streamSession.updateMany({
          where: { id: session.id, status: { in: ['REQUESTED', 'STARTING', 'ACTIVE'] } },
          data: { status: 'EXPIRED', endedAt: now, errorCode: 'STREAM_SESSION_EXPIRED' },
        });
        if (!changed.count) return false;
        await tx.gatewayCommand.create({
          data: {
            organizationId: session.organizationId,
            gatewayId: session.gatewayId,
            cameraId: session.cameraId,
            streamSessionId: session.id,
            commandId: randomUUID(),
            type: 'STOP_STREAM',
            payload: { streamSessionId: session.id, cameraId: session.cameraId },
            expiresAt: new Date(Date.now() + env.GATEWAY_COMMAND_TTL_SECONDS * 1000),
          },
        });
        return true;
      });
      if (!expired) continue;
      await this.media.remove(session.id);
      console.info(JSON.stringify({ event: 'stream.expired', streamSessionId: session.id }));
    }
    return stale.length;
  }

  async authorizeViewer(sessionId: string, credential: string) {
    const session = await this.prisma.streamSession.findUnique({ where: { id: sessionId } });
    if (
      !session ||
      !['STARTING', 'ACTIVE'].includes(session.status) ||
      session.expiresAt <= new Date()
    )
      throw error(401, 'STREAM_SESSION_EXPIRED', 'Stream session expired');
    const actual = Buffer.from(this.tokenHash(credential));
    const expected = Buffer.from(session.tokenHash);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw error(401, 'STREAM_NOT_AUTHORIZED', 'Invalid stream credential');
    await this.prisma.streamSession.update({
      where: { id: session.id },
      data: { lastActivityAt: new Date() },
    });
    return session;
  }

  async authorizeGatewayMedia(
    auth: NonNullable<Express.Request['gatewayAuth']>,
    sessionId: string,
  ) {
    const session = await this.prisma.streamSession.findFirst({
      where: {
        id: sessionId,
        gatewayId: auth.gatewayId,
        organizationId: auth.organizationId,
        status: { in: ['STARTING', 'ACTIVE'] },
        expiresAt: { gt: new Date() },
      },
    });
    if (!session) throw error(403, 'GATEWAY_UNAUTHORIZED', 'Stream session unavailable');
    return session;
  }
}
