import {
  createDecipheriv,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  hkdfSync,
} from 'node:crypto';

export interface EncryptedStreamSource {
  ephemeralPublicKey: string;
  initializationVector: string;
  authenticationTag: string;
  ciphertext: string;
}

export interface RtspSource {
  username: string;
  password: string;
  stream: { host: string; port: number; path: string; transport: 'tcp' | 'udp' };
}

export interface VerificationCredentials {
  username: string;
  password: string;
}

type EnvelopePurpose = 'stream' | 'camera-verification' | 'camera-registration';

const decryptEnvelope = <T>(
  privateKeyPem: string,
  envelope: EncryptedStreamSource,
  purpose: EnvelopePurpose,
): T => {
  const context =
    purpose === 'stream'
      ? { info: 'vigioni-stream-v1', aad: 'vigioni-stream-source-v1' }
      : purpose === 'camera-verification'
        ? { info: 'vigioni-camera-verification-v1', aad: 'vigioni-camera-credentials-v1' }
        : { info: 'vigioni-camera-registration-v1', aad: 'vigioni-camera-registration-credentials-v1' };
  const privateKey = createPrivateKey(privateKeyPem);
  const ephemeral = createPublicKey(envelope.ephemeralPublicKey);
  const shared = diffieHellman({ privateKey, publicKey: ephemeral });
  const key = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), context.info, 32));
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.initializationVector, 'base64url'),
  );
  decipher.setAAD(Buffer.from(context.aad));
  decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as T;
};

export const decryptStreamSource = (
  privateKeyPem: string,
  envelope: EncryptedStreamSource,
): RtspSource => {
  return decryptEnvelope<RtspSource>(privateKeyPem, envelope, 'stream');
};

export const decryptVerificationCredentials = (
  privateKeyPem: string,
  envelope: EncryptedStreamSource,
): VerificationCredentials =>
  decryptEnvelope<VerificationCredentials>(privateKeyPem, envelope, 'camera-verification');

export const decryptRegistrationCredentials = (
  privateKeyPem: string,
  envelope: EncryptedStreamSource,
): VerificationCredentials =>
  decryptEnvelope<VerificationCredentials>(privateKeyPem, envelope, 'camera-registration');
