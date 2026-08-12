import { createHmac } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/env', () => ({
  env: {
    BILLING_ENABLED: true,
    BILLING_ENVIRONMENT: 'test',
    MERCADO_PAGO_ACCESS_TOKEN: 'TEST-token-long-enough',
    MERCADO_PAGO_WEBHOOK_SECRET: 'webhook-secret-long-enough',
    BILLING_SUCCESS_URL: 'https://vigion.test/billing?result=success',
    BILLING_CANCEL_URL: 'https://vigion.test/billing?result=cancel',
    BILLING_PENDING_URL: 'https://vigion.test/billing?result=pending',
    APP_URL: 'https://vigion.test',
  },
}));

let MercadoPagoProvider: typeof import('./mercado-pago.provider').MercadoPagoProvider;
beforeAll(async () => {
  ({ MercadoPagoProvider } = await import('./mercado-pago.provider'));
});

describe('Mercado Pago webhook security', () => {
  it('accepts the documented HMAC manifest and rejects forged signatures', () => {
    const provider = new MercadoPagoProvider();
    const ts = '1704908010';
    const dataId = '123';
    const requestId = 'request-1';
    const digest = createHmac('sha256', 'webhook-secret-long-enough')
      .update(`id:${dataId};request-id:${requestId};ts:${ts};`)
      .digest('hex');
    expect(provider.verifyWebhook({ signature: `ts=${ts},v1=${digest}`, requestId, dataId })).toBe(
      true,
    );
    expect(
      provider.verifyWebhook({ signature: `ts=${ts},v1=${'0'.repeat(64)}`, requestId, dataId }),
    ).toBe(false);
    expect(provider.verifyWebhook({ signature: undefined, requestId, dataId })).toBe(false);
  });
});
