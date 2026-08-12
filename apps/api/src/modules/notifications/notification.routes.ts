import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { AuthError } from '../auth/auth.errors';
import { authenticate, requirePermission } from '../auth/auth.middleware';
import { AlertService, NotificationService } from './notification.service';
import { PushSubscriptionService } from './push-subscription.service';

export const notificationService = new NotificationService(prisma);
export const alertService = new AlertService(prisma);
const pushSubscriptions = new PushSubscriptionService(prisma);
const limited = rateLimit({
  windowMs: 60000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
const alertQuerySchema = pageSchema.extend({
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
  severity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
});
const preferenceSchema = z
  .object({
    eventType: z.enum([
      'MOTION',
      'CAMERA_OFFLINE',
      'CAMERA_ONLINE',
      'GATEWAY_OFFLINE',
      'GATEWAY_ONLINE',
    ]),
    channel: z.enum(['IN_APP', 'EMAIL', 'PUSH']),
    enabled: z.boolean(),
    minimumSeverity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']),
  })
  .strict();
const id = (request: Request) => {
  const value = z.string().uuid().safeParse(request.params.id);
  if (!value.success) throw new AuthError(404, 'RESOURCE_NOT_FOUND', 'Resource not found');
  return value.data;
};
const metadata = (request: Request) => ({
  ...(request.ip ? { ipAddress: request.ip } : {}),
  ...(request.get('user-agent') ? { userAgent: request.get('user-agent')!.slice(0, 512) } : {}),
});
const pushSubscriptionSchema = z
  .object({
    endpoint: z
      .string()
      .url()
      .max(2048)
      .refine((value) => value.startsWith('https://')),
    keys: z
      .object({
        p256dh: z.string().min(40).max(255),
        auth: z.string().min(16).max(255),
      })
      .strict(),
  })
  .strict();

export const notificationRouter = Router();
notificationRouter.use(authenticate);
notificationRouter.get('/', requirePermission('notifications:view'), async (req, res, next) => {
  try {
    const q = pageSchema.parse(req.query);
    res.json(await notificationService.list(req.auth!, q.page, q.limit));
  } catch (e) {
    next(e);
  }
});
notificationRouter.get(
  '/unread-count',
  requirePermission('notifications:view'),
  async (req, res, next) => {
    try {
      res.json({ unreadCount: await notificationService.unreadCount(req.auth!) });
    } catch (e) {
      next(e);
    }
  },
);
notificationRouter.post(
  '/read-all',
  requirePermission('notifications:view'),
  limited,
  async (req, res, next) => {
    try {
      const result = await notificationService.markAllRead(req.auth!);
      res.json({ updated: result.count });
    } catch (e) {
      next(e);
    }
  },
);
notificationRouter.post(
  '/:id/read',
  requirePermission('notifications:view'),
  limited,
  async (req, res, next) => {
    try {
      await notificationService.markRead(req.auth!, id(req));
      res.status(204).send();
    } catch (e) {
      next(e);
    }
  },
);

export const preferenceRouter = Router();
preferenceRouter.use(authenticate);
preferenceRouter.get('/', requirePermission('notifications:view'), async (req, res, next) => {
  try {
    res.json({ items: await notificationService.preferences(req.auth!) });
  } catch (e) {
    next(e);
  }
});
preferenceRouter.put(
  '/',
  requirePermission('notifications:view'),
  limited,
  async (req, res, next) => {
    try {
      res.json({
        preference: await notificationService.updatePreference(
          req.auth!,
          preferenceSchema.parse(req.body),
          metadata(req),
        ),
      });
    } catch (e) {
      next(e);
    }
  },
);

export const pushRouter = Router();
pushRouter.use(authenticate, requirePermission('notifications:view'));
pushRouter.get('/configuration', (_req, res) => res.json(pushSubscriptions.configuration()));
pushRouter.post('/subscriptions', limited, async (req, res, next) => {
  try {
    res.status(201).json({
      subscription: await pushSubscriptions.subscribe(
        req.auth!,
        pushSubscriptionSchema.parse(req.body),
        req.get('user-agent')?.slice(0, 512),
      ),
    });
  } catch (error) {
    next(error);
  }
});
pushRouter.delete('/subscriptions', limited, async (req, res, next) => {
  try {
    const { endpoint } = z.object({ endpoint: z.string().url().max(2048) }).parse(req.body);
    await pushSubscriptions.unsubscribe(req.auth!, endpoint);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

export const alertRouter = Router();
alertRouter.use(authenticate);
alertRouter.get('/', requirePermission('events:view'), async (req, res, next) => {
  try {
    res.json(await alertService.list(req.auth!, alertQuerySchema.parse(req.query)));
  } catch (e) {
    next(e);
  }
});
alertRouter.post(
  '/:id/acknowledge',
  requirePermission('events:manage'),
  limited,
  async (req, res, next) => {
    try {
      await alertService.acknowledge(req.auth!, id(req), metadata(req));
      res.status(204).send();
    } catch (e) {
      next(e);
    }
  },
);
