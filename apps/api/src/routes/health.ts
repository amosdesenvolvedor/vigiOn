import { Router } from 'express';
import type { HealthResponse } from '@vigioni/shared';
import { prisma } from '../lib/prisma';

export const healthRouter = Router();

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
  try {
    await prisma.$queryRaw`SELECT 1`;
    response.json({ status: 'ready', service: 'vigioni-api', timestamp: new Date().toISOString() });
  } catch {
    response.status(503).json({ status: 'unavailable', service: 'vigioni-api', timestamp: new Date().toISOString() });
  }
});
