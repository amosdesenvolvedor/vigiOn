import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

type Level = 'info' | 'warn' | 'error';
const write = (level: Level, event: string, fields: Record<string, unknown> = {}) => {
  const entry = JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields });
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(entry);
};

export const logger = {
  info: (event: string, fields?: Record<string, unknown>) => write('info', event, fields),
  warn: (event: string, fields?: Record<string, unknown>) => write('warn', event, fields),
  error: (event: string, fields?: Record<string, unknown>) => write('error', event, fields),
};

export const requestContext: RequestHandler = (request, response, next) => {
  const supplied = request.get('x-request-id');
  const requestId = supplied && /^[A-Za-z0-9._-]{8,100}$/.test(supplied) ? supplied : randomUUID();
  response.locals.requestId = requestId;
  response.setHeader('x-request-id', requestId);
  const started = Date.now();
  response.on('finish', () => logger.info('http.request', {
    requestId, method: request.method, path: request.path, statusCode: response.statusCode,
    durationMs: Date.now() - started, userId: request.auth?.userId,
    organizationId: request.auth?.organizationId,
  }));
  next();
};
