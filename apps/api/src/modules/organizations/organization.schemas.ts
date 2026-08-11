import { z } from 'zod';

const role = z.enum(['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER']);
const timezone = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid timezone');

export const updateOrganizationSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    timezone: timezone.optional(),
    tradeName: z.string().trim().max(180).nullable().optional(),
    contactEmail: z.string().trim().email().max(254).nullable().optional(),
    contactPhone: z.string().trim().max(32).nullable().optional(),
    country: z
      .string()
      .trim()
      .length(2)
      .transform((value) => value.toUpperCase())
      .optional(),
    language: z.string().trim().min(2).max(16).optional(),
    monitoringPreferences: z.record(z.unknown()).optional(),
    notificationPreferences: z.record(z.unknown()).optional(),
  })
  .strict();

export const invitationSchema = z.object({ email: z.string().trim().email().max(254), role });
export const roleSchema = z.object({ role });
export const statusSchema = z.object({ status: z.enum(['ACTIVE', 'SUSPENDED']) });
export const invitationTokenSchema = z.object({ token: z.string().min(32).max(256) });
