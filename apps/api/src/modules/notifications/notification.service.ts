import {
  Prisma,
  type CameraEventType,
  type EventSeverity,
  type NotificationChannel,
  type PrismaClient,
} from '@prisma/client';
import { env } from '../../config/env';
import { AuthError } from '../auth/auth.errors';
import type { TenantContext } from '../tenancy/tenant-context';
import type { RequestMetadata } from '../auth/auth.types';
import { AlertPolicyService } from './alert-policy.service';
import { emailProvider, escapeHtml, type EmailProvider } from './email.provider';
import { realtimeService } from '../realtime/realtime.service';

const types: CameraEventType[] = [
  'MOTION',
  'CAMERA_OFFLINE',
  'CAMERA_ONLINE',
  'GATEWAY_OFFLINE',
  'GATEWAY_ONLINE',
];
const channels: NotificationChannel[] = ['IN_APP', 'EMAIL'];

export class NotificationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly provider: EmailProvider = emailProvider,
  ) {}

  async list(context: TenantContext, page: number, limit: number) {
    const where = {
      organizationId: context.organizationId,
      userId: context.userId,
      channel: 'IN_APP' as const,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          alert: {
            select: {
              id: true,
              status: true,
              severity: true,
              eventId: true,
              cameraId: true,
              gatewayId: true,
            },
          },
        },
      }),
      this.prisma.notification.count({ where }),
    ]);
    return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
  }
  unreadCount(context: TenantContext) {
    return this.prisma.notification.count({
      where: {
        organizationId: context.organizationId,
        userId: context.userId,
        channel: 'IN_APP',
        readAt: null,
      },
    });
  }
  async markRead(context: TenantContext, id: string) {
    const changed = await this.prisma.notification.updateMany({
      where: {
        id,
        organizationId: context.organizationId,
        userId: context.userId,
        channel: 'IN_APP',
      },
      data: { readAt: new Date() },
    });
    if (!changed.count)
      throw new AuthError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
    console.info(
      JSON.stringify({
        event: 'notification.read',
        organizationId: context.organizationId,
        userId: context.userId,
        notificationId: id,
      }),
    );
  }
  async markAllRead(context: TenantContext) {
    return this.prisma.notification.updateMany({
      where: {
        organizationId: context.organizationId,
        userId: context.userId,
        channel: 'IN_APP',
        readAt: null,
      },
      data: { readAt: new Date() },
    });
  }

  async preferences(context: TenantContext) {
    const stored = await this.prisma.notificationPreference.findMany({
      where: { organizationId: context.organizationId, userId: context.userId },
    });
    const byKey = new Map(stored.map((p) => [`${p.eventType}:${p.channel}`, p]));
    return types.flatMap((eventType) =>
      channels.map(
        (channel) =>
          byKey.get(`${eventType}:${channel}`) ?? {
            eventType,
            channel,
            enabled: channel === 'IN_APP',
            minimumSeverity: 'INFO',
          },
      ),
    );
  }
  async updatePreference(
    context: TenantContext,
    input: {
      eventType: CameraEventType;
      channel: 'IN_APP' | 'EMAIL';
      enabled: boolean;
      minimumSeverity: EventSeverity;
    },
    metadata: RequestMetadata,
  ) {
    const preference = await this.prisma.$transaction(async (tx) => {
      const result = await tx.notificationPreference.upsert({
        where: {
          organizationId_userId_eventType_channel: {
            organizationId: context.organizationId,
            userId: context.userId,
            eventType: input.eventType,
            channel: input.channel,
          },
        },
        create: { organizationId: context.organizationId, userId: context.userId, ...input },
        update: { enabled: input.enabled, minimumSeverity: input.minimumSeverity },
      });
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: 'NOTIFICATION_PREFERENCE_CHANGED',
          entityType: 'NotificationPreference',
          entityId: result.id,
          metadata: {
            eventType: input.eventType,
            channel: input.channel,
            enabled: input.enabled,
            minimumSeverity: input.minimumSeverity,
            ...metadata,
          },
        },
      });
      return result;
    });
    console.info(
      JSON.stringify({
        event: 'preference.updated',
        organizationId: context.organizationId,
        userId: context.userId,
        eventType: input.eventType,
        channel: input.channel,
      }),
    );
    return preference;
  }

  async dispatchBatch(limit = 50) {
    const now = new Date();
    const pending = await this.prisma.notification.findMany({
      where: {
        channel: 'EMAIL',
        status: { in: ['PENDING', 'FAILED'] },
        attempts: { lt: env.NOTIFICATION_MAX_ATTEMPTS },
        expiresAt: { gt: now },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      take: limit,
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { email: true, emailVerifiedAt: true } }, alert: true },
    });
    for (const notification of pending) {
      if (!notification.user.emailVerifiedAt) {
        await this.prisma.notification.update({
          where: { id: notification.id },
          data: {
            status: 'FAILED',
            attempts: env.NOTIFICATION_MAX_ATTEMPTS,
            errorCode: 'EMAIL_NOT_VERIFIED',
            nextAttemptAt: null,
          },
        });
        continue;
      }
      try {
        const link = `${env.APP_URL}/?alert=${notification.alertId}`;
        const title = escapeHtml(notification.title);
        const message = escapeHtml(notification.message);
        await this.provider.send({
          to: notification.user.email,
          subject: notification.title,
          text: `${notification.message}\n\nVeja o alerta: ${link}`,
          html: `<h2>${title}</h2><p>${message}</p><p><a href="${link}">Ver alerta no VigiOn</a></p>`,
        });
        await this.prisma.notification.update({
          where: { id: notification.id },
          data: {
            status: 'SENT',
            sentAt: now,
            attempts: { increment: 1 },
            nextAttemptAt: null,
            errorCode: null,
          },
        });
        console.info(
          JSON.stringify({
            event: 'notification.sent',
            organizationId: notification.organizationId,
            userId: notification.userId,
            notificationId: notification.id,
            channel: 'EMAIL',
          }),
        );
      } catch (error) {
        const attempts = notification.attempts + 1;
        await this.prisma.notification.update({
          where: { id: notification.id },
          data: {
            status: 'FAILED',
            attempts,
            nextAttemptAt:
              attempts >= env.NOTIFICATION_MAX_ATTEMPTS
                ? null
                : new Date(Date.now() + Math.min(3600000, 30000 * 2 ** attempts)),
            errorCode: error instanceof Error ? error.message.slice(0, 64) : 'EMAIL_FAILED',
          },
        });
        console.error(
          JSON.stringify({
            event: 'notification.failed',
            organizationId: notification.organizationId,
            notificationId: notification.id,
            channel: 'EMAIL',
          }),
        );
      }
    }
    return pending.length;
  }
}

