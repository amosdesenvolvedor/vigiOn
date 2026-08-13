# Integração Stripe

Stripe é o provider financeiro oficial. O VigiOn permanece como autoridade sobre `Plan`, `Subscription` e `EntitlementService`; o Stripe controla checkout, cobrança recorrente, invoices e estado financeiro.

## Configuração

Configure apenas no backend: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_PRO` e `STRIPE_PRICE_BUSINESS`. `STRIPE_PUBLISHABLE_KEY` está preparada, mas Checkout hospedado não precisa dela no frontend. `BILLING_ENABLED=false` mantém toda cobrança bloqueada.

O catálogo interno é FREE R$0 (1 câmera/1 dia), BASIC R$29,90 (3/7), PRO R$59,90 (8/15) e BUSINESS R$119,90 (20/30). Price IDs variam por ambiente e nunca vêm do cliente.

## Fluxos

- `POST /api/v1/billing/checkout`: OWNER envia somente `plan`; backend encontra/cria e reutiliza Customer, resolve Price ID e cria Checkout Session `subscription`.
- `POST /api/v1/billing/portal`: cria Customer Portal para a organização autenticada.
- `POST /api/v1/billing/cancel`: agenda `cancel_at_period_end`.
- `POST /api/v1/billing/change-plan`: altera o item da assinatura existente; Stripe calcula proration em upgrade e downgrade usa política conservadora sem proration imediata.
- `POST /api/v1/webhooks/stripe`: recebe raw body e valida `Stripe-Signature` antes de persistir/processar.

Eventos tratados: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid` e `invoice.payment_failed`. `(provider, providerEventId)` garante idempotência. Redirect de success nunca ativa plano.

O término/falha não apaga câmeras, usuários ou mídia. Status pago deixa de conceder entitlements; recursos existentes são preservados e novas criações acima do limite ficam bloqueadas.

## Teste local e sandbox

Use exclusivamente `sk_test_`, `pk_test_` e Price IDs de test mode. Com Stripe CLI:

```text
stripe listen --forward-to localhost:3000/api/v1/webhooks/stripe
```

Copie o `whsec_...` temporário para `STRIPE_WEBHOOK_SECRET`, configure produtos/Prices mensais e habilite billing. Use cartões de teste oficiais. Para produção, troque somente variáveis por valores live, configure `https://vigion.cloud/api/v1/webhooks/stripe` e faça nova homologação; nenhuma mudança de código é necessária.
