import type { Prisma, PrismaClient } from '@prisma/client';
import { AuthError } from '../auth/auth.errors';

type Page = { page: number; limit: number };
const pagination = (page: number, limit: number, total: number) => ({
  page,
  limit,
  total,
  pages: Math.ceil(total / limit),
});
const bytes = (value: bigint | null | undefined) => (value ?? 0n).toString();

export class PlatformService {
  constructor(private readonly prisma: PrismaClient) {}

  async summary() {
    const since = new Date(Date.now() - 86_400_000);
    const [
      organizationsTotal,
      organizationsActive,
      usersTotal,
      camerasTotal,
      camerasOnline,
      camerasOffline,
      gatewaysTotal,
      gatewaysOnline,
      gatewaysOffline,
      storage,
      openAlerts,
      eventsLast24h,
      highRiskEventsLast24h,
      subscriptions,
      pushActive,
      notificationsFailed,
    ] = await this.prisma.$transaction([
      this.prisma.organization.count({ where: { deletedAt: null } }),
      this.prisma.organization.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.camera.count({ where: { deletedAt: null } }),
      this.prisma.camera.count({ where: { deletedAt: null, connectionStatus: 'ONLINE' } }),
      this.prisma.camera.count({
        where: { deletedAt: null, connectionStatus: { in: ['OFFLINE', 'ERROR'] } },
      }),
      this.prisma.gateway.count({ where: { deletedAt: null } }),
      this.prisma.gateway.count({ where: { deletedAt: null, status: 'ONLINE' } }),
      this.prisma.gateway.count({ where: { deletedAt: null, status: 'OFFLINE' } }),
      this.prisma.storageUsage.aggregate({
        _sum: { usedBytes: true, reservedBytes: true, fileCount: true },
      }),
      this.prisma.alert.count({ where: { status: 'OPEN' } }),
      this.prisma.cameraEvent.count({ where: { occurredAt: { gte: since } } }),
      this.prisma.eventClassification.count({
        where: { createdAt: { gte: since }, riskLevel: { in: ['HIGH', 'VERY_HIGH'] } },
      }),
      this.prisma.subscription.groupBy({
        by: ['status'],
        orderBy: { status: 'asc' },
        _count: true,
      }),
      this.prisma.pushSubscription.count({ where: { revokedAt: null } }),
      this.prisma.notification.count({ where: { status: 'FAILED' } }),
    ]);
    return {
      organizationsTotal,
      organizationsActive,
      usersTotal,
      camerasTotal,
      camerasOnline,
      camerasOffline,
      gatewaysTotal,
      gatewaysOnline,
      gatewaysOffline,
      storageUsedBytes: bytes(storage._sum.usedBytes),
      storageReservedBytes: bytes(storage._sum.reservedBytes),
      storageFiles: bytes(storage._sum.fileCount),
      openAlerts,
      eventsLast24h,
      highRiskEventsLast24h,
      subscriptionsByStatus: Object.fromEntries(
        subscriptions.map((item) => [item.status, item._count]),
      ),
      pushSubscriptionsActive: pushActive,
      notificationsFailed,
      generatedAt: new Date(),
    };
  }

