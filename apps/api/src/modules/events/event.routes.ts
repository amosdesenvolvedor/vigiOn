import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate, requirePermission } from '../auth/auth.middleware';
import { authenticateGateway } from '../gateways/gateway.middleware';
import { EventService } from './event.service';
import { eventListSchema, gatewayEventSchema } from './event.schemas';

export const eventService = new EventService(prisma);
const ingestionLimiter = rateLimit({
  windowMs: 60_000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

export const gatewayEventRouter = Router();
gatewayEventRouter.use(authenticateGateway);
gatewayEventRouter.post('/', ingestionLimiter, async (request, response, next) => {
  try {
    response
      .status(202)
      .json(
        await eventService.ingest(request.gatewayAuth!, gatewayEventSchema.parse(request.body)),
      );
  } catch (error) {
    next(error);
  }
});

export const eventRouter = Router();
eventRouter.use(authenticate);
eventRouter.get('/', requirePermission('events:view'), async (request, response, next) => {
  try {
    response.json(await eventService.list(request.auth!, eventListSchema.parse(request.query)));
  } catch (error) {
    next(error);
  }
});
eventRouter.get('/:id', requirePermission('events:view'), async (request, response, next) => {
  try {
    response.json({
      event: await eventService.get(request.auth!, z.string().uuid().parse(request.params.id)),
    });
  } catch (error) {
    next(error);
  }
});
