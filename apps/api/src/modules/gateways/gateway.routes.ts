import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { prisma } from '../../lib/prisma';
import { AuthError } from '../auth/auth.errors';
import { authenticate, requirePermission } from '../auth/auth.middleware';
import type { RequestMetadata } from '../auth/auth.types';
import { authenticateGateway } from './gateway.middleware';
import {
  associationSchema,
  claimGatewaySchema,
  commandAckSchema,
  createPairingSchema,
  heartbeatSchema,
  updateGatewaySchema,
} from './gateway.schemas';
import { GatewayService } from './gateway.service';

const service = new GatewayService(prisma);
const metadata = (request: Request): RequestMetadata => ({
  ...(request.ip ? { ipAddress: request.ip } : {}),
  ...(request.get('user-agent') ? { userAgent: request.get('user-agent')!.slice(0, 512) } : {}),
});
const id = (request: Request, key = 'id') => {
  const value = request.params[key];
  if (typeof value !== 'string') throw new AuthError(404, 'GATEWAY_NOT_FOUND', 'Gateway not found');
  return value;
};
const limited = (max: number) =>
  rateLimit({
    windowMs: 60_000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_request, response) =>
      response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }),
  });

export const gatewayRouter = Router();
gatewayRouter.use(authenticate);
gatewayRouter.get('/', requirePermission('gateways:view'), async (request, response, next) => {
  try {
    response.json({ gateways: await service.list(request.auth!) });
  } catch (error) {
    next(error);
  }
});
gatewayRouter.post(
  '/pairing-codes',
  requirePermission('gateways:manage'),
  limited(10),
  async (request, response, next) => {
    try {
      createPairingSchema.parse(request.body);
      response.status(201).json(await service.generatePairing(request.auth!, metadata(request)));
    } catch (error) {
      next(error);
    }
  },
);
gatewayRouter.get('/:id', requirePermission('gateways:view'), async (request, response, next) => {
  try {
    response.json({ gateway: await service.get(request.auth!, id(request)) });
  } catch (error) {
    next(error);
  }
});
gatewayRouter.patch(
  '/:id',
  requirePermission('gateways:manage'),
  async (request, response, next) => {
    try {
      response.json({
        gateway: await service.update(
          request.auth!,
          id(request),
          updateGatewaySchema.parse(request.body),
          metadata(request),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);
gatewayRouter.delete(
  '/:id',
  requirePermission('gateways:manage'),
  async (request, response, next) => {
    try {
      await service.remove(request.auth!, id(request), metadata(request));
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);
gatewayRouter.post(
  '/:id/credentials/rotate',
  requirePermission('gateways:manage'),
  limited(5),
  async (request, response, next) => {
    try {
      response.json({
        credential: await service.rotateCredential(request.auth!, id(request), metadata(request)),
      });
    } catch (error) {
      next(error);
    }
  },
);
gatewayRouter.post(
  '/:id/cameras',
  requirePermission('gateways:manage'),
  async (request, response, next) => {
    try {
      const { cameraId } = associationSchema.parse(request.body);
      await service.associateCamera(request.auth!, id(request), cameraId, metadata(request));
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);
gatewayRouter.delete(
  '/:id/cameras/:cameraId',
  requirePermission('gateways:manage'),
  async (request, response, next) => {
    try {
      await service.dissociateCamera(
        request.auth!,
        id(request),
        id(request, 'cameraId'),
        metadata(request),
      );
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);
gatewayRouter.post(
  '/:id/cameras/:cameraId/test',
  requirePermission('gateways:manage'),
  limited(20),
  async (request, response, next) => {
    try {
      response.status(202).json({
        command: await service.queueCameraTest(request.auth!, id(request), id(request, 'cameraId')),
      });
    } catch (error) {
      next(error);
    }
  },
);

export const gatewayAgentRouter = Router();
gatewayAgentRouter.post('/claim', limited(5), async (request, response, next) => {
  try {
    response
      .status(201)
      .json(await service.claim(claimGatewaySchema.parse(request.body), metadata(request)));
  } catch (error) {
    next(error);
  }
});
gatewayAgentRouter.use(authenticateGateway);
gatewayAgentRouter.post('/heartbeat', limited(120), async (request, response, next) => {
  try {
    response.json(
      await service.heartbeat(request.gatewayAuth, heartbeatSchema.parse(request.body)),
    );
  } catch (error) {
    next(error);
  }
});
gatewayAgentRouter.get('/commands', limited(120), async (request, response, next) => {
  try {
    response.json({ commands: await service.pollCommands(request.gatewayAuth!) });
  } catch (error) {
    next(error);
  }
});
gatewayAgentRouter.get('/monitoring-config', limited(120), async (request, response, next) => {
  try {
    response.json(await service.monitoringConfiguration(request.gatewayAuth!));
  } catch (error) {
    next(error);
  }
});
gatewayAgentRouter.post('/commands/ack', limited(120), async (request, response, next) => {
  try {
    response.json(
      await service.acknowledge(request.gatewayAuth!, commandAckSchema.parse(request.body)),
    );
  } catch (error) {
    next(error);
  }
});
