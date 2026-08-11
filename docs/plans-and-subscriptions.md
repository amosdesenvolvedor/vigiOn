# Planos, assinaturas e limites

## Planos e versões

FREE, BASIC, PRO e BUSINESS são registros reais de `Plan`. Preço, moeda, período, trial, limites e features são dados configuráveis, não condicionais espalhadas no código. `code` identifica a família comercial e `version` identifica uma configuração imutável; uma alteração material deve criar uma nova linha/versão e um novo slug. Assinaturas existentes continuam apontando para a versão contratada.

O seed fornece valores iniciais editáveis para `maxCameras`, `maxStorageBytes`, `retentionDays`, `maxUsers`, `trialDays` e `enabledFeatures`. FREE é permanente e distinto de trial. Trials utilizam `TRIALING`, `trialEndsAt` e o plano pago experimentado.

## Assinaturas e histórico

Estados: `TRIALING` (teste em andamento), `ACTIVE` (vigente), `PAST_DUE` (pendência futura de pagamento), `CANCELED` (cancelada, mas válida até o fim do período), `EXPIRED` (encerrada) e `SUSPENDED` (bloqueada administrativamente).

Cada mudança cria `SubscriptionHistory` com plano/versão, status, período, motivo e snapshots dos limites/features. Assim, mudanças futuras no catálogo não reescrevem o histórico. Cancelamento usa `cancelAtPeriodEnd`; reativação é permitida antes de `currentPeriodEnd`.

Ao consultar uma trial expirada, o backend encerra a assinatura e cria uma assinatura FREE sem apagar câmeras, arquivos, eventos, usuários ou a organização. Recursos acima dos novos limites permanecem, mas novas reservas são bloqueadas.

## Entitlements e concorrência

`EntitlementService` centraliza `hasFeature`, limites e consumo. Não existem regras do tipo `plan === PRO` em controllers. Bloqueios retornam `PLAN_LIMIT_REACHED`, recurso, consumo, limite e `upgradeRequired`.

`ResourceCounter` reserva vagas de câmera e usuário por atualização atômica condicional. Duas operações concorrentes não conseguem consumir a mesma última vaga. Convites reservam vaga, cancelamentos e remoções liberam a reserva.

Storage usa `usedBytes` e `reservedBytes`. A reserva ocorre em transação com lock da linha; depois é confirmada ou liberada. `reconcileStorage` recalcula consumo e quantidade diretamente de `StorageFile`, permitindo corrigir divergências. A retenção fica no plano para workers futuros, sem executar remoção nesta etapa.

`LimitEvent` prepara alertas internos de 80%, 90%, 100%, limite atingido e eventos futuros de trial/expiração para o módulo de notificações.

## APIs

- `GET /api/v1/plans`
- `GET /api/v1/subscription`
- `GET /api/v1/subscription/usage`
- `GET /api/v1/subscription/features`
- `GET /api/v1/subscription/history`
- `POST /api/v1/subscription/cancel`
- `POST /api/v1/subscription/reactivate`

Não há checkout, gateway, simulação de pagamento ou mudança arbitrária de plano nesta etapa.
