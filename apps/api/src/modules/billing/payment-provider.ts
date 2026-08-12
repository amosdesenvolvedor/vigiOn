export type CheckoutRequest = {
  reference: string;
  title: string;
  amountCents: number;
  currency: string;
  payerEmail: string;
  idempotencyKey: string;
};
export type CheckoutResult = { providerCheckoutId: string; checkoutUrl: string; expiresAt: Date };
export type ProviderPayment = {
  id: string;
  externalReference: string | null;
  status: 'PENDING' | 'AUTHORIZED' | 'PAID' | 'FAILED' | 'CANCELED' | 'REFUNDED' | 'EXPIRED';
  amountCents: number;
  currency: string;
  method: 'PIX' | 'CARD' | 'BOLETO' | 'UNKNOWN';
  paidAt: Date | null;
};

export interface PaymentProvider {
  readonly available: boolean;
  createCheckout(input: CheckoutRequest): Promise<CheckoutResult>;
  getPayment(id: string): Promise<ProviderPayment>;
  verifyWebhook(input: {
    signature: string | undefined;
    requestId: string | undefined;
    dataId: string;
  }): boolean;
}
