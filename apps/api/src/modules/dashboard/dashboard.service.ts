import type { PrismaClient } from '@prisma/client';
import type { TenantContext } from '../tenancy/tenant-context';

export class DashboardService {
  constructor(private readonly prisma: PrismaClient) {}
  async summary(context: TenantContext) {
    const organizationId = context.organizationId;
    const since = new Date(Date.now() - 24 * 3600_000);
    const [
      camerasOnline,
      camerasOffline,
      camerasTotal,
      gatewaysOnline,
      gatewaysOffline,
      gatewaysTotal,
      openAlerts,
      events24h,
      highRisk24h,
      cameras,
      gateways,
      events,
      alerts,
      unreadNotifications,
    ] = await this.prisma.$transaction([
      this.prisma.camera.count({
        where: { organizationId, deletedAt: null, connectionStatus: 'ONLINE' },
      }),
      this.prisma.camera.count({
        where: { organizationId, deletedAt: null, connectionStatus: { in: ['OFFLINE', 'ERROR'] } },
      }),
      this.prisma.camera.count({ where: { organizationId, deletedAt: null } }),
      this.prisma.gateway.count({ where: { organizationId, deletedAt: null, status: 'ONLINE' } }),
      this.prisma.gateway.count({ where: { organizationId, deletedAt: null, status: 'OFFLINE' } }),
      this.prisma.gateway.count({ where: { organizationId, deletedAt: null } }),
      this.prisma.alert.count({ where: { organizationId, status: 'OPEN' } }),
      this.prisma.cameraEvent.count({ where: { organizationId, occurredAt: { gte: since } } }),
      this.prisma.eventClassification.count({
        where: {
          organizationId,
          createdAt: { gte: since },
          riskLevel: { in: ['HIGH', 'VERY_HIGH'] },
        },
      }),
      this.prisma.camera.findMany({
        where: { organizationId, deletedAt: null },
        take: 50,
        orderBy: [{ connectionStatus: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          gatewayId: true,
          name: true,
          location: true,
          administrativeStatus: true,
          connectionStatus: true,
          lastSeenAt: true,
          gateway: { select: { name: true, status: true } },
        },
      }),
      this.prisma.gateway.findMany({
        where: { organizationId, deletedAt: null },
        take: 20,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          status: true,
          version: true,
          lastSeenAt: true,
          _count: { select: { cameras: { where: { deletedAt: null } } } },
        },
      }),
      this.prisma.cameraEvent.findMany({
        where: { organizationId },
        take: 20,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        include: {
          camera: { select: { id: true, name: true, location: true } },
          gateway: { select: { id: true, name: true } },
          classifications: { orderBy: { engineVersion: 'desc' }, take: 1 },
          storageFiles: {
            where: { status: 'AVAILABLE', deletedAt: null },
            take: 1,
            select: { id: true, type: true, mimeType: true },
          },
        },
      }),
      this.prisma.alert.findMany({
        where: { organizationId },
        take: 20,
        orderBy: [{ status: 'asc' }, { severity: 'desc' }, { createdAt: 'desc' }],
        include: {
          event: {
            include: {
              camera: { select: { name: true } },
              gateway: { select: { name: true } },
              classifications: { orderBy: { engineVersion: 'desc' }, take: 1 },
            },
          },
        },
      }),
      this.prisma.notification.count({
        where: { organizationId, userId: context.userId, channel: 'IN_APP', readAt: null },
      }),
    ]);
    return {
      metrics: {
        camerasOnline,
        camerasOffline,
        camerasTotal,
        gatewaysOnline,
        gatewaysOffline,
        gatewaysTotal,
        openAlerts,
        events24h,
        highRisk24h,
        unreadNotifications,
      },
      cameras,
      gateways,
      events,
      alerts,
      generatedAt: new Date(),
    };
  }
}
