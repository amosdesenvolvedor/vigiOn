import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { StreamSessionService } from './modules/streams/stream-session.service';
import { mediaService } from './modules/media/media.routes';
import { eventService } from './modules/events/event.routes';
import { notificationService } from './modules/notifications/notification.routes';
import { realtimeService } from './modules/realtime/realtime.service';
import { stripeBillingService } from './modules/billing/payment.routes';
import { runWorker } from './lib/worker-health';
import { logger } from './lib/logger';

const server = createServer(createApp());
const streamService = new StreamSessionService(prisma);
const streamCleanup = setInterval(() => {
  void runWorker('stream-cleanup', () => streamService.cleanup());
}, 30_000);
streamCleanup.unref();
const retentionWorker = setInterval(() => {
  void runWorker('media-retention', () => mediaService.retentionBatch());
}, env.RETENTION_INTERVAL_SECONDS * 1000);
retentionWorker.unref();
const gatewayReconcileWorker = setInterval(() => {
  void runWorker('gateway-reconcile', () => eventService.reconcileOfflineGateways());
}, env.GATEWAY_RECONCILE_INTERVAL_SECONDS * 1000);
gatewayReconcileWorker.unref();
const notificationWorker = setInterval(() => {
  void runWorker('notification-dispatch', () => notificationService.dispatchBatch());
}, env.NOTIFICATION_WORKER_INTERVAL_SECONDS * 1000);
notificationWorker.unref();
const realtimeHeartbeat = setInterval(() => realtimeService.heartbeat(), 20_000);
realtimeHeartbeat.unref();
const billingReconcileWorker = setInterval(() => {
  void runWorker('billing-reconcile', () => stripeBillingService.reconcileExpiredCheckouts());
}, env.BILLING_RECONCILE_INTERVAL_SECONDS * 1000);
billingReconcileWorker.unref();

void runWorker('stream-cleanup', () => streamService.cleanup());
void runWorker('media-retention', () => mediaService.retentionBatch());
void runWorker('gateway-reconcile', () => eventService.reconcileOfflineGateways());
void runWorker('notification-dispatch', () => notificationService.dispatchBatch());
void runWorker('billing-reconcile', () => stripeBillingService.reconcileExpiredCheckouts());

server.listen(env.API_PORT, env.API_HOST, () => {
  logger.info('api.started', { host: env.API_HOST, port: env.API_PORT });
});

const shutdown = async (signal: string) => {
  clearInterval(streamCleanup);
  clearInterval(retentionWorker);
  clearInterval(gatewayReconcileWorker);
  clearInterval(notificationWorker);
  clearInterval(realtimeHeartbeat);
  clearInterval(billingReconcileWorker);
  logger.info('api.shutdown', { signal });
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
