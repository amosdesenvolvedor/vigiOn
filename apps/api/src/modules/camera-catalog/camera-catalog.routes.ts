import { Router } from 'express';
import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../auth/auth.middleware';
import { requirePlatformAdmin } from '../platform/platform.middleware';
import { CameraCatalogService } from './camera-catalog.service';
import {
  catalogListSchema,
  compatibilitySchema,
  createBrandSchema,
  createFamilySchema,
  createManufacturerSchema,
  createModelSchema,
  manufacturerListSchema,
} from './camera-catalog.schemas';

export const cameraCatalogRouter = Router();
const service = new CameraCatalogService(prisma);
const uuid = z.string().uuid();
const reads = rateLimit({
  windowMs: 60_000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
});
const audit = (request: Request, action: string, entityType: string, entityId: string) =>
  prisma.platformAuditLog.create({
    data: {
      actorUserId: request.auth!.userId,
      action,
      entityType,
      entityId,
      ...(request.ip ? { ipAddress: request.ip } : {}),
      ...(request.get('user-agent') ? { userAgent: request.get('user-agent')!.slice(0, 512) } : {}),
    },
  });

cameraCatalogRouter.use(authenticate);
cameraCatalogRouter.use(reads);
cameraCatalogRouter.get('/manufacturers', async (request, response, next) => {
  try {
    response.json(await service.manufacturers(manufacturerListSchema.parse(request.query)));
  } catch (error) {
    next(error);
  }
});
cameraCatalogRouter.get('/models', async (request, response, next) => {
  try {
    response.json(await service.models(catalogListSchema.parse(request.query)));
  } catch (error) {
    next(error);
  }
});
cameraCatalogRouter.get('/search', async (request, response, next) => {
  try {
    response.json(await service.models(catalogListSchema.parse(request.query)));
  } catch (error) {
    next(error);
  }
});
cameraCatalogRouter.get('/models/:id', async (request, response, next) => {
  try {
    response.json({ model: await service.model(uuid.parse(request.params.id)) });
  } catch (error) {
    next(error);
  }
});
cameraCatalogRouter.get('/models/:id/compatibility', async (request, response, next) => {
  try {
    response.json(await service.compatibility(uuid.parse(request.params.id)));
  } catch (error) {
    next(error);
  }
});

cameraCatalogRouter.use('/admin', requirePlatformAdmin);
cameraCatalogRouter.post('/admin/manufacturers', async (request, response, next) => {
  try {
    const manufacturer = await service.createManufacturer(
      createManufacturerSchema.parse(request.body),
    );
    await audit(
      request,
      'CAMERA_CATALOG_MANUFACTURER_CREATED',
      'CameraCatalogManufacturer',
      manufacturer.id,
    );
    response.status(201).json({ manufacturer });
  } catch (error) {
    next(error);
  }
});
cameraCatalogRouter.post('/admin/brands', async (request, response, next) => {
  try {
    const brand = await service.createBrand(createBrandSchema.parse(request.body));
    await audit(request, 'CAMERA_CATALOG_BRAND_CREATED', 'CameraCatalogBrand', brand.id);
    response.status(201).json({ brand });
  } catch (error) {
    next(error);
  }
});
cameraCatalogRouter.post('/admin/families', async (request, response, next) => {
  try {
    const family = await service.createFamily(createFamilySchema.parse(request.body));
    await audit(request, 'CAMERA_CATALOG_FAMILY_CREATED', 'CameraCatalogFamily', family.id);
    response.status(201).json({ family });
  } catch (error) {
    next(error);
  }
});
cameraCatalogRouter.post('/admin/models', async (request, response, next) => {
  try {
    const model = await service.createModel(createModelSchema.parse(request.body));
    await audit(request, 'CAMERA_CATALOG_MODEL_CREATED', 'CameraCatalogModel', model.id);
    response.status(201).json({ model });
  } catch (error) {
    next(error);
  }
});
cameraCatalogRouter.patch('/admin/variants/:id/compatibility', async (request, response, next) => {
  try {
    const variantId = uuid.parse(request.params.id);
    const compatibility = await service.updateCompatibility(
      variantId,
      compatibilitySchema.parse(request.body),
    );
    await audit(request, 'CAMERA_CATALOG_COMPATIBILITY_UPDATED', 'CameraCatalogVariant', variantId);
    response.json({ compatibility });
  } catch (error) {
    next(error);
  }
});
