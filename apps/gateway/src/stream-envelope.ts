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

export const decryptStreamSource = (
  privateKeyPem: string,
  envelope: EncryptedStreamSource,
): RtspSource => {
  const privateKey = createPrivateKey(privateKeyPem);
  const ephemeral = createPublicKey(envelope.ephemeralPublicKey);
  const shared = diffieHellman({ privateKey, publicKey: ephemeral });
  const key = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), 'vigioni-stream-v1', 32));
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(envelope.initializationVector, 'base64url'),
  );
  decipher.setAAD(Buffer.from('vigioni-stream-source-v1'));
  decipher.setAuthTag(Buffer.from(envelope.authenticationTag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64url')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8')) as RtspSource;
};
