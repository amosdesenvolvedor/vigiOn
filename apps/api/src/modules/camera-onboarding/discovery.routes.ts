import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../../lib/prisma';
import { AuthError } from '../auth/auth.errors';
import { authenticate, requirePermission } from '../auth/auth.middleware';
import type { RequestMetadata } from '../auth/auth.types';
import { authenticateGateway } from '../gateways/gateway.middleware';
import { CameraDiscoveryService } from './discovery.service';
import {
  confirmDiscoverySchema,
  gatewayDiscoveryResultSchema,
  startDiscoverySchema,
} from './discovery.schemas';

const service = new CameraDiscoveryService(prisma);
const cleanupTimer = setInterval(() => void service.cleanup().catch(() => undefined), 15 * 60_000);
cleanupTimer.unref();
const limiter = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});
const gatewayLimiter = rateLimit({
  windowMs: 60_000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});
const metadata = (request: Request): RequestMetadata => ({
  ...(request.ip ? { ipAddress: request.ip } : {}),
  ...(request.get('user-agent') ? { userAgent: request.get('user-agent')!.slice(0, 512) } : {}),
});
const sessionId = (request: Request) => {
  const value = request.params.id;
  if (typeof value !== 'string')
    throw new AuthError(404, 'DISCOVERY_NOT_FOUND', 'Discovery session not found');
  return value;
};

export const discoveryRouter = Router();
discoveryRouter.use(authenticate, requirePermission('cameras:manage'), limiter);
discoveryRouter.post('/', async (request, response, next) => {
  try {
    response.status(202).json({
      discovery: await service.start(
        request.auth!,
        startDiscoverySchema.parse(request.body),
        metadata(request),
      ),
    });
  } catch (error) {
    next(error);
  }
});
discoveryRouter.get('/:id', async (request, response, next) => {
  try {
    response.json({ discovery: await service.view(request.auth!, sessionId(request)) });
  } catch (error) {
    next(error);
  }
});
discoveryRouter.post('/:id/cancel', async (request, response, next) => {
  try {
    response.json({
      discovery: await service.cancel(request.auth!, sessionId(request), metadata(request)),
    });
  } catch (error) {
    next(error);
  }
});
discoveryRouter.post('/:id/confirm', async (request, response, next) => {
  try {
    const { candidateId } = confirmDiscoverySchema.parse(request.body);
    response.json({
      discovery: await service.confirm(
        request.auth!,
        sessionId(request),
        candidateId,
        metadata(request),
      ),
    });
  } catch (error) {
    next(error);
  }
});

export const gatewayDiscoveryRouter = Router();
gatewayDiscoveryRouter.use(authenticateGateway, gatewayLimiter);
gatewayDiscoveryRouter.post('/results', async (request, response, next) => {
  try {
    response.json(
      await service.ingest(request.gatewayAuth!, gatewayDiscoveryResultSchema.parse(request.body)),
    );
  } catch (error) {
    next(error);
  }
});
