import { prisma } from './prisma';
import { logger } from './logger';

export async function runWorker(name: string, task: () => Promise<unknown>) {
  const started = Date.now();
  await prisma.workerHealth.upsert({
    where: { name }, create: { name, status: 'RUNNING', lastStartedAt: new Date() },
    update: { status: 'RUNNING', lastStartedAt: new Date() },
  });
  try {
    await task();
    await prisma.workerHealth.update({ where: { name }, data: { status: 'HEALTHY', lastSuccessAt: new Date(), lastErrorCode: null, durationMs: Date.now() - started } });
  } catch (error) {
    const errorCode = error instanceof Error ? error.name.slice(0, 100) : 'UNKNOWN';
    await prisma.workerHealth.update({ where: { name }, data: { status: 'FAILED', lastFailureAt: new Date(), lastErrorCode: errorCode, durationMs: Date.now() - started } }).catch(() => undefined);
    logger.error('worker.failed', { worker: name, errorCode });
  }
}
