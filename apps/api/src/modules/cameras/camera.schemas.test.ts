import { describe, expect, it } from 'vitest';
import { cameraListSchema, createCameraSchema, updateCameraSchema } from './camera.schemas';

describe('camera input validation', () => {
  it('accepts valid camera data and rejects organizationId injection', () => {
    expect(
      createCameraSchema.parse({
        name: 'Entrada',
        connectionType: 'WIFI',
        protocol: 'RTSP',
      }),
    ).toMatchObject({ name: 'Entrada' });
    expect(() =>
      createCameraSchema.parse({
        name: 'Entrada',
        connectionType: 'WIFI',
        protocol: 'RTSP',
        organizationId: 'attacker-tenant',
      }),
    ).toThrow();
    expect(() => updateCameraSchema.parse({ organizationId: 'attacker-tenant' })).toThrow();
  });

  it('validates pagination, maximum limit, filters and safe sorting', () => {
    expect(cameraListSchema.parse({ page: '2', limit: '100', protocol: 'ONVIF' })).toMatchObject({
      page: 2,
      limit: 100,
      protocol: 'ONVIF',
    });
    expect(() => cameraListSchema.parse({ page: 0 })).toThrow();
    expect(() => cameraListSchema.parse({ limit: 101 })).toThrow();
    expect(() => cameraListSchema.parse({ sortBy: 'organizationId' })).toThrow();
    expect(() => cameraListSchema.parse({ protocol: 'INVALID' })).toThrow();
  });
});
