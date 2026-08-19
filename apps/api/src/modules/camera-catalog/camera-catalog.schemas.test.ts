import { describe, expect, it } from 'vitest';
import {
  catalogListSchema,
  compatibilitySchema,
  createModelSchema,
} from './camera-catalog.schemas';

describe('camera catalog validation', () => {
  it('enforces pagination limits, filters and safe sorting', () => {
    expect(
      catalogListSchema.parse({ search: 'C520WS', limit: '100', protocol: 'RTSP' }),
    ).toMatchObject({ search: 'C520WS', limit: 100, protocol: 'RTSP' });
    expect(() => catalogListSchema.parse({ limit: 101 })).toThrow();
    expect(() => catalogListSchema.parse({ sortBy: 'manufacturerId' })).toThrow();
    expect(() => catalogListSchema.parse({ protocol: 'INVALID' })).toThrow();
  });

  it('rejects mass assignment and invalid compatibility values', () => {
    expect(() =>
      createModelSchema.parse({
        brandId: crypto.randomUUID(),
        name: 'C200',
        organizationId: crypto.randomUUID(),
      }),
    ).toThrow();
    expect(() =>
      compatibilitySchema.parse({ level: 'SUPPORTED', confidence: 'TRUST_ME', reason: 'invalid' }),
    ).toThrow();
  });
});
