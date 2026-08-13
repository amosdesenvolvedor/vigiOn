import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.hoisted(() => vi.fn());
const workerCount = vi.hoisted(() => vi.fn());
const storageHealth = vi.hoisted(() => vi.fn());
vi.mock('../lib/prisma', () => ({
  prisma: { $queryRaw: query, workerHealth: { count: workerCount } },
}));
vi.mock('../modules/media/object-storage.service', () => ({
  S3ObjectStorageService: class { health = storageHealth; },
}));

import { healthRouter } from './health';

const app = express().use('/health', healthRouter);

describe('production readiness', () => {
  beforeEach(() => {
    query.mockReset().mockResolvedValue([{ ok: 1 }]);
    storageHealth.mockReset().mockResolvedValue(true);
    workerCount.mockReset().mockResolvedValue(5);
  });

  it('is ready only when database, object storage and all workers are healthy', async () => {
    const healthy = await request(app).get('/health/ready');
    expect(healthy.status).toBe(200);
    expect(healthy.body.dependencies).toEqual({
      database: 'ready', objectStorage: 'ready', workers: 'ready',
    });

    workerCount.mockResolvedValue(4);
    expect((await request(app).get('/health/ready')).status).toBe(503);
  });

  it('fails closed when object storage is unavailable', async () => {
    storageHealth.mockResolvedValue(false);
    expect((await request(app).get('/health/ready')).status).toBe(503);
  });
});