  async organizations(
    query: Page & {
      search?: string | undefined;
      status?: 'ACTIVE' | 'SUSPENDED' | 'CANCELED' | undefined;
    },
  ) {
    const where: Prisma.OrganizationWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.search ? { OR: [{ id: query.search }, { name: { contains: query.search } }] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.organization.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          timezone: true,
          createdAt: true,
          _count: {
            select: {
              users: true,
              cameras: { where: { deletedAt: null } },
              gateways: { where: { deletedAt: null } },
            },
          },
          storageUsage: { select: { usedBytes: true, reservedBytes: true, fileCount: true } },
          subscriptions: {
            take: 1,
            orderBy: { createdAt: 'desc' },
            select: {
              status: true,
              trialEndsAt: true,
              plan: { select: { id: true, name: true, code: true, version: true } },
            },
          },
        },
      }),
      this.prisma.organization.count({ where }),
    ]);
    return {
      items: items.map((item) => ({
        ...item,
        storageUsage: item.storageUsage
          ? {
              ...item.storageUsage,
              usedBytes: bytes(item.storageUsage.usedBytes),
              reservedBytes: bytes(item.storageUsage.reservedBytes),
              fileCount: bytes(item.storageUsage.fileCount),
            }
          : null,
      })),
      pagination: pagination(query.page, query.limit, total),
    };
  }

  async organization(id: string) {
    const item = await this.prisma.organization.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        name: true,
        slug: true,
        status: true,
        timezone: true,
        createdAt: true,
        updatedAt: true,
        users: {
          take: 20,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
            status: true,
            emailVerifiedAt: true,
            createdAt: true,
          },
        },
        subscriptions: {
          take: 5,
          orderBy: { createdAt: 'desc' },
          include: {
            plan: {
              select: {
                id: true,
                name: true,
                code: true,
                version: true,
                maxCameras: true,
                maxUsers: true,
                maxStorageBytes: true,
                retentionDays: true,
                enabledFeatures: true,
              },
            },
          },
        },
        storageUsage: true,
        _count: {
          select: { users: true, cameras: true, gateways: true, events: true, alerts: true },
        },
      },
    });
    if (!item) throw new AuthError(404, 'ORGANIZATION_NOT_FOUND', 'Organization not found');
    return {
      ...item,
      storageUsage: item.storageUsage
        ? {
            ...item.storageUsage,
            usedBytes: bytes(item.storageUsage.usedBytes),
            reservedBytes: bytes(item.storageUsage.reservedBytes),
            fileCount: bytes(item.storageUsage.fileCount),
          }
        : null,
      subscriptions: item.subscriptions.map((subscription) => ({
        ...subscription,
        plan: { ...subscription.plan, maxStorageBytes: bytes(subscription.plan.maxStorageBytes) },
      })),
    };
  }

  async users(query: Page) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: { deletedAt: null },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          platformRole: true,
          status: true,
          emailVerifiedAt: true,
          createdAt: true,
          organization: { select: { id: true, name: true } },
        },
      }),
      this.prisma.user.count({ where: { deletedAt: null } }),
    ]);
    return { items, pagination: pagination(query.page, query.limit, total) };
  }

  async plans(query: Page) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.plan.findMany({
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ code: 'asc' }, { version: 'desc' }],
        select: {
          id: true,
          name: true,
          slug: true,
          code: true,
          version: true,
          status: true,
          maxCameras: true,
          maxUsers: true,
          maxStorageBytes: true,
          retentionDays: true,
          trialDays: true,
          enabledFeatures: true,
          isPublic: true,
          _count: { select: { subscriptions: true } },
        },
      }),
      this.prisma.plan.count(),
    ]);
    return {
      items: items.map((item) => ({ ...item, maxStorageBytes: bytes(item.maxStorageBytes) })),
      pagination: pagination(query.page, query.limit, total),
    };
  }

  async subscriptions(query: Page) {
    const [items, total] = await this.prisma.$transaction([
      this.prisma.subscription.findMany({
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          status: true,
          startedAt: true,
          trialEndsAt: true,
          currentPeriodStart: true,
          currentPeriodEnd: true,
          cancelAtPeriodEnd: true,
          organization: { select: { id: true, name: true } },
          plan: { select: { id: true, name: true, code: true, version: true } },
        },
      }),
      this.prisma.subscription.count(),
    ]);
    return { items, pagination: pagination(query.page, query.limit, total) };
  }

  async payments(query: Page) {
    return this.paged(
      this.prisma.payment,
      query,
      {},
      {
        id: true,
        status: true,
        amountCents: true,
        currency: true,
        paymentMethod: true,
        paidAt: true,
        createdAt: true,
        organization: { select: { id: true, name: true } },
      },
    );
  }

  async invoices(query: Page) {
    return this.paged(
      this.prisma.invoice,
      query,
      {},
      {
        id: true,
        status: true,
        amountCents: true,
        currency: true,
        periodStart: true,
        periodEnd: true,
        dueAt: true,
        paidAt: true,
        createdAt: true,
        organization: { select: { id: true, name: true } },
      },
    );
  }

  async cameras(query: Page) {
    return this.paged(
      this.prisma.camera,
      query,
      { deletedAt: null },
      {
        id: true,
        name: true,
        administrativeStatus: true,
        connectionStatus: true,
        manufacturer: true,
        model: true,
        lastSeenAt: true,
        organization: { select: { id: true, name: true } },
        gateway: { select: { id: true, name: true, status: true } },
      },
    );
  }
  async gateways(query: Page) {
    return this.paged(
      this.prisma.gateway,
      query,
      { deletedAt: null },
      {
        id: true,
        name: true,
        status: true,
        version: true,
        protocolVersion: true,
        lastSeenAt: true,
        organization: { select: { id: true, name: true } },
        _count: { select: { cameras: true } },
      },
    );
  }
  async events(query: Page) {
    return this.paged(
      this.prisma.cameraEvent,
      query,
      {},
      {
        id: true,
        type: true,
        severity: true,
        status: true,
        occurredAt: true,
        organization: { select: { id: true, name: true } },
        camera: { select: { id: true, name: true } },
        gateway: { select: { id: true, name: true } },
        classifications: {
          take: 1,
          orderBy: { engineVersion: 'desc' },
          select: {
            classification: true,
            riskLevel: true,
            riskScore: true,
            riskFactors: true,
            explanation: true,
          },
        },
      },
    );
  }
  async alerts(query: Page) {
    return this.paged(
      this.prisma.alert,
      query,
      {},
      {
        id: true,
        title: true,
        severity: true,
        status: true,
        createdAt: true,
        organization: { select: { id: true, name: true } },
        event: {
          select: {
            id: true,
            type: true,
            camera: { select: { id: true, name: true } },
            gateway: { select: { id: true, name: true } },
          },
        },
      },
    );
  }

  async storage(query: Page) {
    const [items, total, aggregate] = await this.prisma.$transaction([
      this.prisma.storageUsage.findMany({
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { usedBytes: 'desc' },
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              subscriptions: {
                take: 1,
                orderBy: { createdAt: 'desc' },
                select: { plan: { select: { maxStorageBytes: true } } },
              },
            },
          },
        },
      }),
      this.prisma.storageUsage.count(),
      this.prisma.storageUsage.aggregate({
        _sum: { usedBytes: true, reservedBytes: true, fileCount: true },
      }),
    ]);
    return {
      totals: {
        usedBytes: bytes(aggregate._sum.usedBytes),
        reservedBytes: bytes(aggregate._sum.reservedBytes),
        fileCount: bytes(aggregate._sum.fileCount),
      },
      items: items.map((item) => ({
        id: item.id,
        organization: { id: item.organization.id, name: item.organization.name },
        usedBytes: bytes(item.usedBytes),
        reservedBytes: bytes(item.reservedBytes),
        fileCount: bytes(item.fileCount),
        limitBytes: bytes(item.organization.subscriptions[0]?.plan.maxStorageBytes),
        updatedAt: item.updatedAt,
      })),
      pagination: pagination(query.page, query.limit, total),
    };
  }

  async audit(query: Page) {
    return this.paged(
      this.prisma.platformAuditLog,
      query,
      {},
      {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        reason: true,
        createdAt: true,
        actorUser: { select: { id: true, name: true, email: true } },
      },
    );
  }

  async notifications() {
    const [deliveries, pushActive, pushRevoked] = await this.prisma.$transaction([
      this.prisma.notification.groupBy({
        by: ['channel', 'status'],
        orderBy: [{ channel: 'asc' }, { status: 'asc' }],
        _count: true,
      }),
      this.prisma.pushSubscription.count({ where: { revokedAt: null } }),
      this.prisma.pushSubscription.count({ where: { revokedAt: { not: null } } }),
    ]);
    return {
      deliveries: deliveries.map((item) => ({
        channel: item.channel,
        status: item.status,
        count: item._count,
      })),
      pushSubscriptions: {
        active: pushActive,
        revoked: pushRevoked,
      },
    };
  }

  // Prisma delegates share these methods but do not expose a common public generic interface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async paged(model: any, query: Page, where: object, select: object) {
    const [items, total] = await this.prisma.$transaction([
      model.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        select,
      }),
      model.count({ where }),
    ]);
    return { items, pagination: pagination(query.page, query.limit, total) };
  }
}
