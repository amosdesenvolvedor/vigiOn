import { describe, expect, it } from 'vitest';
import {
  cameraCredentialsSchema,
  cameraListSchema,
  createCameraSchema,
  updateCameraSchema,
} from './camera.schemas';

describe('camera input validation', () => {
  it('rejects URLs and unsafe RTSP endpoints in camera stream configuration', () => {
    expect(() =>
      cameraCredentialsSchema.parse({
        username: 'camera',
        password: 'secret',
        stream: {
          host: 'http://169.254.169.254',
          port: 554,
          path: '/live',
          transport: 'tcp',
        },
      }),
    ).toThrow();
    expect(() =>
      cameraCredentialsSchema.parse({
        username: 'camera',
        password: 'secret',
        stream: { host: 'camera.local', port: 554, path: '//evil', transport: 'tcp' },
      }),
    ).toThrow();
  });
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
