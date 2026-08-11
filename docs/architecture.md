# Arquitetura inicial

## Contexto e objetivos

O VigiOn será um SaaS de monitoramento multi-tenant. A fundação privilegia limites claros entre interface, API, domínio futuro e persistência, permitindo evolução incremental sem transformar o Prompt 01 em uma implementação fictícia do produto.

## Visão de componentes

```text
Browser ──HTTPS/JSON──> Web (React)
   │                       │
   └──────────────> API Express (`/api/v1`)
                            │
                       Prisma ORM
                            │
                         MariaDB
```

WebSockets, workers, storage de objetos, filas e canais externos são extensões planejadas, não componentes implementados nesta etapa.

## Decisões

### Monorepo com npm workspaces

Mantém aplicações implantáveis separadamente e permite compartilhar contratos pequenos sem duplicação. Um gerenciador adicional de monorepo não é necessário neste momento.

### API modular e versionada

Rotas, configuração, infraestrutura e middleware têm pastas próprias. Novos módulos deverão concentrar controladores, serviços, repositórios e validações por domínio. A rota de health verifica processo e conectividade real com o banco; retorna 503 quando o banco não responde.

### Multi-tenancy

O modelo inicial previsto é banco compartilhado com chave `organizationId` nas entidades pertencentes ao tenant. No Prompt 02, chaves, índices e relações serão modelados. No Prompt 04, o contexto autenticado de organização e filtros obrigatórios serão aplicados na camada de acesso a dados. Consultas de tenant nunca deverão aceitar um `organizationId` arbitrário fornecido pelo cliente.

O Prompt 02 introduziu as entidades, migration inicial e Prisma Client. Relações compostas reforçam no banco que registros relacionados pertencem ao mesmo tenant; a camada de repositório acrescenta o escopo derivado do contexto autenticado.

### Segurança desde a fundação

- configuração validada no boot e segredos somente por ambiente;
- Helmet, CORS explícito e limite de payload;
- respostas de erro sem vazamento de detalhes internos;
- execução do container da API como usuário sem privilégios;
- futura autenticação, refresh token, RBAC, rate limiting e auditoria entram em suas etapas próprias.

### Realtime e processamento assíncrono

A API HTTP não incorpora uma implementação fictícia. Eventos de domínio serão definidos antes da adoção de WebSockets e poderão alimentar adaptadores de realtime, notificações e workers sem acoplamento direto aos controladores.

## Ambientes e implantação

Em desenvolvimento, npm executa Vite e API em watch mode, enquanto Compose pode subir apenas o banco. Na composição completa, o frontend é um build estático servido pelo nginx e a API roda o JavaScript compilado. Em produção, segredos devem vir do provedor de implantação e TLS deve terminar em proxy ou load balancer.

## Convenções para as próximas etapas

- TypeScript estrito; evitar `any`.
- Validar entradas nos limites HTTP.
- Lógica de negócio em serviços, não em componentes ou controllers.
- Toda consulta de dado pertencente a cliente deve carregar contexto de tenant.
- Migrations são imutáveis após aplicadas em ambientes compartilhados.
- Integrações externas são adaptadores atrás de interfaces.

## Fora do escopo do Prompt 01

Entidades, migrations, autenticação, autorização, cadastro de câmeras, streaming, IA, pagamentos, armazenamento, WebSockets e notificações. A ausência é deliberada e evita contratos prematuros antes das etapas correspondentes.
