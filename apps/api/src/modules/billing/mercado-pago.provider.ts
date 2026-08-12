import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../../config/env';
import type {
  CheckoutRequest,
  CheckoutResult,
  PaymentProvider,
  ProviderPayment,
} from './payment-provider';

const api = 'https://api.mercadopago.com';
const paymentStatus = (status: string, detail?: string): ProviderPayment['status'] => {
  if (status === 'approved') return 'PAID';
  if (status === 'authorized') return 'AUTHORIZED';
  if (status === 'refunded' || status === 'charged_back') return 'REFUNDED';
  if (status === 'cancelled') return 'CANCELED';
  if (detail === 'expired') return 'EXPIRED';
  if (status === 'rejected') return 'FAILED';
  return 'PENDING';
};
const paymentMethod = (type?: string, id?: string): ProviderPayment['method'] => {
  if (id === 'pix') return 'PIX';
  if (type === 'credit_card' || type === 'debit_card') return 'CARD';
  if (type === 'ticket') return 'BOLETO';
  return 'UNKNOWN';
};

export class MercadoPagoProvider implements PaymentProvider {
  readonly available = Boolean(env.BILLING_ENABLED && env.MERCADO_PAGO_ACCESS_TOKEN);
  private async call(path: string, init?: RequestInit) {
    if (!env.MERCADO_PAGO_ACCESS_TOKEN) throw new Error('BILLING_PROVIDER_UNAVAILABLE');
    const response = await fetch(`${api}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${env.MERCADO_PAGO_ACCESS_TOKEN}`,
        'content-type': 'application/json',
        ...init?.headers,
      },
    });
    if (!response.ok) throw new Error(`MERCADO_PAGO_HTTP_${response.status}`);
    return response.json() as Promise<Record<string, unknown>>;
  }
  async createCheckout(input: CheckoutRequest): Promise<CheckoutResult> {
    const expiration = new Date(Date.now() + 30 * 60_000);
    const result = await this.call('/checkout/preferences', {
      method: 'POST',
      headers: { 'X-Idempotency-Key': input.idempotencyKey },
      body: JSON.stringify({
        items: [
          {
            id: input.reference,
            title: input.title,
            quantity: 1,
            currency_id: input.currency,
            unit_price: input.amountCents / 100,
          },
        ],
        payer: { email: input.payerEmail },
        external_reference: input.reference,
        back_urls: {
          success: env.BILLING_SUCCESS_URL,
          failure: env.BILLING_CANCEL_URL,
          pending: env.BILLING_PENDING_URL,
        },
        auto_return: 'approved',
        expires: true,
        expiration_date_to: expiration.toISOString(),
        notification_url: `${env.APP_URL.replace(/\/$/, '')}/api/v1/webhooks/mercado-pago`,
      }),
    });
    const id = String(result.id ?? '');
    const url = String(
      env.BILLING_ENVIRONMENT === 'test'
        ? (result.sandbox_init_point ?? result.init_point ?? '')
        : (result.init_point ?? ''),
    );
    if (!id || !url) throw new Error('MERCADO_PAGO_INVALID_CHECKOUT');
    return { providerCheckoutId: id, checkoutUrl: url, expiresAt: expiration };
  }
  async getPayment(id: string): Promise<ProviderPayment> {
    const result = await this.call(`/v1/payments/${encodeURIComponent(id)}`);
    const amount = Number(result.transaction_amount);
    if (!Number.isFinite(amount) || amount < 0) throw new Error('MERCADO_PAGO_INVALID_PAYMENT');
    return {
      id: String(result.id),
      externalReference:
        typeof result.external_reference === 'string' ? result.external_reference : null,
      status: paymentStatus(String(result.status), String(result.status_detail ?? '')),
      amountCents: Math.round(amount * 100),
      currency: String(result.currency_id ?? 'BRL'),
      method: paymentMethod(
        String(result.payment_type_id ?? ''),
        String(result.payment_method_id ?? ''),
      ),
      paidAt: typeof result.date_approved === 'string' ? new Date(result.date_approved) : null,
    };
  }
  verifyWebhook(input: {
    signature: string | undefined;
    requestId: string | undefined;
    dataId: string;
  }) {
    if (!env.MERCADO_PAGO_WEBHOOK_SECRET || !input.signature || !input.requestId) return false;
    const parts = Object.fromEntries(
      input.signature.split(',').map((part) => part.trim().split('=', 2)),
    );
    if (!parts.ts || !parts.v1) return false;
    const manifest = `id:${input.dataId};request-id:${input.requestId};ts:${parts.ts};`;
    const expected = createHmac('sha256', env.MERCADO_PAGO_WEBHOOK_SECRET)
      .update(manifest)
      .digest('hex');
    const supplied = parts.v1;
    return (
      expected.length === supplied.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
    );
  }
}

export const paymentProvider = new MercadoPagoProvider();
