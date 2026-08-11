import express, { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate, requirePermission } from '../auth/auth.middleware';
import { AuthError } from '../auth/auth.errors';
import { authenticateGateway } from '../gateways/gateway.middleware';
import { MediaAssetService } from './media-asset.service';
import { S3ObjectStorageService } from './object-storage.service';
import { env } from '../../config/env';

export const mediaService = new MediaAssetService(prisma, new S3ObjectStorageService());
const uuid = z.string().uuid();
const limiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
});
const id = (request: Request, key = 'id') => uuid.parse(request.params[key]);
const metadata = (request: Request) => ({
  ...(request.ip ? { ipAddress: request.ip } : {}),
  ...(request.get('user-agent') ? { userAgent: request.get('user-agent')!.slice(0, 512) } : {}),
});
const idem = (request: Request) => {
  const value = request.get('idempotency-key');
  if (!value) throw new AuthError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key is required');
  return uuid.parse(value);
};

export const mediaUploadRouter = Router();
mediaUploadRouter.use(authenticateGateway);
mediaUploadRouter.put(
  '/:id/content',
  limiter,
  express.raw({ type: 'application/octet-stream', limit: env.RECORDING_MAX_BYTES }),
  async (request, response, next) => {
    try {
      if (!Buffer.isBuffer(request.body))
        throw new AuthError(415, 'INVALID_MEDIA_FILE', 'Binary media is required');
      const checksum = request.get('x-content-sha256');
      if (!checksum || !/^[0-9a-f]{64}$/.test(checksum))
        throw new AuthError(400, 'CHECKSUM_REQUIRED', 'SHA-256 checksum is required');
      response.json({
        asset: await mediaService.receiveUpload(
          request.gatewayAuth!,
          id(request),
          request.body,
          checksum,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
mediaUploadRouter.post('/:id/failure', limiter, async (request, response, next) => {
  try {
    const { errorCode } = z
      .object({ errorCode: z.enum(['UPLOAD_RETRY_EXHAUSTED']) })
      .strict()
      .parse(request.body);
    response.json({
      asset: await mediaService.failUpload(request.gatewayAuth!, id(request), errorCode),
    });
  } catch (error) {
    next(error);
  }
});

export const mediaRouter = Router();
mediaRouter.get('/media-assets/:id/content', async (request, response, next) => {
  try {
    const expires = z.coerce.number().int().parse(request.query.expires);
    const token = z.string().min(20).parse(request.query.token);
    const result = await mediaService.content(id(request), expires, token);
    response.setHeader('content-type', result.asset.mimeType);
    response.setHeader('content-length', result.asset.sizeBytes.toString());
    response.setHeader('cache-control', 'private, no-store');
    result.stream.on('error', next).pipe(response);
  } catch (error) {
    next(error);
  }
});
mediaRouter.use(authenticate);
mediaRouter.post(
  '/cameras/:cameraId/snapshots',
  requirePermission('storage:manage'),
  limiter,
  async (request, response, next) => {
    try {
      response.status(202).json({
        asset: await mediaService.request(
          request.auth!,
          id(request, 'cameraId'),
          'SNAPSHOT',
          idem(request),
          metadata(request),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
mediaRouter.post(
  '/cameras/:cameraId/recordings',
  requirePermission('storage:manage'),
  limiter,
  async (request, response, next) => {
    try {
      response.status(202).json({
        asset: await mediaService.request(
          request.auth!,
          id(request, 'cameraId'),
          'RECORDING',
          idem(request),
          metadata(request),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
mediaRouter.post(
  '/recordings/:id/stop',
  requirePermission('storage:manage'),
  limiter,
  async (request, response, next) => {
    try {
      response.json({
        asset: await mediaService.stopRecording(request.auth!, id(request), metadata(request)),
      });
    } catch (error) {
      next(error);
    }
  },
);
mediaRouter.get(
  '/media-assets',
  requirePermission('storage:view'),
  async (request, response, next) => {
    try {
      response.json({
        items: await mediaService.list(
          request.auth!,
          typeof request.query.cameraId === 'string'
            ? uuid.parse(request.query.cameraId)
            : undefined,
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
mediaRouter.get(
  '/media-assets/:id',
  requirePermission('storage:view'),
  async (request, response, next) => {
    try {
      response.json({ asset: await mediaService.get(request.auth!, id(request)) });
    } catch (error) {
      next(error);
    }
  },
);
mediaRouter.post(
  '/media-assets/:id/access',
  requirePermission('storage:view'),
  limiter,
  async (request, response, next) => {
    try {
      response.json(await mediaService.access(request.auth!, id(request)));
    } catch (error) {
      next(error);
    }
  },
);
mediaRouter.delete(
  '/media-assets/:id',
  requirePermission('storage:manage'),
  async (request, response, next) => {
    try {
      response.json({
        asset: await mediaService.remove(request.auth!, id(request), 'manual', metadata(request)),
      });
    } catch (error) {
      next(error);
    }
  },
);
