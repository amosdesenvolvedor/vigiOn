import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { prisma } from './lib/prisma';

const server = createServer(createApp());

server.listen(env.API_PORT, env.API_HOST, () => {
  console.log(`VigiOn API listening on http://${env.API_HOST}:${env.API_PORT}`);
});

const shutdown = async (signal: string) => {
  console.log(`${signal} received; shutting down`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
