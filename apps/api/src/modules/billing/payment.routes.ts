import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import type Stripe from 'stripe';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate, requirePermission } from '../auth/auth.middleware';
import { AuthError } from '../auth/auth.errors';
import { StripeBillingService } from './stripe.service';
import { stripeProvider } from './stripe.provider';

export const paymentRouter = Router();
export const stripeWebhookRouter = Router();
export const stripeBillingService = new StripeBillingService(prisma, stripeProvider);
const mutations = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});
const planSchema = z.object({ plan: z.enum(['BASIC', 'PRO', 'BUSINESS']) }).strict();

paymentRouter.use(authenticate);
paymentRouter.get('/configuration', (_req, res) => res.json(stripeBillingService.configuration()));
paymentRouter.get('/history', async (req, res, next) => {
  try {
    res.json(await stripeBillingService.history(req.auth!.organizationId));
  } catch (e) {
    next(e);
  }
});
paymentRouter.post(
  '/checkout',
  mutations,
  requirePermission('plan:manage'),
  async (req, res, next) => {
    try {
      const input = planSchema.parse(req.body);
      const key = z.string().uuid().parse(req.get('idempotency-key'));
      const checkout = await stripeBillingService.checkout(req.auth!, input.plan, key);
      res.status(201).json({
        checkout: { id: checkout.id, url: checkout.checkoutUrl, expiresAt: checkout.expiresAt },
      });
    } catch (e) {
      next(e);
    }
  },
);
paymentRouter.post(
  '/portal',
  mutations,
  requirePermission('plan:manage'),
  async (req, res, next) => {
    try {
      const portal = await stripeBillingService.portal(req.auth!);
      res.json({ url: portal.url });
    } catch (e) {
      next(e);
    }
  },
);
paymentRouter.post(
  '/cancel',
  mutations,
  requirePermission('plan:manage'),
  async (req, res, next) => {
    try {
      const subscription = await stripeBillingService.cancel(req.auth!);
      res.json({ subscription });
    } catch (e) {
      next(e);
    }
  },
);
paymentRouter.post(
  '/change-plan',
  mutations,
  requirePermission('plan:manage'),
  async (req, res, next) => {
    try {
      res.json(await stripeBillingService.change(req.auth!, planSchema.parse(req.body).plan));
    } catch (e) {
      next(e);
    }
  },
);

stripeWebhookRouter.post('/stripe', async (req, res, next) => {
  let event: Stripe.Event;
  try {
    if (!Buffer.isBuffer(req.body))
      throw new AuthError(400, 'RAW_BODY_REQUIRED', 'Raw body required');
    const signature = req.get('stripe-signature');
    if (!signature)
      throw new AuthError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Invalid webhook signature');
    event = stripeProvider.webhook(req.body, signature);
    console.info(
      JSON.stringify({
        event: 'stripe.webhook.received',
        stripeEventId: event.id,
        type: event.type,
      }),
    );
  } catch (e) {
    next(
      e instanceof AuthError
        ? e
        : new AuthError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Invalid webhook signature'),
    );
    return;
  }
  try {
    await stripeBillingService.webhook(event);
    res.json({ received: true });
  } catch (e) {
    console.error(
      JSON.stringify({
        event: 'stripe.webhook.processing_failed',
        stripeEventId: event.id,
        type: event.type,
      }),
    );
    next(e);
  }
});
