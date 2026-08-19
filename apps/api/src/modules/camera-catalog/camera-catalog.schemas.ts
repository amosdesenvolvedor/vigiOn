import { z } from 'zod';

const page = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const catalogListSchema = page.extend({
  search: z.string().trim().min(1).max(160).optional(),
  manufacturerId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  familyId: z.string().uuid().optional(),
  compatibility: z
    .enum(['SUPPORTED', 'PARTIAL', 'EXPERIMENTAL', 'PROPRIETARY_ONLY', 'UNSUPPORTED', 'UNKNOWN'])
    .optional(),
  confidence: z
    .enum(['OFFICIAL_CONFIRMED', 'COMMUNITY_CONFIRMED', 'LAB_VERIFIED', 'INFERRED', 'UNVERIFIED'])
    .optional(),
  protocol: z
    .enum([
      'ONVIF',
      'RTSP',
      'HTTP',
      'HTTPS',
      'WEBSOCKET',
      'MANUFACTURER_PROPRIETARY',
      'PROPRIETARY_P2P',
      'CLOUD_ONLY',
    ])
    .optional(),
  sortBy: z.enum(['name', 'createdAt', 'updatedAt']).default('name'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

export const manufacturerListSchema = page.extend({
  search: z.string().trim().min(1).max(120).optional(),
});

export const createManufacturerSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .strict();

export const createBrandSchema = z
  .object({
    manufacturerId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
  })
  .strict();

export const createFamilySchema = z
  .object({
    brandId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
  })
  .strict();

export const createModelSchema = z
  .object({
    brandId: z.string().uuid(),
    familyId: z.string().uuid().nullable().optional(),
    name: z.string().trim().min(1).max(160),
    aliases: z.array(z.string().trim().min(1).max(160)).max(30).default([]),
    cameraType: z
      .enum([
        'INDOOR_FIXED',
        'INDOOR_PTZ',
        'OUTDOOR_FIXED',
        'OUTDOOR_PTZ',
        'BULLET',
        'DOME',
        'TURRET',
        'FLOODLIGHT',
        'DOORBELL',
        'BATTERY',
        'SOLAR',
        'DUAL_LENS',
        'PANORAMIC',
        'OTHER',
        'UNKNOWN',
      ])
      .default('UNKNOWN'),
    resolution: z.string().trim().max(80).nullable().optional(),
    hardwareVersion: z.string().trim().max(80).nullable().optional(),
    region: z.string().trim().max(40).nullable().optional(),
    sku: z.string().trim().max(100).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
  })
  .strict();

export const compatibilitySchema = z
  .object({
    level: z.enum([
      'SUPPORTED',
      'PARTIAL',
      'EXPERIMENTAL',
      'PROPRIETARY_ONLY',
      'UNSUPPORTED',
      'UNKNOWN',
    ]),
    confidence: z.enum([
      'OFFICIAL_CONFIRMED',
      'COMMUNITY_CONFIRMED',
      'LAB_VERIFIED',
      'INFERRED',
      'UNVERIFIED',
    ]),
    reason: z.string().trim().min(3).max(4000),
    strategy: z.string().trim().max(255).nullable().optional(),
  })
  .strict();
