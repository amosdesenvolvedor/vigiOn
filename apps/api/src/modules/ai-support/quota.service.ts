import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import { AuthError } from '../auth/auth.errors';

const utcDay = () => { const now = new Date(); return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())); };
export class AiQuotaService {
  constructor(private readonly prisma: PrismaClient) {}
  async consume(userId: string, organizationId: string) {
    const day = utcDay();
    const scopes = [
      { scope: 'GLOBAL', scopeKey: 'global', limit: env.AI_DAILY_REQUEST_LIMIT },
      { scope: 'ORGANIZATION', scopeKey: `org:${organizationId}`, organizationId, limit: env.AI_ORG_DAILY_REQUEST_LIMIT },
      { scope: 'USER', scopeKey: `user:${userId}`, userId, limit: env.AI_USER_DAILY_REQUEST_LIMIT },
    ];
    await this.prisma.$transaction(async (tx) => {
      for (const item of scopes) {
        await tx.aiUsageDay.upsert({ where: { day_scopeKey: { day, scopeKey: item.scopeKey } }, create: { day, scope: item.scope, scopeKey: item.scopeKey, ...(item.organizationId ? { organizationId: item.organizationId } : {}), ...(item.userId ? { userId: item.userId } : {}) }, update: {} });
        const claimed = await tx.aiUsageDay.updateMany({ where: { day, scopeKey: item.scopeKey, requests: { lt: item.limit } }, data: { requests: { increment: 1 } } });
        if (!claimed.count) throw new AuthError(429, 'AI_QUOTA_EXCEEDED', 'O suporte inteligente atingiu o limite temporário de uso. Tente novamente mais tarde.');
      }
    });
    return this.remaining(userId, organizationId);
  }
  async recordUsage(userId: string, organizationId: string, usage: { inputTokens: number; outputTokens: number; neurons: number }) {
    const day = utcDay();
    await this.prisma.aiUsageDay.updateMany({ where: { day, scopeKey: { in: ['global', `org:${organizationId}`, `user:${userId}`] } }, data: { inputTokens: { increment: usage.inputTokens }, outputTokens: { increment: usage.outputTokens }, neurons: { increment: usage.neurons } } });
  }
  async remaining(userId: string, organizationId: string) {
    const day = utcDay();
    const rows = await this.prisma.aiUsageDay.findMany({ where: { day, scopeKey: { in: ['global', `org:${organizationId}`, `user:${userId}`] } }, select: { scopeKey: true, requests: true } });
    const count = (key: string) => rows.find((row) => row.scopeKey === key)?.requests ?? 0;
    return Math.max(0, Math.min(env.AI_DAILY_REQUEST_LIMIT - count('global'), env.AI_ORG_DAILY_REQUEST_LIMIT - count(`org:${organizationId}`), env.AI_USER_DAILY_REQUEST_LIMIT - count(`user:${userId}`)));
  }
}
