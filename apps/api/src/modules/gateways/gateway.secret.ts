import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

export const hashPairingCode = (code: string) =>
  createHash('sha256').update(code.trim().toUpperCase()).digest('hex');

export const createGatewaySecret = () => randomBytes(32).toString('base64url');

export const hashGatewaySecret = (secret: string) => {
  const salt = randomBytes(16);
  const hash = scryptSync(secret, salt, 32);
  return `scrypt:${salt.toString('base64url')}:${hash.toString('base64url')}`;
};

export const verifyGatewaySecret = (secret: string, encoded: string) => {
  const [algorithm, saltValue, hashValue] = encoded.split(':');
  if (algorithm !== 'scrypt' || !saltValue || !hashValue) return false;
  const expected = Buffer.from(hashValue, 'base64url');
  const actual = scryptSync(secret, Buffer.from(saltValue, 'base64url'), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
};
