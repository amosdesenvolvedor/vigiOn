import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { authenticate, requirePermission } from '../auth/auth.middleware';
import { qrAnalyzeSchema, qrTelemetrySchema } from './qr-analysis.schemas';
import { QrAnalysisService } from './qr-analysis.service';

export const cameraOnboardingRouter = Router();
const service = new QrAnalysisService(prisma);
const limiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

cameraOnboardingRouter.use(authenticate, requirePermission('cameras:view'), limiter);
cameraOnboardingRouter.post('/qr/analyze', async (request, response, next) => {
  try {
    const { payload } = qrAnalyzeSchema.parse(request.body);
    const result = await service.analyze(payload);
    const event =
      result.catalogMatches.length > 1
        ? 'qr_scan_multiple_matches'
        : result.recognized
          ? 'qr_scan_success'
          : 'qr_scan_unknown';
    logger.info(event, {
      requestId: response.locals.requestId,
      userId: request.auth!.userId,
      organizationId: request.auth!.organizationId,
      qrType: result.type,
      payloadLength: Buffer.byteLength(payload, 'utf8'),
      matchCount: result.catalogMatches.length,
      confidence: result.confidence,
    });
    response.json({ analysis: result });
  } catch (error) {
    next(error);
  }
});

cameraOnboardingRouter.post('/qr/telemetry', (request, response, next) => {
  try {
    const telemetry = qrTelemetrySchema.parse(request.body);
    logger.info(telemetry.event, {
      requestId: response.locals.requestId,
      userId: request.auth!.userId,
      organizationId: request.auth!.organizationId,
      ...(telemetry.reason ? { reason: telemetry.reason } : {}),
    });
    response.status(204).send();
  } catch (error) {
    next(error);
  }
});
