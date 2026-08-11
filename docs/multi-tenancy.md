# Multi-tenancy

O tenant do VigiOn é a `Organization`. Todo recurso operacional contém `organizationId`, e relações compostas entre câmeras, eventos, arquivos e notificações impedem associações cruzadas também no banco.

## Membership e contexto ativo

`OrganizationMembership` é a fonte de autorização entre `User` e `Organization`. A combinação `(userId, organizationId)` é única e contém role (`OWNER`, `ADMIN`, `OPERATOR`, `VIEWER`) e status (`INVITED`, `ACTIVE`, `SUSPENDED`, `REMOVED`). Os campos legados de organização e role em `User` permanecem temporariamente para compatibilidade da migração, mas não autorizam requisições.

O access token identifica usuário, sessão, organização e membership ativos. Em toda requisição autenticada o backend consulta novamente sessão, usuário e membership; portanto role removida, membership suspensa ou sessão revogada têm efeito imediato. O contexto central disponibiliza `userId`, `organizationId`, `membershipId` e `role`.

`GET /api/v1/organizations` lista apenas memberships autorizadas. `POST /api/v1/organizations/:id/switch` exige membership ativa no destino, atualiza o tenant da sessão e emite novo access token. IDs, bodies ou headers fornecidos pelo cliente nunca selecionam um tenant sem essa validação.

## Organização e configurações

O perfil base mantém nome, slug, status e timezone IANA na organização. Preferências extensíveis ficam em `OrganizationSettings`: nome comercial, contato, país, idioma, monitoramento e notificações. Horários futuros devem ser interpretados no timezone IANA do tenant, nunca no timezone do servidor.

Organizações podem estar `ACTIVE`, `SUSPENDED` ou `CANCELED`. Suspensão preserva dados e bloqueia operações tenant-scoped. A reativação nesta etapa é uma ação explícita de OWNER; a futura central administrativa terá identidade e autorização separadas em `PlatformUser`.

## Convites e membros

OWNER e ADMIN podem convidar. ADMIN só atribui OPERATOR ou VIEWER; apenas OWNER gerencia ADMIN/OWNER. Convites usam 48 bytes aleatórios, guardam somente SHA-256, expiram em 72 horas e podem ser reenviados (rotacionando o token) ou cancelados. O aceite exige usuário autenticado com o mesmo e-mail, convite pendente e não expirado.

Não é permitido alterar a própria role pelos endpoints comuns. Remoção, suspensão ou rebaixamento do último OWNER é bloqueado. Remover membership revoga as sessões daquele usuário no tenant.

## Isolamento e auditoria

Consultas a recursos usam `TenantRepository`/`tenantWhere` ou filtros explícitos combinando ID do recurso com `organizationId` do contexto. Recursos de outro tenant retornam ausência, evitando também enumeração. Memberships, convites, organizações e logs seguem o mesmo padrão.

Alterações relevantes criam `AuditLog` com ator, tenant, entidade, ação, IP e user-agent. Tokens, hashes e segredos nunca são registrados. Os testes cobrem isolamento de câmeras, eventos, arquivos, assinaturas, logs e memberships, convite aceito/expirado/cancelado, escalada para OWNER, alteração cross-tenant, suspensão e proteção de OWNER.
