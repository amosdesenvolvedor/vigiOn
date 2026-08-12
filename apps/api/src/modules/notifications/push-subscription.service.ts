import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import { AuthError } from '../auth/auth.errors';
import type { TenantContext } from '../tenancy/tenant-context';

const endpointHash = (endpoint: string) => createHash('sha256').update(endpoint).digest('hex');

export class PushSubscriptionService {
  constructor(private readonly prisma: PrismaClient) {}

  configuration() {
    return {
      available: Boolean(env.WEB_PUSH_VAPID_PUBLIC_KEY && env.WEB_PUSH_VAPID_PRIVATE_KEY),
      publicKey: env.WEB_PUSH_VAPID_PUBLIC_KEY ?? null,
    };
  }

  async subscribe(
    context: TenantContext,
    input: { endpoint: string; keys: { p256dh: string; auth: string } },
    userAgent?: string,
  ) {
    const hash = endpointHash(input.endpoint);
    const existing = await this.prisma.pushSubscription.findUnique({
      where: { endpointHash: hash },
    });
    if (
      existing &&
      (existing.organizationId !== context.organizationId || existing.userId !== context.userId)
    )
      throw new AuthError(409, 'PUSH_SUBSCRIPTION_IN_USE', 'Push subscription is already in use');
    const result = await this.prisma.pushSubscription.upsert({
      where: { endpointHash: hash },
      create: {
        organizationId: context.organizationId,
        userId: context.userId,
        endpoint: input.endpoint,
        endpointHash: hash,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        ...(userAgent ? { userAgent } : {}),
      },
      update: {
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
        ...(userAgent ? { userAgent } : {}),
        revokedAt: null,
        lastUsedAt: new Date(),
      },
    });
    console.info(
      JSON.stringify({
        event: 'push.subscription_created',
        organizationId: context.organizationId,
        userId: context.userId,
        pushSubscriptionId: result.id,
      }),
    );
    return { id: result.id, createdAt: result.createdAt };
  }

  async unsubscribe(context: TenantContext, endpoint: string) {
    const result = await this.prisma.pushSubscription.updateMany({
      where: {
        endpointHash: endpointHash(endpoint),
        organizationId: context.organizationId,
        userId: context.userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    if (!result.count)
      throw new AuthError(404, 'PUSH_SUBSCRIPTION_NOT_FOUND', 'Push subscription not found');
    console.info(
      JSON.stringify({
        event: 'push.subscription_revoked',
        organizationId: context.organizationId,
        userId: context.userId,
      }),
    );
  }
}
