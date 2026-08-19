import { z } from 'zod';

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => value || null)
    .nullable()
    .optional();

const cameraFields = {
  name: z.string().trim().min(2).max(160),
  description: optionalText(4000),
  location: optionalText(255),
  manufacturer: optionalText(100),
  model: optionalText(100),
  identifier: optionalText(191),
  connectionType: z.enum(['WIFI', 'ETHERNET', 'OTHER']),
  protocol: z.enum(['RTSP', 'ONVIF', 'HTTP', 'HTTPS', 'OTHER']),
};

export const rtspSourceSchema = z
  .object({
    host: z
      .string()
      .trim()
      .min(1)
      .max(253)
      .regex(/^(?!.*[/@?#\s])(?:\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)$/, 'Invalid camera host'),
    port: z.number().int().min(1).max(65535).default(554),
    path: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .regex(/^\/(?!\/)[^\s?#]*$/, 'Invalid RTSP path'),
    transport: z.enum(['tcp', 'udp']).default('tcp'),
  })
  .strict();

export const cameraCredentialsSchema = z
  .object({
    username: z.string().trim().min(1).max(191),
    password: z.string().min(1).max(512),
    stream: rtspSourceSchema.optional(),
  })
  .strict();

export const createCameraSchema = z
  .object({ ...cameraFields, credentials: cameraCredentialsSchema.optional() })
  .strict();

export const updateCameraSchema = z
  .object(cameraFields)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');

export const cameraStatusSchema = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }).strict();

export const motionConfigurationSchema = z
  .object({
    enabled: z.boolean(),
    sensitivity: z.enum(['LOW', 'MEDIUM', 'HIGH']),
    sampleFps: z.number().int().min(1).max(5).default(2),
    cooldownSeconds: z.number().int().min(3).max(300).default(10),
    captureSnapshot: z.boolean().default(false),
  })
  .strict();

export const cameraListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  administrativeStatus: z.enum(['ACTIVE', 'DISABLED']).optional(),
  connectionStatus: z
    .enum([
      'UNKNOWN',
      'CONNECTING',
      'ONLINE',
      'DEGRADED',
      'OFFLINE',
      'AUTHENTICATION_ERROR',
      'UNSUPPORTED',
      'ERROR',
    ])
    .optional(),
  connectionType: z.enum(['WIFI', 'ETHERNET', 'OTHER']).optional(),
  protocol: z.enum(['RTSP', 'ONVIF', 'HTTP', 'HTTPS', 'OTHER']).optional(),
  location: z.string().trim().min(1).max(255).optional(),
  search: z.string().trim().min(1).max(100).optional(),
  sortBy: z
    .enum([
      'name',
      'createdAt',
      'updatedAt',
      'lastSeenAt',
      'administrativeStatus',
      'connectionStatus',
    ])
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
