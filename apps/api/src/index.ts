import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';
import { StreamSessionService } from './modules/streams/stream-session.service';
import { mediaService } from './modules/media/media.routes';

const server = createServer(createApp());
const streamService = new StreamSessionService(prisma);
const streamCleanup = setInterval(() => {
  void streamService.cleanup().catch((error: unknown) =>
    console.error(
      JSON.stringify({
        event: 'stream.cleanup_failed',
        errorCode: error instanceof Error ? error.name : 'UNKNOWN',
      }),
    ),
  );
}, 30_000);
streamCleanup.unref();
const retentionWorker = setInterval(() => {
  void mediaService
    .retentionBatch()
    .catch(() => console.error(JSON.stringify({ event: 'retention.worker_failed' })));
}, env.RETENTION_INTERVAL_SECONDS * 1000);
retentionWorker.unref();

server.listen(env.API_PORT, env.API_HOST, () => {
  console.log(`VigiOn API listening on http://${env.API_HOST}:${env.API_PORT}`);
});

const shutdown = async (signal: string) => {
  clearInterval(streamCleanup);
  clearInterval(retentionWorker);
  console.log(`${signal} received; shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
