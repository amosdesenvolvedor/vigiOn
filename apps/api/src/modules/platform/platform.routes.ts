import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../auth/auth.middleware';
import { realtimeService } from '../realtime/realtime.service';
import { S3ObjectStorageService } from '../media/object-storage.service';
import { requirePlatformAdmin } from './platform.middleware';
import { PlatformService } from './platform.service';

const service = new PlatformService(prisma);
const objectStorage = new S3ObjectStorageService();
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const organizationsSchema = pageSchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED', 'CANCELED']).optional(),
});
const reads = rateLimit({
  windowMs: 60_000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
});

export const platformRouter = Router();
platformRouter.use(authenticate, requirePlatformAdmin, reads);
platformRouter.use((req, _res, next) => {
  console.info(
    JSON.stringify({ event: 'platform.admin.access', userId: req.auth!.userId, path: req.path }),
  );
  next();
});
platformRouter.get('/summary', async (_req, res, next) => {
  try {
    res.json(await service.summary());
  } catch (error) {
    next(error);
  }
});
platformRouter.get('/organizations', async (req, res, next) => {
  try {
    res.json(await service.organizations(organizationsSchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
});
platformRouter.get('/organizations/:id', async (req, res, next) => {
  try {
    res.json({ organization: await service.organization(z.string().uuid().parse(req.params.id)) });
  } catch (error) {
    next(error);
  }
});
platformRouter.get('/users', async (req, res, next) => {
  try {
    res.json(await service.users(pageSchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
});
platformRouter.get('/plans', async (req, res, next) => {
  try {
    res.json(await service.plans(pageSchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
});
platformRouter.get('/subscriptions', async (req, res, next) => {
  try {
    res.json(await service.subscriptions(pageSchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
});
platformRouter.get('/cameras', async (req, res, next) => {
  try {
    res.json(await service.cameras(pageSchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
});
platformRouter.get('/gateways', async (req, res, next) => {
  try {
    res.json(await service.gateways(pageSchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
});
platformRouter.get('/storage', async (req, res, next) => {
  try {
    res.json(await service.storage(pageSchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
});
platformRouter.get('/events', async (req, res, next) => {
  try {
    res.json(await service.events(pageSchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
});
platformRouter.get('/alerts', async (req, res, next) => {
  try {
    res.json(await service.alerts(pageSchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
});
platformRouter.get('/audit', async (req, res, next) => {
  try {
    res.json(await service.audit(pageSchema.parse(req.query)));
  } catch (error) {
    next(error);
  }
});
platformRouter.get('/notifications', async (_req, res, next) => {
  try {
    res.json(await service.notifications());
  } catch (error) {
    next(error);
  }
});
platformRouter.get('/health', async (_req, res) => {
  const startedAt = Date.now();
  let database: 'healthy' | 'unavailable' = 'healthy';
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = 'unavailable';
  }
  let storage: 'healthy' | 'unavailable' = 'unavailable';
  try {
    storage = (await objectStorage.health()) ? 'healthy' : 'unavailable';
  } catch {
    storage = 'unavailable';
  }
  res.status(database === 'healthy' ? 200 : 503).json({
    status: database === 'healthy' && storage === 'healthy' ? 'healthy' : 'degraded',
    api: 'healthy',
    database,
    objectStorage: storage,
    realtime: realtimeService.stats(),
    workers: {
      retention: 'scheduled',
      notifications: 'scheduled',
      gatewayReconciliation: 'scheduled',
    },
    durationMs: Date.now() - startedAt,
  });
});
