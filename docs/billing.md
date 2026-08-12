# Billing e pagamentos

O VigiOn usa Mercado Pago como provider principal para o mercado brasileiro. A escolha prioriza Checkout Pro hospedado, Pix, cartão tokenizado, assinaturas e Webhooks assinados. O backend nunca recebe PAN/CVV e continua sendo a autoridade sobre plano, tenant e entitlements.

```text
OWNER -> VigiOn API -> Plan/preço persistido -> Mercado Pago Checkout Pro
                                                   |
Subscription <- Entitlements <- Payment <- Webhook assinado
```

## Segurança e modo operacional

Billing inicia desabilitado. `BILLING_ENABLED=true` só deve ser usado após configurar credenciais de teste, assinatura Webhook e preços comerciais reais. `BILLING_ENVIRONMENT=test` seleciona a URL sandbox retornada pelo provider. Produção financeira não é ativada pelo deploy.

Checkout deriva a organização da sessão, aceita apenas OWNER, ignora qualquer preço do cliente, exige `Idempotency-Key` UUID e utiliza URLs de retorno controladas. FREE, planos inativos e planos sem preço não geram cobrança. Redirect de sucesso nunca ativa uma assinatura.

O endpoint é `POST /api/v1/webhooks/mercado-pago`. Ele valida `x-signature` e `x-request-id` antes de persistir o identificador mínimo do evento. O pagamento é consultado novamente na API do Mercado Pago; valor, moeda e referência precisam coincidir com a sessão local. A constraint `(provider, providerEventId)` impede efeito duplicado.

Não persistimos payload bruto, QR base64, token do provider, dados completos de cartão ou segredo de Webhook. Pagamentos e faturas não possuem endpoints de alteração/exclusão.

## Modelos e ciclo

- `Plan`: preço em centavos, BRL e intervalo; versões preservam contratos futuros.
- `BillingCheckoutSession`: tentativa idempotente e expiração.
- `Payment`: estado financeiro normalizado e método não sensível.
- `Invoice`: cobrança interna imutável vinculada ao pagamento confirmado.
- `BillingWebhookEvent`: idempotência, processamento e erro categorizado.
- `SubscriptionHistory`: snapshot de plano, limites, features e período.

Pagamento confirmado cria a nova assinatura ACTIVE e só então atualiza os entitlements. Falha não apaga recursos. Trial vencido mantém a política existente de fallback para FREE. Cancelamento continua no fim do período. Upgrade pago é efetivado após confirmação; downgrade/proration e recorrência completa permanecem parciais até validação real do produto Assinaturas do Mercado Pago.

## Configuração Mercado Pago

1. Crie uma aplicação de teste no painel Mercado Pago.
2. Configure a URL HTTPS `https://vigion.cloud/api/v1/webhooks/mercado-pago` para eventos de pagamentos.
3. Copie access token de teste e secret de assinatura para o `.env` protegido da VM.
4. Defina preços reais em centavos nos planos pagos, criando nova versão se alterar contrato comercial.
5. Mantenha `BILLING_ENVIRONMENT=test` e valide Pix/cartão com usuários de teste.
6. Somente depois da homologação altere credenciais e ambiente, com aprovação explícita.

URLs de retorno são apenas UX: `success`, `cancel` e `pending`. A confirmação vem sempre do Webhook/verificação server-to-server.

## Testes

Os testes cobrem state machine, HMAC válido/forjado, preço vindo do banco, double click/idempotência, evento duplicado, pagamento único e isolamento de histórico/status entre tenants. Sandbox E2E exige credenciais externas e não pode ser declarado validado sem evidência do provider.
