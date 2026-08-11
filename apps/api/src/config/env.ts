import 'dotenv/config';
import { z } from 'zod';

const optionalSecret = (minimum: number) =>
  z.preprocess((value) => (value === '' ? undefined : value), z.string().min(minimum).optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().max(65535).default(3000),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(300).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(60).default(30),
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(72).default(24),
  APP_URL: z.string().url().default('http://localhost:5173'),
  EMAIL_FROM: z.string().min(3).default('VigiOn <no-reply@vigion.cloud>'),
  RESEND_API_KEY: optionalSecret(20),
  CAMERA_CREDENTIAL_KEY: optionalSecret(43),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
