import { Router } from 'express';
import type { HealthResponse } from '@vigioni/shared';
import { prisma } from '../lib/prisma';
import { env } from '../config/env';
import { S3ObjectStorageService } from '../modules/media/object-storage.service';

export const healthRouter = Router();
const objectStorage = new S3ObjectStorageService();
const expectedWorkers = [
  'stream-cleanup',
  'media-retention',
  'gateway-reconcile',
  'notification-dispatch',
  'billing-reconcile',
];

healthRouter.get('/', async (_request, response) => {
  let databaseStatus: HealthResponse['database'] = 'connected';

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    databaseStatus = 'unavailable';
  }

  const body: HealthResponse = {
    status: 'ok',
    service: 'vigioni-api',
    timestamp: new Date().toISOString(),
    database: databaseStatus,
  };

  response.status(databaseStatus === 'connected' ? 200 : 503).json(body);
});

healthRouter.get('/live', (_request, response) => {
  response.json({ status: 'ok', service: 'vigioni-api', timestamp: new Date().toISOString() });
});

healthRouter.get('/ready', async (_request, response) => {
  const maximumIntervalSeconds = Math.max(
    30,
    env.RETENTION_INTERVAL_SECONDS,
    env.GATEWAY_RECONCILE_INTERVAL_SECONDS,
    env.NOTIFICATION_WORKER_INTERVAL_SECONDS,
    env.BILLING_RECONCILE_INTERVAL_SECONDS,
  );
  const freshSince = new Date(Date.now() - (maximumIntervalSeconds * 2 + 60) * 1000);
  try {
    const [, storage, workers] = await Promise.all([
      prisma.$queryRaw`SELECT 1`,
      objectStorage.health(),
      prisma.workerHealth.count({
        where: {
          name: { in: expectedWorkers },
          status: 'HEALTHY',
          lastSuccessAt: { gte: freshSince },
        },
      }),
    ]);
    if (!storage || workers !== expectedWorkers.length) throw new Error('Critical dependency unavailable');
    response.json({
      status: 'ready',
      service: 'vigioni-api',
      timestamp: new Date().toISOString(),
      dependencies: { database: 'ready', objectStorage: 'ready', workers: 'ready' },
    });
  } catch {
    response.status(503).json({
      status: 'unavailable',
      service: 'vigioni-api',
      timestamp: new Date().toISOString(),
    });
  }
});
