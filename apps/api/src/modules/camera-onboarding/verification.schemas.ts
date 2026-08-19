import { z } from 'zod';

export const startVerificationSchema = z
  .object({
    discoverySessionId: z.string().uuid(),
    candidateId: z.string().uuid(),
  })
  .strict();

export const verificationCredentialsSchema = z
  .object({
    username: z.string().trim().min(1).max(128),
    password: z.string().min(1).max(256),
  })
  .strict();

const identity = z
  .object({
    manufacturer: z.string().trim().max(120).optional(),
    model: z.string().trim().max(160).optional(),
    firmwareVersion: z.string().trim().max(160).optional(),
    serialNumber: z.string().trim().max(160).optional(),
    hardwareId: z.string().trim().max(160).optional(),
  })
  .strict();

const capabilities = z
  .object({
    onvif: z.boolean(),
    media: z.boolean(),
    media2: z.boolean(),
    rtsp: z.boolean(),
    ptz: z.boolean(),
    events: z.boolean(),
    imaging: z.boolean(),
    profiles: z.number().int().min(0).max(64),
    codecs: z.array(z.string().trim().min(1).max(32)).max(16),
    tracks: z.number().int().min(0).max(64),
  })
  .strict();

export const gatewayVerificationResultSchema = z
  .object({
    messageId: z.string().uuid(),
    commandId: z.string().uuid(),
    verificationSessionId: z.string().uuid(),
    protocolVersion: z.literal('1'),
    result: z.enum([
      'VERIFIED',
      'PARTIALLY_VERIFIED',
      'AUTHENTICATION_REQUIRED',
      'AUTHENTICATION_FAILED',
      'ONVIF_UNAVAILABLE',
      'RTSP_UNAVAILABLE',
      'TIMEOUT',
      'NETWORK_ERROR',
      'UNSUPPORTED',
      'CANCELED',
    ]),
    identity: identity.optional(),
    capabilities: capabilities.optional(),
    stream: z
      .object({
        port: z.number().int().min(1).max(65535),
        path: z.string().trim().min(1).max(512).regex(/^\/(?!\/)[^\s?#]*$/),
        transport: z.literal('tcp'),
      })
      .strict()
      .optional(),
    evidence: z
      .object({
        onvifDeviceInformation: z.boolean(),
        onvifCapabilities: z.boolean(),
        mediaProfiles: z.boolean(),
        streamUriValidated: z.boolean(),
        rtspHandshake: z.boolean(),
      })
      .strict(),
    errorCode: z.string().trim().regex(/^[A-Z0-9_]{1,64}$/).optional(),
  })
  .strict();

export type GatewayVerificationResult = z.infer<typeof gatewayVerificationResultSchema>;
