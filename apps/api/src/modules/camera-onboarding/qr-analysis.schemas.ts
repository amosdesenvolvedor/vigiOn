import { z } from 'zod';

export const QR_PAYLOAD_MAX_BYTES = 8192;

export const qrAnalyzeSchema = z
  .object({
    payload: z
      .string()
      .min(1, 'QR payload is required')
      .refine((value) => Buffer.byteLength(value, 'utf8') <= QR_PAYLOAD_MAX_BYTES, {
        message: `QR payload must not exceed ${QR_PAYLOAD_MAX_BYTES} bytes`,
      })
      .refine(
        (value) =>
          [...value].every((character) => {
            const code = character.codePointAt(0) ?? 0;
            return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
          }),
        {
          message: 'QR payload contains invalid control characters',
        },
      ),
  })
  .strict();

export const qrTelemetrySchema = z
  .object({
    event: z.enum([
      'qr_scan_started',
      'qr_scan_success',
      'qr_scan_unknown',
      'qr_scan_multiple_matches',
      'qr_scan_failed',
    ]),
    reason: z
      .enum([
        'PERMISSION_DENIED',
        'CAMERA_NOT_AVAILABLE',
        'CAMERA_IN_USE',
        'UNSUPPORTED_BROWSER',
        'NO_QR_DETECTED',
        'INVALID_IMAGE',
      ])
      .optional(),
  })
  .strict();

export type QrAnalyzeInput = z.infer<typeof qrAnalyzeSchema>;
