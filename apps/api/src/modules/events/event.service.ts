import { Prisma, type PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import { AuthError } from '../auth/auth.errors';
import type { TenantContext } from '../tenancy/tenant-context';
import { MediaAssetService } from '../media/media-asset.service';
import { S3ObjectStorageService } from '../media/object-storage.service';
import { AlertService } from '../notifications/notification.service';
import { IntelligenceService } from '../intelligence/intelligence.service';

type GatewayAuth = NonNullable<Express.Request['gatewayAuth']>;
type GatewayEventInput = {
  messageId: string;
  eventId: string;
  protocolVersion: '1';
  cameraId: string;
  type: 'MOTION' | 'CAMERA_OFFLINE' | 'CAMERA_ONLINE';
  occurredAt: string;
  endedAt?: string | undefined;
  motionScore?: number | undefined;
};

const eventInclude = {
  camera: { select: { id: true, name: true, location: true } },
  gateway: { select: { id: true, name: true } },
  storageFiles: {
    where: { status: 'AVAILABLE' as const, deletedAt: null },
    take: 1,
    select: { id: true, type: true, mimeType: true, capturedAt: true },
  },
  classifications: { orderBy: { engineVersion: 'desc' as const }, take: 1 },
} satisfies Prisma.CameraEventInclude;

export class EventService {
  private readonly media: MediaAssetService;
  private readonly alerts: AlertService;
  private readonly intelligence: IntelligenceService;
  constructor(private readonly prisma: PrismaClient) {
    this.media = new MediaAssetService(prisma, new S3ObjectStorageService());
    this.alerts = new AlertService(prisma);
    this.intelligence = new IntelligenceService(prisma);
  }

  private timestamp(value: string) {
    const date = new Date(value);
    if (Math.abs(Date.now() - date.getTime()) > env.EVENT_TIMESTAMP_SKEW_SECONDS * 1000)
      throw new AuthError(
        400,
        'INVALID_EVENT_TIMESTAMP',
        'Event timestamp is outside allowed skew',
      );
    return date;
  }

  async ingest(auth: GatewayAuth, input: GatewayEventInput) {
    const occurredAt = this.timestamp(input.occurredAt);
    const endedAt = input.endedAt ? this.timestamp(input.endedAt) : null;
    if (endedAt && endedAt < occurredAt)
      throw new AuthError(400, 'INVALID_EVENT_TIMESTAMP', 'Event end precedes its start');
    const camera = await this.prisma.camera.findFirst({
      where: {
        id: input.cameraId,
        organizationId: auth.organizationId,
        gatewayId: auth.gatewayId,
        deletedAt: null,
      },
      select: {
        id: true,
        administrativeStatus: true,
        connectionStatus: true,
        captureSnapshotOnMotion: true,
      },
    });
    if (!camera) throw new AuthError(404, 'CAMERA_NOT_FOUND', 'Camera not found');
    if (camera.administrativeStatus !== 'ACTIVE')
      throw new AuthError(409, 'CAMERA_DISABLED', 'Camera is disabled');
    const requestedConnection =
      input.type === 'CAMERA_ONLINE'
        ? 'ONLINE'
        : input.type === 'CAMERA_OFFLINE'
          ? 'OFFLINE'
          : null;
    if (requestedConnection && camera.connectionStatus === requestedConnection) {
      console.info(
        JSON.stringify({
          event: 'event.transition_ignored',
          organizationId: auth.organizationId,
          gatewayId: auth.gatewayId,
          cameraId: camera.id,
          eventType: input.type,
        }),
      );
      return { event: null, duplicate: true, ignored: true };
    }

    const metadata =
      input.type === 'MOTION' && input.motionScore !== undefined
        ? ({
            motionScore: Math.round(input.motionScore * 10_000) / 10_000,
          } as Prisma.InputJsonObject)
        : undefined;
    if (metadata && Buffer.byteLength(JSON.stringify(metadata)) > env.EVENT_METADATA_MAX_BYTES)
      throw new AuthError(413, 'EVENT_METADATA_TOO_LARGE', 'Event metadata is too large');

    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.cameraEvent.findUnique({
        where: {
          gatewayId_externalEventId: {
            gatewayId: auth.gatewayId,
            externalEventId: input.eventId,
          },
        },
        include: eventInclude,
      });
      if (existing) {
        const event =
          endedAt && (!existing.endedAt || endedAt > existing.endedAt)
            ? await tx.cameraEvent.update({
                where: { id: existing.id },
                data: {
                  endedAt,
                  status: 'RESOLVED',
                  resolvedAt: endedAt,
                  ...(metadata ? { metadata } : {}),
                },
                include: eventInclude,
              })
            : existing;
        return { event, duplicate: true };
      }

      const source = input.type === 'MOTION' ? 'MOTION_DETECTOR' : 'CONNECTIVITY_MONITOR';
      const event = await tx.cameraEvent.create({
        data: {
          organizationId: auth.organizationId,
          gatewayId: auth.gatewayId,
          cameraId: camera.id,
          externalEventId: input.eventId,
          type: input.type,
          source,
          severity:
            input.type === 'MOTION' ? 'LOW' : input.type === 'CAMERA_OFFLINE' ? 'MEDIUM' : 'INFO',
          status: endedAt ? 'RESOLVED' : 'OPEN',
          occurredAt,
          endedAt,
          ...(endedAt ? { resolvedAt: endedAt } : {}),
          ...(metadata ? { metadata } : {}),
        },
        include: eventInclude,
      });
      if (input.type === 'CAMERA_ONLINE' || input.type === 'CAMERA_OFFLINE')
        await tx.camera.update({
          where: { id: camera.id },
          data: {
            connectionStatus: input.type === 'CAMERA_ONLINE' ? 'ONLINE' : 'OFFLINE',
            ...(input.type === 'CAMERA_ONLINE' ? { lastSeenAt: new Date() } : {}),
          },
        });
      return { event, duplicate: false };
    });
    console.info(
      JSON.stringify({
        event: result.duplicate ? 'event.duplicate_ignored' : 'event.created',
        organizationId: auth.organizationId,
        gatewayId: auth.gatewayId,
        cameraId: input.cameraId,
        eventId: input.eventId,
        eventType: input.type,
      }),
    );
    if (!result.duplicate && input.type === 'MOTION' && camera.captureSnapshotOnMotion)
      void this.media
        .requestForEvent(auth.organizationId, camera.id, auth.gatewayId, result.event.id)
        .catch((error: unknown) =>
          console.error(
            JSON.stringify({
              event: 'motion.snapshot_failed',
              organizationId: auth.organizationId,
              gatewayId: auth.gatewayId,
              cameraId: camera.id,
              eventId: result.event.id,
              errorCode: error instanceof AuthError ? error.code : 'UNKNOWN',
            }),
          ),
        );
    if (!result.duplicate && result.event) {
      await this.intelligence
        .process(result.event.id)
        .catch(() =>
          console.error(
            JSON.stringify({ event: 'context.analysis_failed', eventId: result.event!.id }),
          ),
        );
      await this.alerts
        .processEvent(result.event.id)
        .catch(() =>
          console.error(
            JSON.stringify({ event: 'alert.processing_failed', eventId: result.event!.id }),
          ),
        );
    }
    return result;
  }

  async list(
    context: TenantContext,
    query: {
      page: number;
      limit: number;
      cameraId?: string | undefined;
      gatewayId?: string | undefined;
      type?:
        | 'MOTION'
        | 'CAMERA_OFFLINE'
        | 'CAMERA_ONLINE'
        | 'GATEWAY_OFFLINE'
        | 'GATEWAY_ONLINE'
        | undefined;
      severity?: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | undefined;
      startDate?: string | undefined;
      endDate?: string | undefined;
    },
  ) {
    const where: Prisma.CameraEventWhereInput = {
      organizationId: context.organizationId,
      ...(query.cameraId ? { cameraId: query.cameraId } : {}),
      ...(query.gatewayId ? { gatewayId: query.gatewayId } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.startDate || query.endDate
        ? {
            occurredAt: {
              ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
              ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
            },
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.cameraEvent.findMany({
        where,
        include: eventInclude,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.cameraEvent.count({ where }),
    ]);
    return {
      items,
      pagination: {
        page: query.page,
        limit: query.limit,
        total,
        pages: Math.ceil(total / query.limit),
      },
    };
  }

  async get(context: TenantContext, id: string) {
    const event = await this.prisma.cameraEvent.findFirst({
      where: { id, organizationId: context.organizationId },
      include: eventInclude,
    });
    if (!event) throw new AuthError(404, 'EVENT_NOT_FOUND', 'Event not found');
    return event;
  }

  async gatewayOnline(auth: GatewayAuth, previousStatus: string) {
    if (previousStatus === 'ONLINE' || previousStatus === 'CONNECTING') return;
    const event = await this.prisma.cameraEvent.create({
      data: {
        organizationId: auth.organizationId,
        gatewayId: auth.gatewayId,
        type: 'GATEWAY_ONLINE',
        source: 'GATEWAY_MONITOR',
        severity: 'INFO',
        status: 'RESOLVED',
        occurredAt: new Date(),
        endedAt: new Date(),
        resolvedAt: new Date(),
      },
    });
    await this.alerts
      .processEvent(event.id)
      .catch(() =>
        console.error(JSON.stringify({ event: 'alert.processing_failed', eventId: event.id })),
      );
    console.info(
      JSON.stringify({
        event: 'gateway.online',
        organizationId: auth.organizationId,
        gatewayId: auth.gatewayId,
      }),
    );
  }

  async reconcileOfflineGateways() {
    const cutoff = new Date(Date.now() - env.GATEWAY_OFFLINE_TIMEOUT_SECONDS * 1000);
    const gateways = await this.prisma.gateway.findMany({
      where: {
        status: { in: ['ONLINE', 'CONNECTING'] },
        lastSeenAt: { lt: cutoff },
        deletedAt: null,
      },
      select: { id: true, organizationId: true },
    });
    for (const gateway of gateways) {
      const eventId = await this.prisma.$transaction(async (tx) => {
        const changed = await tx.gateway.updateMany({
          where: {
            id: gateway.id,
            status: { in: ['ONLINE', 'CONNECTING'] },
            lastSeenAt: { lt: cutoff },
          },
          data: { status: 'OFFLINE' },
        });
        if (!changed.count) return null;
        const event = await tx.cameraEvent.create({
          data: {
            organizationId: gateway.organizationId,
            gatewayId: gateway.id,
            type: 'GATEWAY_OFFLINE',
            source: 'GATEWAY_MONITOR',
            severity: 'MEDIUM',
            occurredAt: new Date(),
          },
        });
        return event.id;
      });
      if (eventId)
        await this.alerts
          .processEvent(eventId)
          .catch(() =>
            console.error(JSON.stringify({ event: 'alert.processing_failed', eventId })),
          );
      console.info(
        JSON.stringify({
          event: 'gateway.offline',
          organizationId: gateway.organizationId,
          gatewayId: gateway.id,
        }),
      );
    }
    return gateways.length;
  }
}
