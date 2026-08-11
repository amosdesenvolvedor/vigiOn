import { describe, expect, it } from 'vitest';
import {
  createGatewaySecret,
  hashGatewaySecret,
  hashPairingCode,
  verifyGatewaySecret,
} from './gateway.secret';

describe('gateway secrets', () => {
  it('stores a salted one-way hash and compares in constant-time primitive', () => {
    const secret = createGatewaySecret();
    const encoded = hashGatewaySecret(secret);
    expect(encoded).not.toContain(secret);
    expect(verifyGatewaySecret(secret, encoded)).toBe(true);
    expect(verifyGatewaySecret(`${secret}x`, encoded)).toBe(false);
  });
  it('normalizes pairing codes before hashing', () => {
    expect(hashPairingCode(' vigion-abcd ')).toBe(hashPairingCode('VIGION-ABCD'));
  });
});
