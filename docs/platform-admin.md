# Administração da plataforma

O contexto `/platform` usa a mesma autenticação segura do cliente, mas uma autorização global independente: `User.platformRole = PLATFORM_ADMIN`. Roles tenant, inclusive `OWNER`, nunca concedem acesso global. Toda API fica em `/api/v1/platform` e revalida a role no banco a cada request.

O Master é somente leitura nesta etapa. Ele expõe organizações, usuários, planos, assinaturas, entitlements configurados, status de câmeras/gateways, accounting de storage, metadados de eventos/alertas, saúde de entregas, auditoria e system health. Não oferece alteração de plano/status, ACK global, exclusão, impersonation ou comandos de gateway.

Após o Prompt 16, o Master também possui visões somente leitura de pagamentos e faturas, sem dados completos de cartão, payloads de provider ou ações de refund.

## Bootstrap

O primeiro administrador deve ser um usuário já existente. Execute uma única vez em ambiente administrativo:

```text
npm run platform-admin -- grant admin@example.com "motivo operacional documentado"
```

Revogação usa `revoke` e impede remover o último administrador ativo. O script não recebe senha e cria `PlatformAuditLog`. Não existe cadastro público nem promoção automática por variável de ambiente.

## Matriz

| Operação                               | Tenant OWNER |             PLATFORM_ADMIN |
| -------------------------------------- | -----------: | -------------------------: |
| Ver própria organização                |          Sim |  Pela sessão tenant normal |
| Ver metadados de todas organizações    |          Não |                        Sim |
| Ver câmeras/gateways globais           |          Não | Status e metadados somente |
| Ver live/snapshot/recording de cliente |          Não |                        Não |
| Ver credenciais/secrets                |          Não |                        Não |
| Ver system health detalhado            |          Não |                        Sim |
| Alterar assinatura/plano               |          Não |            Não nesta etapa |

## Privacidade e segurança

Platform Admin não recebe automaticamente acesso à mídia de clientes. DTOs não incluem credenciais de câmera, URL RTSP, gateway secret, tokens, conteúdo pessoal de notificações, object keys ou VAPID privado. Eventos exibem somente campos conhecidos de operação. Auditoria não possui endpoints de edição ou exclusão.

MFA para administradores, observabilidade centralizada, shared Pub/Sub e controles avançados ficam como requisitos críticos do Prompt 17. O Master usa polling sob demanda nesta fase; não assina todos os eventos tenant.
