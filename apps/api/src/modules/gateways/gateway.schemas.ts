import { z } from 'zod';

export const createPairingSchema = z.object({}).strict();
export const claimGatewaySchema = z
  .object({
    pairingCode: z.string().trim().min(10).max(32),
    name: z.string().trim().min(2).max(160),
    version: z.string().trim().min(1).max(40),
    protocolVersion: z.literal('1'),
    encryptionPublicKey: z.string().min(80).max(1000),
  })
  .strict();
export const heartbeatSchema = z
  .object({
    messageId: z.string().uuid(),
    version: z.string().trim().min(1).max(40),
    protocolVersion: z.literal('1'),
    timestamp: z.string().datetime(),
    uptime: z.number().int().nonnegative().max(2_147_483_647).optional(),
    status: z.enum(['ONLINE', 'CONNECTING']),
    encryptionPublicKey: z.string().min(80).max(1000).optional(),
  })
  .strict();
export const commandAckSchema = z
  .object({
    messageId: z.string().uuid(),
    commandId: z.string().uuid(),
    status: z.enum([
      'SUCCESS',
      'FAILED',
      'TIMEOUT',
      'AUTHENTICATION_ERROR',
      'UNSUPPORTED_PROTOCOL',
      'UNSUPPORTED_CODEC',
      'LOCAL_STORAGE_LIMIT_REACHED',
    ]),
    details: z.string().trim().max(500).optional(),
  })
  .strict();
export const updateGatewaySchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    status: z.enum(['DISABLED', 'UNKNOWN']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one field is required');
export const associationSchema = z.object({ cameraId: z.string().uuid() }).strict();
