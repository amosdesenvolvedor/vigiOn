import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../../lib/prisma';
import { authenticateGateway } from '../gateways/gateway.middleware';
import { CameraHealthService } from './camera-health.service';
import { cameraHealthBatchSchema } from './camera-health.schemas';

const service = new CameraHealthService(prisma);
export const gatewayCameraHealthRouter = Router();
gatewayCameraHealthRouter.use(
  authenticateGateway,
  rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false }),
);
gatewayCameraHealthRouter.get('/sync', async (request, response, next) => {
  try {
    response.json(await service.sync(request.gatewayAuth!));
  } catch (error) {
    next(error);
  }
});
gatewayCameraHealthRouter.post('/status', async (request, response, next) => {
  try {
    response.json(
      await service.ingest(request.gatewayAuth!, cameraHealthBatchSchema.parse(request.body)),
    );
  } catch (error) {
    next(error);
  }
});

export const cameraHealthService = service;
