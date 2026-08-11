import cors from 'cors';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { healthRouter } from './routes/health';
import { authRouter } from './modules/auth/auth.routes';
import { organizationRouter } from './modules/organizations/organization.routes';
import { plansRouter, subscriptionRouter } from './modules/billing/billing.routes';
import { cameraRouter } from './modules/cameras/camera.routes';
import { gatewayAgentRouter, gatewayRouter } from './modules/gateways/gateway.routes';

export const createApp = () => {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.get('/', (_request, response) => response.json({ service: 'vigioni-api' }));
  app.use('/api/v1/health', healthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/organizations', organizationRouter);
  app.use('/api/v1/plans', plansRouter);
  app.use('/api/v1/subscription', subscriptionRouter);
  app.use('/api/v1/cameras', cameraRouter);
  app.use('/api/v1/gateways', gatewayRouter);
  app.use('/api/v1/gateway-agent', gatewayAgentRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
