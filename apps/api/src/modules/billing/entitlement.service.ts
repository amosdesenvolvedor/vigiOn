import { Prisma, type PrismaClient } from '@prisma/client';
import { AuthError } from '../auth/auth.errors';
import { PlanLimitError, type LimitedResource } from './plan-limit.error';

export type PlanFeature =
  | 'LIVE_VIEW'
  | 'CLOUD_STORAGE'
  | 'RECORDING'
  | 'MOTION_DETECTION'
  | 'PERSON_DETECTION'
  | 'SMART_ALERTS'
  | 'MULTI_USER'
  | 'ADVANCED_EVENTS';

const currentStatuses = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED'] as const;

export class EntitlementService {
  constructor(private readonly prisma: PrismaClient) {}

  async getEntitlements(organizationId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { organizationId, status: { in: [...currentStatuses] } },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) throw new AuthError(403, 'SUBSCRIPTION_REQUIRED', 'Subscription required');
    const now = new Date();
    const usable =
      subscription.status !== 'PAST_DUE' &&
      (subscription.status !== 'CANCELED' || subscription.currentPeriodEnd > now) &&
      subscription.currentPeriodEnd > now;
    if (!usable) throw new AuthError(403, 'SUBSCRIPTION_INACTIVE', 'Subscription is not active');
    const features = Array.isArray(subscription.plan.enabledFeatures)
      ? (subscription.plan.enabledFeatures as PlanFeature[])
      : [];
    return { subscription, plan: subscription.plan, features };
  }

  async hasFeature(organizationId: string, feature: PlanFeature) {
    const { features } = await this.getEntitlements(organizationId);
    return features.includes(feature);
  }

  async requireFeature(organizationId: string, feature: PlanFeature) {
    if (!(await this.hasFeature(organizationId, feature)))
      throw new AuthError(403, 'FEATURE_NOT_AVAILABLE', 'Feature requires a different plan');
  }

  async getUsage(organizationId: string) {
    const [{ plan }, cameras, members, invitations, storage] = await Promise.all([
      this.getEntitlements(organizationId),
      this.prisma.camera.count({ where: { organizationId, deletedAt: null } }),
      this.prisma.organizationMembership.count({
        where: { organizationId, status: { not: 'REMOVED' } },
      }),
      this.prisma.organizationInvitation.count({
        where: { organizationId, status: 'PENDING', expiresAt: { gt: new Date() } },
      }),
      this.prisma.storageUsage.findUnique({ where: { organizationId } }),
    ]);
    const usedBytes = storage?.usedBytes ?? 0n;
    const reservedBytes = storage?.reservedBytes ?? 0n;
    return {
      cameras: { current: cameras, limit: plan.maxCameras },
      users: { current: members + invitations, limit: plan.maxUsers },
      storage: {
        usedBytes: usedBytes.toString(),
        reservedBytes: reservedBytes.toString(),
        limitBytes: plan.maxStorageBytes.toString(),
        availableBytes: (plan.maxStorageBytes - usedBytes - reservedBytes).toString(),
      },
      retentionDays: plan.retentionDays,
    };
  }

  reserveCamera(organizationId: string) {
    return this.reserveCount(organizationId, 'CAMERAS');
  }

  reserveMember(organizationId: string) {
    return this.reserveCount(organizationId, 'USERS');
  }

  releaseCamera(organizationId: string) {
    return this.releaseCount(organizationId, 'cameraCount');
  }

  releaseMember(organizationId: string) {
    return this.releaseCount(organizationId, 'memberCount');
  }

  async reserveStorage(organizationId: string, bytes: bigint) {
    if (bytes <= 0n)
      throw new AuthError(400, 'INVALID_STORAGE_SIZE', 'Storage size must be positive');
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { plan } = await this.getEntitlementsWith(tx, organizationId);
        await tx.$queryRaw`SELECT id FROM StorageUsage WHERE organizationId = ${organizationId} FOR UPDATE`;
        const usage = await tx.storageUsage.upsert({
          where: { organizationId },
          create: { organizationId },
          update: {},
        });
        const current = usage.usedBytes + usage.reservedBytes;
        if (current + bytes > plan.maxStorageBytes)
          throw new PlanLimitError('STORAGE', current, plan.maxStorageBytes);
        const updated = await tx.storageUsage.update({
          where: { organizationId },
          data: { reservedBytes: { increment: bytes }, version: { increment: 1 } },
        });
        await this.thresholdEvents(
          tx,
          organizationId,
          'STORAGE',
          updated.usedBytes + updated.reservedBytes,
          plan.maxStorageBytes,
        );
        return updated;
      });
    } catch (error) {
      if (error instanceof PlanLimitError) await this.recordLimit(error, organizationId);
      throw error;
    }
  }

  async commitStorage(organizationId: string, bytes: bigint) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM StorageUsage WHERE organizationId = ${organizationId} FOR UPDATE`;
      const usage = await tx.storageUsage.findUniqueOrThrow({ where: { organizationId } });
      if (bytes <= 0n || usage.reservedBytes < bytes)
        throw new AuthError(409, 'INVALID_STORAGE_RESERVATION', 'Invalid storage reservation');
      return tx.storageUsage.update({
        where: { organizationId },
        data: {
          reservedBytes: { decrement: bytes },
          usedBytes: { increment: bytes },
          fileCount: { increment: 1 },
          version: { increment: 1 },
        },
      });
    });
  }

  async releaseStorage(organizationId: string, bytes: bigint) {
    if (bytes <= 0n)
      throw new AuthError(400, 'INVALID_STORAGE_SIZE', 'Storage size must be positive');
    const result = await this.prisma.storageUsage.updateMany({
      where: { organizationId, reservedBytes: { gte: bytes } },
      data: { reservedBytes: { decrement: bytes }, version: { increment: 1 } },
    });
    if (!result.count)
      throw new AuthError(409, 'INVALID_STORAGE_RESERVATION', 'Invalid storage reservation');
    return result;
  }

  async reconcileStorage(organizationId: string) {
    const result = await this.prisma.storageFile.aggregate({
      where: { organizationId },
      _sum: { sizeBytes: true },
      _count: { id: true },
    });
    return this.prisma.storageUsage.upsert({
      where: { organizationId },
      create: {
        organizationId,
        usedBytes: result._sum.sizeBytes ?? 0n,
        fileCount: result._count.id,
        calculatedAt: new Date(),
      },
      update: {
        usedBytes: result._sum.sizeBytes ?? 0n,
        fileCount: result._count.id,
        calculatedAt: new Date(),
        version: { increment: 1 },
      },
    });
  }

  private async reserveCount(
    organizationId: string,
    resource: Exclude<LimitedResource, 'STORAGE'>,
  ) {
    const field = resource === 'CAMERAS' ? 'cameraCount' : 'memberCount';
    try {
      return await this.prisma.$transaction(async (tx) => {
        const { plan } = await this.getEntitlementsWith(tx, organizationId);
        const limit = resource === 'CAMERAS' ? plan.maxCameras : plan.maxUsers;
        await tx.resourceCounter.upsert({
          where: { organizationId },
          create: {
            organizationId,
            cameraCount: await tx.camera.count({ where: { organizationId, deletedAt: null } }),
            memberCount:
              (await tx.organizationMembership.count({
                where: { organizationId, status: { not: 'REMOVED' } },
              })) +
              (await tx.organizationInvitation.count({
                where: { organizationId, status: 'PENDING', expiresAt: { gt: new Date() } },
              })),
          },
          update: {},
        });
        const result = await tx.resourceCounter.updateMany({
          where: { organizationId, [field]: { lt: limit } },
          data: { [field]: { increment: 1 }, version: { increment: 1 } },
        });
        if (!result.count) {
          const counter = await tx.resourceCounter.findUniqueOrThrow({ where: { organizationId } });
          throw new PlanLimitError(resource, counter[field], limit);
        }
        return tx.resourceCounter.findUniqueOrThrow({ where: { organizationId } });
      });
    } catch (error) {
      if (error instanceof PlanLimitError) await this.recordLimit(error, organizationId);
      throw error;
    }
  }

  private releaseCount(organizationId: string, field: 'cameraCount' | 'memberCount') {
    return this.prisma.resourceCounter.updateMany({
      where: { organizationId, [field]: { gt: 0 } },
      data: { [field]: { decrement: 1 }, version: { increment: 1 } },
    });
  }

  private getEntitlementsWith(tx: Prisma.TransactionClient, organizationId: string) {
    return tx.subscription
      .findFirst({
        where: {
          organizationId,
          status: { in: ['TRIALING', 'ACTIVE', 'CANCELED'] },
          currentPeriodEnd: { gt: new Date() },
        },
        include: { plan: true },
        orderBy: { createdAt: 'desc' },
      })
      .then((subscription) => {
        if (!subscription)
          throw new AuthError(403, 'SUBSCRIPTION_REQUIRED', 'Subscription required');
        return { subscription, plan: subscription.plan };
      });
  }

  private async recordLimit(error: PlanLimitError, organizationId: string) {
    await this.prisma.$transaction([
      this.prisma.limitEvent.create({
        data: {
          organizationId,
          type: 'LIMIT_REACHED',
          resource: error.resource,
          currentValue: BigInt(error.current),
          limitValue: BigInt(error.limit),
        },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId,
          action: 'LIMIT_REACHED',
          entityType: 'Plan',
          metadata: {
            resource: error.resource,
            current: error.current.toString(),
            limit: error.limit.toString(),
          },
        },
      }),
    ]);
  }

  private async thresholdEvents(
    tx: Prisma.TransactionClient,
    organizationId: string,
    resource: LimitedResource,
    current: bigint,
    limit: bigint,
  ) {
    if (limit <= 0n) return;
    const percentage = Number((current * 100n) / limit);
    const threshold =
      percentage >= 100 ? 100 : percentage >= 90 ? 90 : percentage >= 80 ? 80 : null;
    if (threshold)
      await tx.limitEvent.create({
        data: {
          organizationId,
          type: 'LIMIT_THRESHOLD',
          resource,
          threshold,
          currentValue: current,
          limitValue: limit,
        },
      });
  }
}
