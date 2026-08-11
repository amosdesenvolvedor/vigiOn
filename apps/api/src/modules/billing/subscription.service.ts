import { Prisma, type PrismaClient, type SubscriptionStatus } from '@prisma/client';
import { AuthError } from '../auth/auth.errors';
import type { RequestMetadata } from '../auth/auth.types';
import type { TenantContext } from '../tenancy/tenant-context';

const limitsSnapshot = (plan: {
  maxCameras: number;
  maxStorageBytes: bigint;
  retentionDays: number;
  maxUsers: number;
}) => ({
  maxCameras: plan.maxCameras,
  maxStorageBytes: plan.maxStorageBytes.toString(),
  retentionDays: plan.retentionDays,
  maxUsers: plan.maxUsers,
});

export class SubscriptionService {
  constructor(private readonly prisma: PrismaClient) {}

  listPlans() {
    return this.prisma.plan.findMany({
      where: { status: 'ACTIVE', isPublic: true },
      orderBy: [{ priceCents: 'asc' }, { code: 'asc' }],
    });
  }

  async getCurrent(organizationId: string) {
    await this.expireTrialIfNeeded(organizationId);
    const subscription = await this.prisma.subscription.findFirst({
      where: { organizationId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) throw new AuthError(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found');
    return {
      ...subscription,
      trial: this.trialState(subscription.trialEndsAt, subscription.status),
    };
  }

  history(organizationId: string) {
    return this.prisma.subscriptionHistory.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async cancel(context: TenantContext, metadata: RequestMetadata) {
    const subscription = await this.currentRecord(context.organizationId);
    if (!['ACTIVE', 'TRIALING'].includes(subscription.status))
      throw new AuthError(409, 'INVALID_SUBSCRIPTION_STATE', 'Subscription cannot be canceled');
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.subscription.update({
        where: { id: subscription.id },
        data: { status: 'CANCELED', canceledAt: new Date(), cancelAtPeriodEnd: true },
        include: { plan: true },
      });
      await this.snapshot(tx, result, 'CUSTOMER_CANCELED');
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: 'SUBSCRIPTION_CANCELED',
          entityType: 'Subscription',
          entityId: result.id,
          ...metadata,
        },
      });
      return result;
    });
    return updated;
  }

  async reactivate(context: TenantContext, metadata: RequestMetadata) {
    const subscription = await this.currentRecord(context.organizationId);
    if (subscription.status !== 'CANCELED' || subscription.currentPeriodEnd <= new Date())
      throw new AuthError(409, 'INVALID_SUBSCRIPTION_STATE', 'Subscription cannot be reactivated');
    const status: SubscriptionStatus =
      subscription.trialEndsAt && subscription.trialEndsAt > new Date() ? 'TRIALING' : 'ACTIVE';
    return this.prisma.$transaction(async (tx) => {
      const result = await tx.subscription.update({
        where: { id: subscription.id },
        data: { status, canceledAt: null, cancelAtPeriodEnd: false },
        include: { plan: true },
      });
      await this.snapshot(tx, result, 'CUSTOMER_REACTIVATED');
      await tx.auditLog.create({
        data: {
          organizationId: context.organizationId,
          actorUserId: context.userId,
          action: 'SUBSCRIPTION_REACTIVATED',
          entityType: 'Subscription',
          entityId: result.id,
          ...metadata,
        },
      });
      return result;
    });
  }

  async expireTrialIfNeeded(organizationId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { organizationId, status: 'TRIALING', trialEndsAt: { lte: new Date() } },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) return null;
    const free = await this.prisma.plan.findFirst({
      where: { code: 'FREE', status: 'ACTIVE' },
      orderBy: { version: 'desc' },
    });
    if (!free) throw new AuthError(503, 'FREE_PLAN_UNAVAILABLE', 'Trial transition unavailable');
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.subscription.updateMany({
        where: { id: subscription.id, status: 'TRIALING' },
        data: { status: 'EXPIRED', endedAt: now },
      });
      if (!claimed.count) return null;
      await this.snapshot(tx, { ...subscription, status: 'EXPIRED' }, 'TRIAL_EXPIRED');
      const next = await tx.subscription.create({
        data: {
          organizationId,
          planId: free.id,
          status: 'ACTIVE',
          currentPeriodStart: now,
          currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
        },
        include: { plan: true },
      });
      await this.snapshot(tx, next, 'TRIAL_DOWNGRADE_FREE');
      await tx.auditLog.create({
        data: {
          organizationId,
          action: 'TRIAL_EXPIRED',
          entityType: 'Subscription',
          entityId: subscription.id,
          metadata: { from: subscription.plan.code, to: free.code },
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          action: 'PLAN_CHANGED',
          entityType: 'Subscription',
          entityId: next.id,
          metadata: { from: subscription.plan.code, to: free.code },
        },
      });
      return next;
    });
  }

  trialState(trialEndsAt: Date | null, status: SubscriptionStatus) {
    if (!trialEndsAt) return { state: 'NONE', daysRemaining: null };
    const remainingMs = trialEndsAt.getTime() - Date.now();
    const daysRemaining = Math.max(0, Math.ceil(remainingMs / 86_400_000));
    if (status === 'EXPIRED' || remainingMs <= 0) return { state: 'EXPIRED', daysRemaining: 0 };
    return { state: daysRemaining <= 3 ? 'EXPIRING' : 'ACTIVE', daysRemaining };
  }

  private async currentRecord(organizationId: string) {
    const subscription = await this.prisma.subscription.findFirst({
      where: { organizationId },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!subscription) throw new AuthError(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found');
    return subscription;
  }

  private snapshot(
    tx: Prisma.TransactionClient,
    subscription: {
      id: string;
      organizationId: string;
      planId: string;
      status: SubscriptionStatus;
      currentPeriodStart: Date;
      currentPeriodEnd: Date;
      plan: {
        code: string;
        version: number;
        maxCameras: number;
        maxStorageBytes: bigint;
        retentionDays: number;
        maxUsers: number;
        enabledFeatures: Prisma.JsonValue;
      };
    },
    reason: string,
  ) {
    return tx.subscriptionHistory.create({
      data: {
        organizationId: subscription.organizationId,
        subscriptionId: subscription.id,
        planId: subscription.planId,
        planCode: subscription.plan.code,
        planVersion: subscription.plan.version,
        status: subscription.status,
        reason,
        limitsSnapshot: limitsSnapshot(subscription.plan),
        featuresSnapshot: subscription.plan.enabledFeatures as Prisma.InputJsonValue,
        periodStart: subscription.currentPeriodStart,
        periodEnd: subscription.currentPeriodEnd,
      },
    });
  }
}
