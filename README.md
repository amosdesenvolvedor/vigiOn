# VigiOn

Fundação de uma plataforma SaaS multi-tenant para monitoramento de câmeras IP/Wi-Fi, eventos, mídia em nuvem e notificações. Este repositório corresponde ao **Prompt 01/18**: infraestrutura e aplicações mínimas executáveis, sem antecipar regras de domínio.

## Stack e arquitetura

- Monorepo npm workspaces, TypeScript estrito e contratos compartilhados
- React 18, Vite 5 e Tailwind CSS 3 no frontend
- Node.js 18, Express 4, Zod e Prisma 6 na API
- MariaDB 11.4, Docker Compose e imagens de produção multi-stage
- API versionada em `/api/v1`; health check em `/api/v1/health`

O frontend e a API são processos independentes. O pacote `@vigioni/shared` mantém somente contratos sem lógica de negócio. O Prisma fica na raiz para centralizar schema e migrations. O isolamento multi-tenant será implementado com entidades e políticas no Prompt 02/04; ele não é simulado nesta etapa.

## Requisitos

- Node.js 18.18+ e npm 9+
- Docker Engine e Docker Compose (para o banco ou stack completa)

## Instalação e desenvolvimento

```bash
cp .env.example .env
npm install
docker compose up -d db
npm run dev
```

- Frontend: http://localhost:5173
- API: http://localhost:3000
- Health: http://localhost:3000/api/v1/health

Também é possível iniciar separadamente com `npm run dev:web` e `npm run dev:api`.

## Docker

```bash
cp .env.example .env
docker compose up --build
```

O Compose inicia MariaDB, API e frontend. As credenciais presentes no exemplo são apenas defaults locais; substitua-as em qualquer ambiente compartilhado ou produtivo.

## Variáveis de ambiente

| Variável                | Uso                                  |
| ----------------------- | ------------------------------------ |
| `NODE_ENV`              | Ambiente da API                      |
| `API_HOST` / `API_PORT` | Bind da API                          |
| `WEB_ORIGIN`            | Origem autorizada pelo CORS          |
| `VITE_API_URL`          | URL pública consumida pelo frontend  |
| `DATABASE_URL`          | Conexão Prisma com MySQL/MariaDB     |
| `MYSQL_*`               | Inicialização do container MariaDB   |
| `JWT_ACCESS_SECRET`     | Assinatura dos access tokens         |
| `*_TTL_*`               | Expiração de tokens e sessões        |
| `APP_URL`               | URL pública usada em links de e-mail |
| `EMAIL_FROM`            | Remetente verificado                 |
| `RESEND_API_KEY`        | Credencial do provedor de e-mail     |

## Estrutura

```text
apps/api/          API Express
apps/web/          aplicação React
packages/shared/   contratos TypeScript compartilhados
prisma/            schema e futuras migrations
docker/            Dockerfiles e configuração nginx
docs/              decisões arquiteturais
```

## Qualidade

```bash
npm run typecheck
npm run lint
npm run build
npm run format:check
npm run prisma:validate
```

Para preparar o banco, gerar o client e carregar os planos de desenvolvimento:

```bash
npm run prisma:generate
npm run prisma:migrate
npm run prisma:seed
```

As entidades e a estratégia de isolamento estão detalhadas em [docs/database.md](docs/database.md).

## Autenticação

O backend oferece cadastro, login, refresh rotativo, logout, sessões, recuperação de senha, verificação de e-mail e autorização por função. Gere um segredo local antes de iniciar:

```bash
openssl rand -base64 48
```

Copie o resultado para `JWT_ACCESS_SECRET` no `.env`. Consulte [docs/authentication.md](docs/authentication.md) para endpoints, cookies e decisões de segurança.

## Multi-tenancy

Organizações, memberships, troca segura de tenant, gestão de membros, convites e configurações estão implementados com autorização revalidada no banco. Consulte [docs/multi-tenancy.md](docs/multi-tenancy.md) para as regras de isolamento e segurança.

Em homologação/produção, o Compose inclui Caddy como proxy reverso, encaminha `/api/*` para a API e entrega o frontend no domínio com HTTPS automático. As portas internas `3000`, `5173` e `3306` ficam vinculadas apenas ao loopback da VM.

## Roadmap (18 etapas)

1. Fundação e inicialização (atual)
2. Banco, Prisma, entidades e migrations
3. Autenticação, usuários e acesso
4. Multi-tenancy e isolamento
5. Planos, limites e assinaturas
6. Câmeras
7. Gateway seguro de dispositivos
8. Streaming
9. Storage e retenção
10. Eventos e regras
11. Notificações e realtime
12. Dashboard do cliente
13. Central administrativa
14. WebSockets e sincronização
15. Segurança, auditoria e observabilidade
16. Auditoria geral
17. Testes e estabilização
18. Produção, documentação e deploy

Consulte [docs/architecture.md](docs/architecture.md) para decisões e limites desta fundação.
