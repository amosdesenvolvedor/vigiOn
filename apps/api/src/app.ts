import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { healthRouter } from './routes/health';

export const createApp = () => {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.get('/', (_request, response) => response.json({ service: 'vigioni-api' }));
  app.use('/api/v1/health', healthRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
