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
    try {
      res.json(await service.summary(req.auth!));
    } catch (e) {
      next(e);
    }
  },
);
