import { describe, expect, it } from 'vitest';
import { gatewayVerificationResultSchema, verificationCredentialsSchema } from './verification.schemas';

describe('camera verification contracts', () => {
  it('accepts explicit bounded credentials and rejects target injection', () => {
    expect(verificationCredentialsSchema.parse({ username: 'admin', password: 'secret' }))
      .toEqual({ username: 'admin', password: 'secret' });
    expect(() => verificationCredentialsSchema.parse({ username: 'admin', password: 'secret', host: '8.8.8.8' }))
      .toThrow();
  });

  it('accepts only sanitized gateway evidence without URI, SDP or credentials', () => {
    const base = { messageId: '00000000-0000-4000-8000-000000000001',
      commandId: '00000000-0000-4000-8000-000000000002',
      verificationSessionId: '00000000-0000-4000-8000-000000000003', protocolVersion: '1',
      result: 'VERIFIED', evidence: { onvifDeviceInformation: true, onvifCapabilities: true,
        mediaProfiles: true, streamUriValidated: true, rtspHandshake: true } };
    expect(gatewayVerificationResultSchema.parse(base).result).toBe('VERIFIED');
    expect(() => gatewayVerificationResultSchema.parse({ ...base, streamUri: 'rtsp://secret' })).toThrow();
    expect(() => gatewayVerificationResultSchema.parse({ ...base, password: 'secret' })).toThrow();
  });
});
