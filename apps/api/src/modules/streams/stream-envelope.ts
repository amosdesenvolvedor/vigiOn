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

type EnvelopePurpose = 'stream' | 'camera-verification' | 'camera-registration';

const envelopeContext = (purpose: EnvelopePurpose) =>
  purpose === 'stream'
    ? { info: 'vigioni-stream-v1', aad: 'vigioni-stream-source-v1' }
    : purpose === 'camera-verification'
      ? { info: 'vigioni-camera-verification-v1', aad: 'vigioni-camera-credentials-v1' }
      : { info: 'vigioni-camera-registration-v1', aad: 'vigioni-camera-registration-credentials-v1' };

export const encryptGatewayEnvelope = (
  publicKeyPem: string,
  payload: object,
  purpose: EnvelopePurpose,
): StreamEnvelope => {
  try {
    const recipient = createPublicKey(publicKeyPem);
    if (recipient.asymmetricKeyType !== 'x25519') throw new Error('Wrong key type');
    const ephemeral = generateKeyPairSync('x25519');
    const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
    const context = envelopeContext(purpose);
    const key = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), context.info, 32));
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, initializationVector);
    cipher.setAAD(Buffer.from(context.aad));
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

export const encryptForGateway = (publicKeyPem: string, payload: object): StreamEnvelope =>
  encryptGatewayEnvelope(publicKeyPem, payload, 'stream');

export const encryptVerificationCredentials = (publicKeyPem: string, payload: object) =>
  encryptGatewayEnvelope(publicKeyPem, payload, 'camera-verification');

export const encryptRegistrationCredentials = (publicKeyPem: string, payload: object) =>
  encryptGatewayEnvelope(publicKeyPem, payload, 'camera-registration');
