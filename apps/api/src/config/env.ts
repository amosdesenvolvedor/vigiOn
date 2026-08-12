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
  GATEWAY_PAIRING_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  GATEWAY_OFFLINE_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(3600).default(120),
  GATEWAY_COMMAND_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  STREAM_SESSION_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(600),
  STREAM_IDLE_TIMEOUT_SECONDS: z.coerce.number().int().min(30).max(600).default(90),
  STREAM_START_TIMEOUT_SECONDS: z.coerce.number().int().min(10).max(180).default(45),
  MAX_ACTIVE_STREAMS_PER_ORG: z.coerce.number().int().min(1).max(100).default(10),
  STREAM_MEDIA_ROOT: z.string().min(1).default('/tmp/vigion-streams'),
  OBJECT_STORAGE_ENDPOINT: z.string().url().default('http://localhost:9000'),
  OBJECT_STORAGE_REGION: z.string().min(1).default('us-east-1'),
  OBJECT_STORAGE_BUCKET: z.string().min(3).default('vigion-media'),
  OBJECT_STORAGE_ACCESS_KEY: optionalSecret(3),
  OBJECT_STORAGE_SECRET_KEY: optionalSecret(8),
  MEDIA_ACCESS_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),
  SNAPSHOT_MAX_BYTES: z.coerce.number().int().min(1024).default(5_242_880),
  RECORDING_MAX_BYTES: z.coerce.number().int().min(1_048_576).default(67_108_864),
  RECORDING_SEGMENT_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
  RETENTION_INTERVAL_SECONDS: z.coerce.number().int().min(30).max(86400).default(300),
  EVENT_TIMESTAMP_SKEW_SECONDS: z.coerce.number().int().min(60).max(86400).default(3600),
  EVENT_METADATA_MAX_BYTES: z.coerce.number().int().min(256).max(16384).default(4096),
  GATEWAY_RECONCILE_INTERVAL_SECONDS: z.coerce.number().int().min(15).max(300).default(30),
  NOTIFICATION_WORKER_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(300).default(30),
  NOTIFICATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  NOTIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  EMAIL_COOLDOWN_SECONDS: z.coerce.number().int().min(60).max(86400).default(900),
  WEB_PUSH_VAPID_PUBLIC_KEY: optionalSecret(40),
  WEB_PUSH_VAPID_PRIVATE_KEY: optionalSecret(40),
  WEB_PUSH_SUBJECT: z.string().default('mailto:security@vigion.cloud'),
});

const parsed = envSchema.safeParse(process.env);

if (
  parsed.success &&
  Boolean(parsed.data.WEB_PUSH_VAPID_PUBLIC_KEY) !== Boolean(parsed.data.WEB_PUSH_VAPID_PRIVATE_KEY)
) {
  throw new Error('Both Web Push VAPID keys must be configured together');
}
if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;
