import { z } from 'zod';

const strongPassword = z
  .string()
  .min(8, 'Password must contain at least 8 characters')
  .max(128)
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[0-9]/, 'Password must include a number')
  .regex(/[^A-Za-z0-9]/, 'Password must include a symbol');

export const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    email: z.string().trim().email().max(254),
    password: strongPassword,
    passwordConfirmation: z.string(),
    organizationName: z.string().trim().min(2).max(160),
    timezone: z.string().trim().min(1).max(64).default('UTC'),
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    message: 'Passwords do not match',
    path: ['passwordConfirmation'],
  });

export const loginSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
  mfaCode: z.string().trim().min(6).max(32).optional(),
});

export const mfaCodeSchema = z.object({ code: z.string().trim().min(6).max(32) });
export const oauthOnboardingSchema = z.object({
  name: z.string().trim().min(2).max(160),
  organizationName: z.string().trim().min(2).max(160),
  timezone: z.string().trim().min(1).max(64).default('UTC'),
});
export const mfaDisableSchema = z.object({
  password: z.string().min(1).max(128),
  code: z.string().trim().min(6).max(32),
});

export const emailSchema = z.object({ email: z.string().trim().email().max(254) });
export const tokenSchema = z.object({ token: z.string().min(32).max(256) });
export const resetPasswordSchema = tokenSchema
  .extend({
    password: strongPassword,
    passwordConfirmation: z.string(),
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    message: 'Passwords do not match',
    path: ['passwordConfirmation'],
  });

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    password: strongPassword,
    passwordConfirmation: z.string(),
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    message: 'Passwords do not match',
    path: ['passwordConfirmation'],
  });
