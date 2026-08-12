import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { authenticate, requirePermission } from '../auth/auth.middleware';
import { DashboardService } from './dashboard.service';
const service = new DashboardService(prisma);
export const dashboardRouter = Router();
dashboardRouter.get(
  '/summary',
  authenticate,
  requirePermission('events:view'),
  async (req, res, next) => {
    const startedAt = Date.now();
    try {
      res.json(await service.summary(req.auth!));
      console.info(
        JSON.stringify({
          event: 'dashboard.summary_requested',
          organizationId: req.auth!.organizationId,
          userId: req.auth!.userId,
          durationMs: Date.now() - startedAt,
        }),
      );
    } catch (e) {
      next(e);
    }
  },
);
