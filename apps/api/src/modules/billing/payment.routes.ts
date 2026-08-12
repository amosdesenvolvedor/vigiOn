import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { authenticate, requirePermission } from '../auth/auth.middleware';
import type { RequestMetadata } from '../auth/auth.types';
import { AuthError } from '../auth/auth.errors';
import { BillingPaymentService } from './billing-payment.service';
import { paymentProvider } from './mercado-pago.provider';

export const paymentRouter = Router();
export const billingWebhookRouter = Router();
export const billingPaymentService = new BillingPaymentService(prisma, paymentProvider);
const mutationLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});
const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
const checkoutSchema = z.object({ planId: z.string().uuid() }).strict();
const metadata = (request: Request): RequestMetadata => ({
  ...(request.ip ? { ipAddress: request.ip } : {}),
  ...(request.get('user-agent') ? { userAgent: request.get('user-agent')!.slice(0, 512) } : {}),
});

paymentRouter.use(authenticate);
paymentRouter.get('/configuration', (_req, res) => res.json(billingPaymentService.configuration()));
paymentRouter.get('/history', async (req, res, next) => {
  try {
    const query = pageSchema.parse(req.query);
    res.json(
      await billingPaymentService.history(req.auth!.organizationId, query.page, query.limit),
    );
  } catch (error) {
    next(error);
  }
});
paymentRouter.get('/checkout/:id', async (req, res, next) => {
  try {
    const session = await billingPaymentService.checkoutStatus(
      req.auth!.organizationId,
      z.string().uuid().parse(req.params.id),
    );
    if (!session) throw new AuthError(404, 'CHECKOUT_NOT_FOUND', 'Checkout not found');
    res.json({ checkout: session });
  } catch (error) {
    next(error);
  }
});
paymentRouter.post(
  '/checkout',
  mutationLimit,
  requirePermission('plan:manage'),
  async (req, res, next) => {
    try {
      const key = z.string().uuid().parse(req.get('idempotency-key'));
      const input = checkoutSchema.parse(req.body);
      const checkout = await billingPaymentService.checkout(
        req.auth!,
        input.planId,
        key,
        metadata(req),
      );
      res.status(201).json({
        checkout: {
          id: checkout.id,
          status: checkout.status,
          checkoutUrl: checkout.checkoutUrl,
          expiresAt: checkout.expiresAt,
          amountCents: checkout.amountCents,
          currency: checkout.currency,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

const webhookSchema = z
  .object({
    id: z.union([z.string(), z.number()]),
    type: z.string().max(100),
    data: z.object({ id: z.union([z.string(), z.number()]) }),
  })
  .passthrough();
billingWebhookRouter.post('/mercado-pago', async (req, res, next) => {
  try {
    const body = webhookSchema.parse(req.body);
    const dataId = String(body.data.id);
    if (
      !paymentProvider.verifyWebhook({
        signature: req.get('x-signature'),
        requestId: req.get('x-request-id'),
        dataId,
      })
    )
      throw new AuthError(401, 'INVALID_WEBHOOK_SIGNATURE', 'Invalid webhook signature');
    await billingPaymentService.receiveWebhook({
      eventId: String(body.id),
      type: body.type,
      resourceId: dataId,
    });
    res.status(200).json({ received: true });
  } catch (error) {
    next(error);
  }
});
