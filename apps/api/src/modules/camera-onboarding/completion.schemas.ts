import { z } from 'zod';

const optionalText = (max: number) => z.string().trim().max(max).transform((value) => value || null).nullable().optional();

export const completeOnboardingSchema = z.object({
  verificationSessionId: z.string().uuid(),
  name: z.string().trim().min(2).max(160),
  location: optionalText(255),
}).strict();
