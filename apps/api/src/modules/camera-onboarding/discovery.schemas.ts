import { z } from 'zod';

const identifier = z
  .object({
    type: z.enum(['SERIAL_NUMBER', 'UID', 'DEVICE_ID', 'MAC_ADDRESS', 'ONVIF_ENDPOINT_REFERENCE']),
    value: z.string().trim().min(1).max(255),
    confidence: z.enum(['EXACT', 'HIGH']),
  })
  .strict();

export const startDiscoverySchema = z
  .object({
    gatewayId: z.string().uuid(),
    catalogVariantId: z.string().uuid().optional(),
    expectedManufacturer: z.string().trim().min(1).max(120).optional(),
    expectedModel: z.string().trim().min(1).max(160).optional(),
    expectedVariant: z.string().trim().min(1).max(80).optional(),
    identifiers: z.array(identifier).max(5).default([]),
  })
  .strict()
  .refine((value) => value.catalogVariantId || value.expectedManufacturer || value.expectedModel, {
    message: 'A confirmed catalog or camera identity is required',
  });

export const confirmDiscoverySchema = z.object({ candidateId: z.string().uuid() }).strict();

const privateIpv4 = z
  .string()
  .ip({ version: 'v4' })
  .refine((value) => {
    const [a, b] = value.split('.').map(Number);
    return a === 10 || (a === 172 && b! >= 16 && b! <= 31) || (a === 192 && b === 168);
  }, 'Only private IPv4 discovery results are accepted');

export const gatewayDiscoveryResultSchema = z
  .object({
    messageId: z.string().uuid(),
    commandId: z.string().uuid(),
    sessionId: z.string().uuid(),
    protocolVersion: z.literal('1'),
    status: z.enum(['SCANNING', 'RESULTS', 'COMPLETED', 'FAILED', 'CANCELED']),
    candidates: z
      .array(
        z
          .object({
            networkAddress: privateIpv4,
            servicePort: z.number().int().min(1).max(65535),
            endpointReference: z.string().trim().min(1).max(255).optional(),
            manufacturer: z.string().trim().min(1).max(120).optional(),
            model: z.string().trim().min(1).max(160).optional(),
            hardwareInfo: z.string().trim().min(1).max(160).optional(),
            authenticationRequired: z.boolean().default(false),
            evidence: z.literal('ONVIF_WS_DISCOVERY'),
          })
          .strict(),
      )
      .max(32),
  })
  .strict();

export type StartDiscoveryInput = z.infer<typeof startDiscoverySchema>;
export type GatewayDiscoveryResult = z.infer<typeof gatewayDiscoveryResultSchema>;
