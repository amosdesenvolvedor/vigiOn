# Autenticação, sessões e autorização

## Estratégia

O VigiOn usa dois artefatos de sessão:

- access token JWT HS256 com validade curta (15 minutos por padrão), retornado no corpo e mantido somente em memória no frontend;
- refresh token opaco e aleatório, enviado em cookie `HttpOnly`, `SameSite=Strict`, `Secure` em produção e restrito a `/api/v1/auth`.

O banco armazena somente SHA-256 do refresh token, que tem alta entropia. Cada renovação cria uma nova sessão na mesma família e revoga o token anterior. Reutilizar um token rotacionado revoga toda a família. O middleware também consulta a sessão no banco, permitindo revogação imediata do access token antes de sua expiração.

## Cadastro e login

O cadastro valida nome, organização, e-mail normalizado, confirmação e senha forte. Uma transação cria Organization, User OWNER, StorageUsage e assinatura TRIAL do plano FREE. A senha usa Argon2id e nunca é serializada ou registrada.

Login inválido, conta inexistente e conta inativa usam a mesma resposta. Login válido atualiza `lastLoginAt`, cria sessão e registra auditoria.

## Recuperação e verificação

`OneTimeToken` guarda somente hash de tokens aleatórios, com tipo, expiração e `usedAt`. Solicitações de recuperação sempre respondem genericamente. Redefinir a senha revoga todas as sessões. Verificação de e-mail preenche `emailVerifiedAt`.

`TokenDelivery` mantém o serviço desacoplado do provedor. O adaptador atual envia recuperação e verificação pela API HTTPS do Resend usando `RESEND_API_KEY`; testes usam um adaptador capturável separado. O remetente vem de `EMAIL_FROM` e os links usam `APP_URL`.

## Contexto e multi-tenancy

O JWT contém apenas userId (`sub`), organizationId, role e sessionId. O middleware valida assinatura, claims, sessão, usuário e organização. Controllers nunca aceitam `organizationId` como autoridade: consultas usam o contexto autenticado e filtros compostos. Recursos de outro tenant devem ser tratados como não encontrados.

PlatformUser permanece separado de User. Nenhum papel `ADMIN` de tenant concede acesso administrativo global; a autenticação da central master será exposta somente quando essa superfície for implementada.

## Matriz inicial

| Capacidade                             | OWNER | ADMIN | OPERATOR | VIEWER |
| -------------------------------------- | ----- | ----- | -------- | ------ |
| Gerenciar usuários                     | Sim   | Sim   | Não      | Não    |
| Ver câmeras/eventos                    | Sim   | Sim   | Sim      | Sim    |
| Gerenciar câmeras/configuração/storage | Sim   | Sim   | Não      | Não    |
| Gerenciar incidentes                   | Sim   | Sim   | Sim      | Não    |
| Alterar plano                          | Sim   | Não   | Não      | Não    |

As verificações são centralizadas em `requirePermission` e `requireRole`.

## Endpoints

Todos usam o prefixo `/api/v1/auth`.

| Método | Caminho            | Proteção                    |
| ------ | ------------------ | --------------------------- |
| POST   | `/register`        | Público, rate limited       |
| POST   | `/login`           | Público, rate limited       |
| POST   | `/refresh`         | Cookie, rate limited        |
| POST   | `/logout`          | Access token                |
| POST   | `/logout-all`      | Access token                |
| POST   | `/forgot-password` | Público, resposta genérica  |
| POST   | `/reset-password`  | Token de uso único          |
| POST   | `/verify-email`    | Token de uso único          |
| POST   | `/change-password` | Access token                |
| GET    | `/me`              | Access token                |
| GET    | `/sessions`        | Access token                |
| DELETE | `/sessions/:id`    | Access token e proprietário |

## Auditoria

São registrados REGISTER, LOGIN_SUCCESS, LOGIN_FAILED, LOGOUT, LOGOUT_ALL, PASSWORD_RESET_REQUESTED, PASSWORD_RESET_COMPLETED, PASSWORD_CHANGED, EMAIL_VERIFIED e SESSION_REVOKED. Senhas e tokens nunca entram em metadata ou logs.

## Produção

- `JWT_ACCESS_SECRET` deve conter ao menos 32 caracteres aleatórios e vir do gerenciador de secrets.
- TLS é obrigatório para o cookie `Secure`.
- Homologações temporárias sem TLS podem usar `NODE_ENV=development`; essa configuração nunca deve ser usada para produção.
- `WEB_ORIGIN` deve apontar para a origem exata do frontend.
- Um proxy distribuído exigirá storage compartilhado para rate limiting; o limitador em memória atende apenas uma instância.
- O domínio do remetente deve permanecer verificado no Resend e a chave deve vir somente do ambiente.
