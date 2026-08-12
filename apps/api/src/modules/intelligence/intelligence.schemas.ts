import { z } from 'zod';

const interval = z.object({
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
});
export const scheduleSchema = z
  .object({
    cameraId: z.string().uuid().nullable().default(null),
    mode: z.enum(['ALWAYS', 'SCHEDULED', 'DISABLED']),
    intervals: z.array(interval).max(28),
  })
  .strict();
export const exceptionSchema = z
  .object({
    localDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    mode: z.enum(['OPEN', 'CLOSED']),
    startMinute: z.number().int().min(0).max(1439).nullable().default(null),
    endMinute: z.number().int().min(0).max(1439).nullable().default(null),
    label: z.string().trim().max(120).nullable().default(null),
  })
  .strict()
  .refine((v) => v.mode === 'CLOSED' || (v.startMinute !== null && v.endMinute !== null), {
    message: 'Open exceptions require start and end',
  });
const point = z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) });
export const zoneSchema = z
  .object({
    cameraId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    priority: z.enum(['NORMAL', 'HIGH']),
    polygon: z.array(point).min(3).max(20),
    enabled: z.boolean().default(true),
  })
  .strict();
