import {
  createDecipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
} from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { encryptForGateway } from './stream-envelope';

describe('stream source envelope', () => {
  it('encrypts recoverable camera credentials only for the gateway X25519 key', () => {
    const gateway = generateKeyPairSync('x25519');
    const publicKey = gateway.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const payload = {
      username: 'camera',
      password: 'not-logged',
      stream: { host: '192.168.1.10', port: 554, path: '/live', transport: 'tcp' },
    };
    const envelope = encryptForGateway(publicKey, payload);
    expect(JSON.stringify(envelope)).not.toContain(payload.password);
    const shared = diffieHellman({
      privateKey: gateway.privateKey,
      publicKey: createPublicKey(envelope.ephemeralPublicKey),
    });
    const key = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), 'vigioni-stream-v1', 32));
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(envelope.initializationVector, 'base64url'),
    );
    decipher.setAAD(Buffer.from('vigioni-stream-source-v1'));
    decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'base64url'));
    const clear = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
      decipher.final(),
    ]);
    expect(JSON.parse(clear.toString('utf8'))).toEqual(payload);
  });

  it('rejects non-X25519 public keys', () => {
    const wrong = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .publicKey.export({ type: 'spki', format: 'pem' })
      .toString();
    expect(() => encryptForGateway(wrong, { secret: true })).toThrowError(
      expect.objectContaining({ code: 'GATEWAY_ENCRYPTION_UNAVAILABLE' }),
    );
  });
});
