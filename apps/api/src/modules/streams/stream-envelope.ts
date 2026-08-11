import {
  createCipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { AuthError } from '../auth/auth.errors';

export interface StreamEnvelope {
  ephemeralPublicKey: string;
  initializationVector: string;
  authenticationTag: string;
  ciphertext: string;
}

export const encryptForGateway = (publicKeyPem: string, payload: object): StreamEnvelope => {
  try {
    const recipient = createPublicKey(publicKeyPem);
    if (recipient.asymmetricKeyType !== 'x25519') throw new Error('Wrong key type');
    const ephemeral = generateKeyPairSync('x25519');
    const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
    const key = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), 'vigioni-stream-v1', 32));
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, initializationVector);
    cipher.setAAD(Buffer.from('vigioni-stream-source-v1'));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(payload), 'utf8'),
      cipher.final(),
    ]);
    return {
      ephemeralPublicKey: ephemeral.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      initializationVector: initializationVector.toString('base64url'),
      authenticationTag: cipher.getAuthTag().toString('base64url'),
      ciphertext: ciphertext.toString('base64url'),
    };
  } catch {
    throw new AuthError(
      409,
      'GATEWAY_ENCRYPTION_UNAVAILABLE',
      'Gateway must reconnect before streaming',
    );
  }
};
