import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EmailMessage, EmailProvider } from './email.provider';
import { AlertService, NotificationService } from './notification.service';

class MockEmailProvider implements EmailProvider {
  messages: EmailMessage[] = [];
  fail = false;
  async send(message: EmailMessage) {
    if (this.fail) throw new Error('MOCK_FAILURE');
    this.messages.push(message);
  }
}
const prisma = new PrismaClient();
const provider = new MockEmailProvider();
const notifications = new NotificationService(prisma, provider);
const alerts = new AlertService(prisma);
const suffix = randomUUID().slice(0, 8);
const organizationIds: string[] = [];
async function tenant(label: string) {
  const organization = await prisma.organization.create({
    data: {
      name: label,
      slug: `notify-${label}-${suffix}`,
      resourceCounter: { create: {} },
      storageUsage: { create: {} },
    },
  });
  organizationIds.push(organization.id);
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      name: label,
      email: `${label}-${suffix}@test.invalid`,
      normalizedEmail: `${label}-${suffix}@test.invalid`,
      passwordHash: 'x',
      role: 'OWNER',
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
    },
  });
  const membership = await prisma.organizationMembership.create({
    data: { organizationId: organization.id, userId: user.id, role: 'OWNER', status: 'ACTIVE' },
  });
  const gateway = await prisma.gateway.create({
    data: {
      organizationId: organization.id,
      name: 'Edge',
      deviceId: randomUUID(),
      secretHash: 'x',
    },
  });
  const camera = await prisma.camera.create({
    data: {
      organizationId: organization.id,
      gatewayId: gateway.id,
      name: 'Entrada',
      protocol: 'RTSP',
    },
  });
  return {
    organization,
    user,
    gateway,
    camera,
    context: {
      organizationId: organization.id,
      userId: user.id,
      membershipId: membership.id,
      role: 'OWNER' as const,
    },
  };
}
async function event(
  current: Awaited<ReturnType<typeof tenant>>,
  type: 'MOTION' | 'CAMERA_OFFLINE' | 'CAMERA_ONLINE' | 'GATEWAY_OFFLINE' | 'GATEWAY_ONLINE',
) {
  return prisma.cameraEvent.create({
    data: {
      organizationId: current.organization.id,
      cameraId: type.startsWith('CAMERA') || type === 'MOTION' ? current.camera.id : null,
      gatewayId: current.gateway.id,
      type,
      source:
        type === 'MOTION'
          ? 'MOTION_DETECTOR'
          : type.startsWith('GATEWAY')
            ? 'GATEWAY_MONITOR'
            : 'CONNECTIVITY_MONITOR',
      severity: type === 'MOTION' ? 'LOW' : 'MEDIUM',
      occurredAt: new Date(),
    },
  });
}
beforeAll(() => prisma.$connect());
afterAll(async () => {
  await prisma.notification.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.notificationPreference.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.alert.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.cameraEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.camera.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.gateway.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organizationMembership.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.storageUsage.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.resourceCounter.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await prisma.$disconnect();
});

describe('alerts and notifications', () => {
  it('creates one alert and in-app notification idempotently, then recovery resolves it', async () => {
    const current = await tenant('flow');
    const offline = await event(current, 'CAMERA_OFFLINE');
    await alerts.processEvent(offline.id);
    await alerts.processEvent(offline.id);
    expect(await prisma.alert.count({ where: { eventId: offline.id } })).toBe(1);
    expect(
      await prisma.notification.count({ where: { eventId: offline.id, channel: 'IN_APP' } }),
    ).toBe(1);
    expect(await notifications.unreadCount(current.context)).toBe(1);
    const item = (await notifications.list(current.context, 1, 20)).items[0]!;
    await notifications.markRead(current.context, item.id);
    expect(await notifications.unreadCount(current.context)).toBe(0);
    const recovery = await event(current, 'CAMERA_ONLINE');
    await alerts.processEvent(recovery.id);
    expect((await prisma.alert.findUniqueOrThrow({ where: { eventId: offline.id } })).status).toBe(
      'RESOLVED',
    );
  });
  it('respects channel preferences and delivers email with retry state', async () => {
    const current = await tenant('email');
    await notifications.updatePreference(
      current.context,
      { eventType: 'MOTION', channel: 'EMAIL', enabled: true, minimumSeverity: 'LOW' },
      {},
    );
    const motion = await event(current, 'MOTION');
    await alerts.processEvent(motion.id);
    expect(
      await prisma.notification.count({
        where: { eventId: motion.id, channel: 'EMAIL', status: 'PENDING' },
      }),
    ).toBe(1);
    await notifications.dispatchBatch();
    expect(provider.messages).toHaveLength(1);
    expect(
      (
        await prisma.notification.findFirstOrThrow({
          where: { eventId: motion.id, channel: 'EMAIL' },
        })
      ).status,
    ).toBe('SENT');
    await notifications.updatePreference(
      current.context,
      { eventType: 'CAMERA_OFFLINE', channel: 'IN_APP', enabled: false, minimumSeverity: 'INFO' },
      {},
    );
    const offline = await event(current, 'CAMERA_OFFLINE');
    await alerts.processEvent(offline.id);
    expect(await prisma.notification.count({ where: { eventId: offline.id } })).toBe(0);
  });
  it('blocks cross-user reads, preferences and alert acknowledgement by tenant scope', async () => {
    const a = await tenant('a');
    const b = await tenant('b');
    const motion = await event(b, 'MOTION');
    const alert = await alerts.processEvent(motion.id);
    const note = await prisma.notification.findFirstOrThrow({ where: { eventId: motion.id } });
    await expect(notifications.markRead(a.context, note.id)).rejects.toMatchObject({
      code: 'NOTIFICATION_NOT_FOUND',
    });
    await expect(alerts.acknowledge(a.context, alert!.id, {})).rejects.toMatchObject({
      code: 'ALERT_NOT_FOUND',
    });
    expect(
      (await alerts.list(a.context, { page: 1, limit: 20 })).items.some(
        (item) => item.id === alert!.id,
      ),
    ).toBe(false);
  });
});
