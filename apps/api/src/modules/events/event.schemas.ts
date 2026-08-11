import { z } from 'zod';

export const eventTypeSchema = z.enum([
  'MOTION',
  'CAMERA_OFFLINE',
  'CAMERA_ONLINE',
  'GATEWAY_OFFLINE',
  'GATEWAY_ONLINE',
]);

export const gatewayEventSchema = z
  .object({
    messageId: z.string().uuid(),
    eventId: z.string().uuid(),
    protocolVersion: z.literal('1'),
    cameraId: z.string().uuid(),
    type: z.enum(['MOTION', 'CAMERA_OFFLINE', 'CAMERA_ONLINE']),
    occurredAt: z.string().datetime(),
    endedAt: z.string().datetime().optional(),
    motionScore: z.number().min(0).max(1).optional(),
  })
  .strict();

export const eventListSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cameraId: z.string().uuid().optional(),
    gatewayId: z.string().uuid().optional(),
    type: eventTypeSchema.optional(),
    severity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).optional(),
    startDate: z.string().datetime().optional(),
    endDate: z.string().datetime().optional(),
  })
  .refine((value) => !value.startDate || !value.endDate || value.startDate <= value.endDate, {
    message: 'startDate must be before endDate',
    path: ['startDate'],
  });
