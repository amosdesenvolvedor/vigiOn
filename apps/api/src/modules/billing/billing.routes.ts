import { Router, type Request } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requirePermission } from '../auth/auth.middleware';
import type { RequestMetadata } from '../auth/auth.types';
import { EntitlementService } from './entitlement.service';
import { SubscriptionService } from './subscription.service';

export const plansRouter = Router();
export const subscriptionRouter = Router();
const subscriptions = new SubscriptionService(prisma);
const entitlements = new EntitlementService(prisma);
const metadata = (request: Request): RequestMetadata => ({
  ...(request.ip ? { ipAddress: request.ip } : {}),
  ...(request.get('user-agent') ? { userAgent: request.get('user-agent')!.slice(0, 512) } : {}),
});
const jsonPlan = (plan: Awaited<ReturnType<SubscriptionService['listPlans']>>[number]) => ({
  ...plan,
  maxStorageBytes: plan.maxStorageBytes.toString(),
});

plansRouter.get('/', async (_request, response, next) => {
  try {
    response.json({ plans: (await subscriptions.listPlans()).map(jsonPlan) });
  } catch (error) {
    next(error);
  }
});

subscriptionRouter.use(authenticate);
subscriptionRouter.get('/', async (request, response, next) => {
  try {
    const result = await subscriptions.getCurrent(request.auth!.organizationId);
    response.json({ subscription: { ...result, plan: jsonPlan(result.plan) } });
  } catch (error) {
    next(error);
  }
});
subscriptionRouter.get('/usage', async (request, response, next) => {
  try {
    response.json({ usage: await entitlements.getUsage(request.auth!.organizationId) });
  } catch (error) {
    next(error);
  }
});
subscriptionRouter.get('/features', async (request, response, next) => {
  try {
    const result = await entitlements.getEntitlements(request.auth!.organizationId);
    response.json({ features: result.features });
  } catch (error) {
    next(error);
  }
});
subscriptionRouter.get('/history', async (request, response, next) => {
  try {
    response.json({ history: await subscriptions.history(request.auth!.organizationId) });
  } catch (error) {
    next(error);
  }
});
subscriptionRouter.post(
  '/cancel',
  requirePermission('plan:manage'),
  async (request, response, next) => {
    try {
      const result = await subscriptions.cancel(request.auth!, metadata(request));
      response.json({
        subscription: {
          id: result.id,
          status: result.status,
          currentPeriodEnd: result.currentPeriodEnd,
          cancelAtPeriodEnd: result.cancelAtPeriodEnd,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
subscriptionRouter.post(
  '/reactivate',
  requirePermission('plan:manage'),
  async (request, response, next) => {
    try {
      const result = await subscriptions.reactivate(request.auth!, metadata(request));
      response.json({
        subscription: {
          id: result.id,
          status: result.status,
          currentPeriodEnd: result.currentPeriodEnd,
          cancelAtPeriodEnd: result.cancelAtPeriodEnd,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
