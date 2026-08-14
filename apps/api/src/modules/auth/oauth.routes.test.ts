import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../../app';

describe('OAuth routes with providers disabled', () => {
  it('reports both providers as unavailable without requiring credentials', async () => {
    const response = await request(createApp()).get('/api/v1/auth/oauth/providers');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ providers: { google: false, microsoft: false } });
  });

  it.each(['google', 'microsoft'])('does not start disabled provider %s', async (provider) => {
    const response = await request(createApp()).get(`/api/v1/auth/oauth/${provider}`);
    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('OAUTH_PROVIDER_DISABLED');
  });

  it('does not expose unknown providers', async () => {
    const response = await request(createApp()).get('/api/v1/auth/oauth/unknown');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('OAUTH_PROVIDER_UNKNOWN');
  });
});
