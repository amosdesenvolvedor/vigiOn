import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../../lib/prisma';
import { AuthError } from '../auth/auth.errors';
import { authenticate, requirePermission } from '../auth/auth.middleware';
import type { RequestMetadata } from '../auth/auth.types';
import { authenticateGateway } from '../gateways/gateway.middleware';
import { CameraVerificationService } from './verification.service';
import {
  gatewayVerificationResultSchema,
  startVerificationSchema,
  verificationCredentialsSchema,
} from './verification.schemas';

const service = new CameraVerificationService(prisma);
const cleanupTimer = setInterval(() => void service.cleanup().catch(() => undefined), 5 * 60_000);
cleanupTimer.unref();
const userLimiter = rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false });
const credentialLimiter = rateLimit({ windowMs: 15 * 60_000, max: 5, standardHeaders: true,
  legacyHeaders: false, keyGenerator: (request) => `${request.auth?.organizationId}:${request.auth?.userId}:${request.params.id}` });
const gatewayLimiter = rateLimit({ windowMs: 60_000, max: 120, standardHeaders: true, legacyHeaders: false });
const metadata = (request: Request): RequestMetadata => ({
  ...(request.ip ? { ipAddress: request.ip } : {}),
  ...(request.get('user-agent') ? { userAgent: request.get('user-agent')!.slice(0, 512) } : {}),
});
const id = (request: Request) => {
  if (typeof request.params.id !== 'string')
    throw new AuthError(404, 'VERIFICATION_NOT_FOUND', 'Verification not found');
  return request.params.id;
};

export const verificationRouter = Router();
verificationRouter.use(authenticate, requirePermission('cameras:manage'), userLimiter);
verificationRouter.post('/', async (request, response, next) => {
  try {
    response.status(202).json({ verification: await service.start(request.auth!, startVerificationSchema.parse(request.body), metadata(request)) });
  } catch (error) { next(error); }
});
verificationRouter.get('/:id', async (request, response, next) => {
  try { response.json({ verification: await service.view(request.auth!, id(request)) }); }
  catch (error) { next(error); }
});
verificationRouter.post('/:id/credentials', credentialLimiter, async (request, response, next) => {
  try {
    response.status(202).json({ verification: await service.provideCredentials(request.auth!, id(request), verificationCredentialsSchema.parse(request.body), metadata(request)) });
  } catch (error) { next(error); }
});
verificationRouter.post('/:id/cancel', async (request, response, next) => {
  try { response.json({ verification: await service.cancel(request.auth!, id(request), metadata(request)) }); }
  catch (error) { next(error); }
});

export const gatewayVerificationRouter = Router();
gatewayVerificationRouter.use(authenticateGateway, gatewayLimiter);
gatewayVerificationRouter.post('/results', async (request, response, next) => {
  try { response.json(await service.ingest(request.gatewayAuth!, gatewayVerificationResultSchema.parse(request.body))); }
  catch (error) { next(error); }
});
