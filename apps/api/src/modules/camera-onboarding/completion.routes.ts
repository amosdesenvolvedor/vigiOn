import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate, requirePermission } from '../auth/auth.middleware';
import type { RequestMetadata } from '../auth/auth.types';
import { CameraOnboardingCompletionService } from './completion.service';
import { completeOnboardingSchema } from './completion.schemas';

const service = new CameraOnboardingCompletionService(prisma);
const limiter = rateLimit({ windowMs: 60_000, max: 10, standardHeaders: true, legacyHeaders: false });
const metadata = (request: Request): RequestMetadata => ({
  ...(request.ip ? { ipAddress: request.ip } : {}),
  ...(request.get('user-agent') ? { userAgent: request.get('user-agent')!.slice(0, 512) } : {}),
});

export const completionRouter = Router();
completionRouter.use(authenticate, requirePermission('cameras:manage'), limiter);
completionRouter.post('/', async (request, response, next) => {
  try {
    const idempotencyKey = z.string().uuid().parse(request.get('idempotency-key'));
    const camera = await service.complete(request.auth!, completeOnboardingSchema.parse(request.body),
      idempotencyKey, metadata(request));
    response.status(201).json({ camera });
  } catch (error) { next(error); }
});
