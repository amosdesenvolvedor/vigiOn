import { z } from 'zod';

const check = z.enum(['OK', 'FAILED', 'AUTHENTICATION_ERROR', 'PROTOCOL_ERROR', 'SKIPPED']);
const privateIpv4 = z
  .string()
  .ip({ version: 'v4' })
  .refine((value) => {
    const [a, b] = value.split('.').map(Number);
    return a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168);
  });

export const cameraHealthBatchSchema = z
  .object({
    messageId: z.string().uuid(),
    protocolVersion: z.literal('1'),
    entries: z
      .array(
        z
          .object({
            cameraId: z.string().uuid(),
            generation: z.number().int().min(1),
            sequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
            observedAt: z.string().datetime(),
            status: z.enum([
              'ONLINE',
              'DEGRADED',
              'OFFLINE',
              'AUTHENTICATION_ERROR',
              'UNSUPPORTED',
            ]),
            checks: z.object({ onvif: check, rtsp: check }).strict(),
            consecutiveFailures: z.number().int().min(0).max(1000),
            failureCode: z
              .string()
              .regex(/^[A-Z0-9_]{1,64}$/)
              .optional(),
            observedTarget: z
              .object({
                address: privateIpv4,
                servicePort: z.number().int().min(1).max(65535),
                evidence: z.literal('ONVIF_ENDPOINT_REFERENCE_EXACT'),
              })
              .strict()
              .optional(),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export type CameraHealthBatch = z.infer<typeof cameraHealthBatchSchema>;
