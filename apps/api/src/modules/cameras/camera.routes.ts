import { Router, type Request } from 'express';
import { prisma } from '../../lib/prisma';
import { AuthError } from '../auth/auth.errors';
import { authenticate, requirePermission } from '../auth/auth.middleware';
import type { RequestMetadata } from '../auth/auth.types';
import {
  cameraCredentialsSchema,
  cameraListSchema,
  cameraStatusSchema,
  createCameraSchema,
  updateCameraSchema,
} from './camera.schemas';
import { CameraService } from './camera.service';

export const cameraRouter = Router();
const service = new CameraService(prisma);
const metadata = (request: Request): RequestMetadata => ({
  ...(request.ip ? { ipAddress: request.ip } : {}),
  ...(request.get('user-agent') ? { userAgent: request.get('user-agent')!.slice(0, 512) } : {}),
});
const cameraId = (request: Request) => {
  const id = request.params.id;
  if (typeof id !== 'string') throw new AuthError(404, 'CAMERA_NOT_FOUND', 'Camera not found');
  return id;
};

cameraRouter.use(authenticate);

cameraRouter.get('/', requirePermission('cameras:view'), async (request, response, next) => {
  try {
    response.json(await service.list(request.auth!, cameraListSchema.parse(request.query)));
  } catch (error) {
    next(error);
  }
});

cameraRouter.post('/', requirePermission('cameras:manage'), async (request, response, next) => {
  try {
    const camera = await service.create(
      request.auth!,
      createCameraSchema.parse(request.body),
      metadata(request),
    );
    response.status(201).json({ camera });
  } catch (error) {
    next(error);
  }
});

cameraRouter.get('/:id', requirePermission('cameras:view'), async (request, response, next) => {
  try {
    response.json({ camera: await service.get(request.auth!, cameraId(request)) });
  } catch (error) {
    next(error);
  }
});

cameraRouter.patch('/:id', requirePermission('cameras:manage'), async (request, response, next) => {
  try {
    const camera = await service.update(
      request.auth!,
      cameraId(request),
      updateCameraSchema.parse(request.body),
      metadata(request),
    );
    response.json({ camera });
  } catch (error) {
    next(error);
  }
});

cameraRouter.patch(
  '/:id/status',
  requirePermission('cameras:manage'),
  async (request, response, next) => {
    try {
      const { status } = cameraStatusSchema.parse(request.body);
      response.json({
        camera: await service.setAdministrativeStatus(
          request.auth!,
          cameraId(request),
          status,
          metadata(request),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

cameraRouter.patch(
  '/:id/credentials',
  requirePermission('cameras:manage'),
  async (request, response, next) => {
    try {
      await service.updateCredentials(
        request.auth!,
        cameraId(request),
        cameraCredentialsSchema.parse(request.body),
        metadata(request),
      );
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

cameraRouter.delete(
  '/:id',
  requirePermission('cameras:manage'),
  async (request, response, next) => {
    try {
      await service.remove(request.auth!, cameraId(request), metadata(request));
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);
