import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate, requirePermission } from '../auth/auth.middleware';
import { IntelligenceService } from './intelligence.service';
import { exceptionSchema, scheduleSchema, zoneSchema } from './intelligence.schemas';
export const intelligenceService = new IntelligenceService(prisma);
const limited = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
const meta = (r: Request) => ({
  ...(r.ip ? { ipAddress: r.ip } : {}),
  ...(r.get('user-agent') ? { userAgent: r.get('user-agent')!.slice(0, 512) } : {}),
});
export const intelligenceRouter = Router();
intelligenceRouter.use(authenticate);
intelligenceRouter.get('/schedules', requirePermission('events:view'), async (r, s, n) => {
  try {
    s.json({ items: await intelligenceService.listSchedules(r.auth!) });
  } catch (e) {
    n(e);
  }
});
intelligenceRouter.put(
  '/schedules',
  requirePermission('settings:manage'),
  limited,
  async (r, s, n) => {
    try {
      s.json({
        schedule: await intelligenceService.saveSchedule(
          r.auth!,
          scheduleSchema.parse(r.body),
          meta(r),
        ),
      });
    } catch (e) {
      n(e);
    }
  },
);
intelligenceRouter.put(
  '/schedules/:id/exception',
  requirePermission('settings:manage'),
  limited,
  async (r, s, n) => {
    try {
      s.json({
        exception: await intelligenceService.addException(
          r.auth!,
          z.string().uuid().parse(r.params.id),
          exceptionSchema.parse(r.body),
          meta(r),
        ),
      });
    } catch (e) {
      n(e);
    }
  },
);
intelligenceRouter.get('/zones', requirePermission('events:view'), async (r, s, n) => {
  try {
    s.json({ items: await intelligenceService.listZones(r.auth!) });
  } catch (e) {
    n(e);
  }
});
intelligenceRouter.post(
  '/zones',
  requirePermission('settings:manage'),
  limited,
  async (r, s, n) => {
    try {
      s.status(201).json({
        zone: await intelligenceService.saveZone(r.auth!, zoneSchema.parse(r.body), meta(r)),
      });
    } catch (e) {
      n(e);
    }
  },
);
intelligenceRouter.put(
  '/zones/:id',
  requirePermission('settings:manage'),
  limited,
  async (r, s, n) => {
    try {
      s.json({
        zone: await intelligenceService.saveZone(
          r.auth!,
          zoneSchema.parse(r.body),
          meta(r),
          z.string().uuid().parse(r.params.id),
        ),
      });
    } catch (e) {
      n(e);
    }
  },
);
intelligenceRouter.delete(
  '/zones/:id',
  requirePermission('settings:manage'),
  limited,
  async (r, s, n) => {
    try {
      await intelligenceService.deleteZone(r.auth!, z.string().uuid().parse(r.params.id), meta(r));
      s.status(204).send();
    } catch (e) {
      n(e);
    }
  },
);
