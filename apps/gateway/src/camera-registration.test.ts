import { createCipheriv, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CameraRegistrationRegistry } from './camera-registration';
import type { EncryptedStreamSource } from './stream-envelope';

const envelope = (publicKeyPem: string): EncryptedStreamSource => {
  const recipient = createPublicKey(publicKeyPem); const ephemeral = generateKeyPairSync('x25519');
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const key = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), 'vigioni-camera-registration-v1', 32));
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('vigioni-camera-registration-credentials-v1'));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify({ username: 'admin', password: 'secret' })), cipher.final()]);
  return { ephemeralPublicKey: ephemeral.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    initializationVector: iv.toString('base64url'), authenticationTag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url') };
};

describe('CAMERA_REGISTER', () => {
  it('registers idempotently and keeps no credential file or plaintext', () => {
    const keys = generateKeyPairSync('x25519'); const registry = new CameraRegistrationRegistry();
    const payload = { cameraId: '00000000-0000-4000-8000-000000000001',
      encryptedCredentials: envelope(keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()) };
    const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(JSON.stringify(payload)).not.toContain('secret');
    expect(registry.register(privateKey, payload)).toBe('SUCCESS');
    expect(registry.register(privateKey, payload)).toBe('SUCCESS');
  });

  it('rejects invalid camera IDs, missing credentials and the wrong gateway key', () => {
    const owner = generateKeyPairSync('x25519'); const wrong = generateKeyPairSync('x25519');
    const registry = new CameraRegistrationRegistry();
    const encryptedCredentials = envelope(owner.publicKey.export({ type: 'spki', format: 'pem' }).toString());
    const wrongKey = wrong.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    expect(registry.register(wrongKey, { cameraId: 'invalid', encryptedCredentials })).toBe('FAILED');
    expect(registry.register(wrongKey, { cameraId: '00000000-0000-4000-8000-000000000001' })).toBe('FAILED');
    expect(registry.register(wrongKey, { cameraId: '00000000-0000-4000-8000-000000000001', encryptedCredentials })).toBe('FAILED');
  });
});