export class AlertService {
  private readonly policy = new AlertPolicyService();
  constructor(private readonly prisma: PrismaClient) {}
  async processEvent(eventId: string) {
    const event = await this.prisma.cameraEvent.findUnique({
      where: { id: eventId },
      include: {
        camera: { select: { name: true } },
        gateway: { select: { name: true } },
        classifications: { orderBy: { engineVersion: 'desc' }, take: 1 },
      },
    });
    if (!event) return null;
    const recovery = this.policy.recoveryFor(event.type);
    if (recovery) {
      const resolved = await this.prisma.alert.updateMany({
        where: {
          organizationId: event.organizationId,
          status: { in: ['OPEN', 'ACKNOWLEDGED'] },
          event: { type: recovery },
          ...(event.cameraId ? { cameraId: event.cameraId } : { gatewayId: event.gatewayId }),
        },
        data: { status: 'RESOLVED', resolvedAt: event.occurredAt },
      });
      if (resolved.count)
        console.info(
          JSON.stringify({
            event: 'alert.resolved',
            organizationId: event.organizationId,
            eventId: event.id,
            count: resolved.count,
          }),
        );
      if (resolved.count)
        realtimeService.publish(event.organizationId, 'ALERT_CHANGED', event.id, event.occurredAt);
      return null;
    }
    if (!this.policy.shouldCreateAlert(event.type)) return null;
    const subject = event.camera?.name ?? event.gateway?.name ?? 'dispositivo';
    const intelligence = event.classifications[0];
    const copy =
      event.type === 'MOTION'
        ? intelligence?.classification === 'POSSIBLE_INTRUSION'
          ? {
              title: 'Possível intrusão',
              message: `${intelligence.explanation} Câmera: ${subject}.`,
            }
          : intelligence?.classification === 'OUT_OF_HOURS_ACTIVITY'
            ? {
                title: 'Atividade fora do horário',
                message: `${intelligence.explanation} Câmera: ${subject}.`,
              }
            : intelligence?.classification === 'UNUSUAL_ACTIVITY'
              ? {
                  title: 'Atividade incomum',
                  message: `${intelligence.explanation} Câmera: ${subject}.`,
                }
              : { title: 'Movimento detectado', message: `Movimento detectado em ${subject}.` }
        : event.type === 'CAMERA_OFFLINE'
          ? { title: 'Câmera offline', message: `A câmera ${subject} ficou offline.` }
          : { title: 'Gateway offline', message: `O gateway ${subject} ficou offline.` };
    const alert = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.alert.findUnique({ where: { eventId: event.id } });
      if (existing) return existing;
      const created = await tx.alert.create({
        data: {
          organizationId: event.organizationId,
          eventId: event.id,
          cameraId: event.cameraId,
          gatewayId: event.gatewayId,
          severity:
            intelligence?.riskLevel === 'VERY_HIGH'
              ? 'HIGH'
              : intelligence?.riskLevel === 'HIGH'
                ? 'HIGH'
                : event.severity,
          ...copy,
        },
      });
      const recipients = await tx.organizationMembership.findMany({
        where: {
          organizationId: event.organizationId,
          status: 'ACTIVE',
          user: { status: 'ACTIVE', deletedAt: null },
        },
        include: { user: true },
      });
      for (const recipient of recipients.filter((r) => this.policy.isRecipient(r.role))) {
        const preferences = await tx.notificationPreference.findMany({
          where: {
            organizationId: event.organizationId,
            userId: recipient.userId,
            eventType: event.type,
            channel: { in: ['IN_APP', 'EMAIL'] },
          },
        });
        for (const channel of channels) {
          const preference = preferences.find((p) => p.channel === channel);
          const enabled = preference?.enabled ?? this.policy.defaultEnabled(event.type, channel);
          if (
            !enabled ||
            !this.policy.meetsMinimum(created.severity, preference?.minimumSeverity ?? 'INFO')
          )
            continue;
          if (channel === 'EMAIL') {
            const recent = await tx.notification.count({
              where: {
                organizationId: event.organizationId,
                userId: recipient.userId,
                channel: 'EMAIL',
                alert: { event: { type: event.type } },
                createdAt: { gt: new Date(Date.now() - env.EMAIL_COOLDOWN_SECONDS * 1000) },
              },
            });
            if (recent) continue;
          }
          await tx.notification.create({
            data: {
              organizationId: event.organizationId,
              userId: recipient.userId,
              eventId: event.id,
              alertId: created.id,
              channel,
              title: copy.title,
              message: copy.message,
              priority: created.severity === 'HIGH' ? 'HIGH' : 'NORMAL',
              status: channel === 'IN_APP' ? 'DELIVERED' : 'PENDING',
              ...(channel === 'IN_APP'
                ? { deliveredAt: new Date() }
                : {
                    nextAttemptAt: new Date(),
                    expiresAt: new Date(Date.now() + env.NOTIFICATION_TTL_HOURS * 3600000),
                  }),
            },
          });
        }
      }
      return created;
    });
    console.info(
      JSON.stringify({
        event: 'alert.created',
        organizationId: event.organizationId,
        eventId: event.id,
        alertId: alert.id,
      }),
    );
    realtimeService.publish(event.organizationId, 'ALERT_CHANGED', alert.id, event.occurredAt);
    realtimeService.publish(
      event.organizationId,
      'NOTIFICATION_CREATED',
      alert.id,
      event.occurredAt,
    );
    return alert;
  }
  async list(
    context: TenantContext,
    query: {
      page: number;
      limit: number;
      status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED' | undefined;
      severity?: EventSeverity | undefined;
    },
  ) {
    const where: Prisma.AlertWhereInput = {
      organizationId: context.organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.alert.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          event: {
            include: { camera: { select: { name: true } }, gateway: { select: { name: true } } },
          },
        },
      }),
      this.prisma.alert.count({ where }),
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
  async acknowledge(context: TenantContext, id: string, metadata: RequestMetadata) {
    const result = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.alert.updateMany({
        where: { id, organizationId: context.organizationId, status: 'OPEN' },
        data: {
          status: 'ACKNOWLEDGED',
          acknowledgedAt: new Date(),
          acknowledgedById: context.userId,
        },
      });
      if (!changed.count) throw new AuthError(404, 'ALERT_NOT_FOUND', 'Open alert not found');
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: 'ALERT_ACKNOWLEDGED',
          entityType: 'Alert',
          entityId: id,
          ...metadata,
        },
      });
      return changed;
    });
    console.info(
      JSON.stringify({
        event: 'alert.acknowledged',
        organizationId: context.organizationId,
        userId: context.userId,
        alertId: id,
      }),
    );
    realtimeService.publish(context.organizationId, 'ALERT_CHANGED', id);
    return result;
  }
}
