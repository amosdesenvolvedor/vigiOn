import express, { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../../lib/prisma';
import { AuthError } from '../auth/auth.errors';
import { authenticate, requirePermission } from '../auth/auth.middleware';
import type { RequestMetadata } from '../auth/auth.types';
import { authenticateGateway } from '../gateways/gateway.middleware';
import { streamIdempotencySchema, streamMediaNameSchema } from './stream.schemas';
import { StreamSessionService } from './stream-session.service';

const service = new StreamSessionService(prisma);
const limited = rateLimit({
  windowMs: 60_000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_request, response) =>
    response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
});
const value = (request: Request, key: string) => {
  const result = request.params[key];
  if (typeof result !== 'string')
    throw new AuthError(404, 'STREAM_NOT_AUTHORIZED', 'Stream session not found');
  return result;
};
const metadata = (request: Request): RequestMetadata => ({
  ...(request.ip ? { ipAddress: request.ip } : {}),
  ...(request.get('user-agent') ? { userAgent: request.get('user-agent')!.slice(0, 512) } : {}),
});

export const streamRouter = Router();
streamRouter.post(
  '/cameras/:cameraId/stream-sessions',
  authenticate,
  requirePermission('cameras:view'),
  limited,
  async (request, response, next) => {
    try {
      const idempotencyKey = streamIdempotencySchema.parse(request.get('idempotency-key'));
      response
        .status(202)
        .json(
          await service.create(
            request.auth!,
            value(request, 'cameraId'),
            idempotencyKey,
            metadata(request),
          ),
        );
    } catch (error) {
      next(error);
    }
  },
);
streamRouter.get(
  '/stream-sessions/:id',
  authenticate,
  requirePermission('cameras:view'),
  async (request, response, next) => {
    try {
      response.json({ session: await service.get(request.auth!, value(request, 'id')) });
    } catch (error) {
      next(error);
    }
  },
);
streamRouter.delete(
  '/stream-sessions/:id',
  authenticate,
  requirePermission('cameras:view'),
  limited,
  async (request, response, next) => {
    try {
      response.json({
        session: await service.stop(request.auth!, value(request, 'id'), metadata(request)),
      });
    } catch (error) {
      next(error);
    }
  },
);
streamRouter.get('/stream-sessions/:id/media/:name', async (request, response, next) => {
  try {
    const sessionId = value(request, 'id');
    const [scheme, credential] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Stream' || !credential)
      throw new AuthError(401, 'STREAM_NOT_AUTHORIZED', 'Stream credential required');
    await service.authorizeViewer(sessionId, credential);
    const name = streamMediaNameSchema.parse(value(request, 'name'));
    const data = await service.media.get(sessionId, name);
    response.set({
      'cache-control': 'no-store, private',
      'referrer-policy': 'no-referrer',
      'content-type': name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
    });
    response.send(data);
  } catch (error) {
    next(error);
  }
});

export const streamMediaRouter = Router();
streamMediaRouter.use(authenticateGateway);
streamMediaRouter.put(
  '/:id/:name',
  rateLimit({ windowMs: 60_000, max: 600, standardHeaders: true, legacyHeaders: false }),
  express.raw({
    type: ['application/octet-stream', 'video/mp2t', 'application/vnd.apple.mpegurl'],
    limit: '4mb',
  }),
  async (request, response, next) => {
    try {
      const sessionId = value(request, 'id');
      await service.authorizeGatewayMedia(request.gatewayAuth!, sessionId);
      const name = streamMediaNameSchema.parse(value(request, 'name'));
      if (!Buffer.isBuffer(request.body))
        throw new AuthError(400, 'INVALID_MEDIA', 'Media body is required');
      await service.media.put(sessionId, name, request.body);
      if (name === 'index.m3u8') {
        const activated = await prisma.streamSession.updateMany({
          where: { id: sessionId, status: 'STARTING' },
          data: { status: 'ACTIVE', startedAt: new Date() },
        });
        if (activated.count)
          console.info(JSON.stringify({ event: 'stream.started', streamSessionId: sessionId }));
      }
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);
