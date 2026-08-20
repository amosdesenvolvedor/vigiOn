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
import { streamMediaRouter, streamRouter } from './modules/streams/stream.routes';
import { mediaRouter, mediaUploadRouter } from './modules/media/media.routes';
import { eventRouter, gatewayEventRouter } from './modules/events/event.routes';
import {
  alertRouter,
  notificationRouter,
  preferenceRouter,
  pushRouter,
} from './modules/notifications/notification.routes';
import { intelligenceRouter } from './modules/intelligence/intelligence.routes';
import { realtimeRouter } from './modules/realtime/realtime.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { platformRouter } from './modules/platform/platform.routes';
import { stripeWebhookRouter, paymentRouter } from './modules/billing/payment.routes';
import { requestContext } from './lib/logger';
import { cameraCatalogRouter } from './modules/camera-catalog/camera-catalog.routes';
import { cameraOnboardingRouter } from './modules/camera-onboarding/qr-analysis.routes';
import {
  discoveryRouter,
  gatewayDiscoveryRouter,
} from './modules/camera-onboarding/discovery.routes';
import {
  gatewayVerificationRouter,
  verificationRouter,
} from './modules/camera-onboarding/verification.routes';
import { completionRouter } from './modules/camera-onboarding/completion.routes';
import { gatewayCameraHealthRouter } from './modules/camera-health/camera-health.routes';
import { aiSupportRouter } from './modules/ai-support/ai-support.routes';

export const createApp = () => {
  const app = express();

  app.disable('x-powered-by');
  if (env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(helmet());
  app.use(
    cors({
      origin: [env.WEB_ORIGIN],
      credentials: true,
      methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['authorization', 'content-type', 'x-request-id'],
    }),
  );
  app.use(requestContext);
  app.use(
    '/api/v1/webhooks',
    express.raw({ type: 'application/json', limit: '256kb' }),
    stripeWebhookRouter,
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.get('/', (_request, response) => response.json({ service: 'vigioni-api' }));
  app.use('/api/v1/health', healthRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/organizations', organizationRouter);
  app.use('/api/v1/plans', plansRouter);
  app.use('/api/v1/subscription', subscriptionRouter);
  app.use('/api/v1/billing', paymentRouter);
  app.use('/api/v1/cameras', cameraRouter);
  app.use('/api/v1/camera-catalog', cameraCatalogRouter);
  app.use('/api/v1/camera-onboarding/discovery', discoveryRouter);
  app.use('/api/v1/camera-onboarding/verification', verificationRouter);
  app.use('/api/v1/camera-onboarding/complete', completionRouter);
  app.use('/api/v1/camera-onboarding', cameraOnboardingRouter);
  app.use('/api/v1/gateways', gatewayRouter);
  app.use('/api/v1/gateway-agent/stream-media', streamMediaRouter);
  app.use('/api/v1/gateway-agent/media-assets', mediaUploadRouter);
  app.use('/api/v1/gateway-agent/events', gatewayEventRouter);
  app.use('/api/v1/gateway-agent/discovery', gatewayDiscoveryRouter);
  app.use('/api/v1/gateway-agent/verification', gatewayVerificationRouter);
  app.use('/api/v1/gateway-agent/camera-health', gatewayCameraHealthRouter);
  app.use('/api/v1/gateway-agent', gatewayAgentRouter);
  app.use('/api/v1/events', eventRouter);
  app.use('/api/v1/alerts', alertRouter);
  app.use('/api/v1/notifications', notificationRouter);
  app.use('/api/v1/notification-preferences', preferenceRouter);
  app.use('/api/v1/push', pushRouter);
  app.use('/api/v1/intelligence', intelligenceRouter);
  app.use('/api/v1/realtime', realtimeRouter);
  app.use('/api/v1/dashboard', dashboardRouter);
  app.use('/api/v1/ai-support', aiSupportRouter);
  app.use('/api/v1/platform', platformRouter);
  app.use('/api/v1', streamRouter);
  app.use('/api/v1', mediaRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
