import { describe, expect, it } from 'vitest';
import { QR_PAYLOAD_MAX_BYTES, qrAnalyzeSchema, qrTelemetrySchema } from './qr-analysis.schemas';

describe('QR analysis validation', () => {
  it('accepts bounded text and rejects oversized, control characters and mass assignment', () => {
    expect(qrAnalyzeSchema.parse({ payload: 'model=C200' })).toEqual({ payload: 'model=C200' });
    expect(() =>
      qrAnalyzeSchema.parse({ payload: 'a'.repeat(QR_PAYLOAD_MAX_BYTES + 1) }),
    ).toThrow();
    expect(() => qrAnalyzeSchema.parse({ payload: 'camera\u0000token' })).toThrow();
    expect(() =>
      qrAnalyzeSchema.parse({ payload: 'ok', organizationId: crypto.randomUUID() }),
    ).toThrow();
  });

  it('allows only safe telemetry metadata', () => {
    expect(
      qrTelemetrySchema.parse({ event: 'qr_scan_failed', reason: 'PERMISSION_DENIED' }),
    ).toBeTruthy();
    expect(() =>
      qrTelemetrySchema.parse({ event: 'qr_scan_success', payload: 'secret' }),
    ).toThrow();
  });
});
