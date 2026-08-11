# Câmeras

## Modelo e estados

Toda `Camera` pertence a uma única `Organization`; identificadores são únicos apenas dentro do tenant. Nome e protocolo são obrigatórios, enquanto descrição, localização, fabricante, modelo e identificador são opcionais.

O estado administrativo (`ACTIVE`/`DISABLED`) é separado da conectividade (`UNKNOWN`, `CONNECTING`, `ONLINE`, `OFFLINE`, `ERROR`). Uma câmera cadastrada começa ativa e com conectividade desconhecida; `lastSeenAt` permanece nulo. O sistema não simula conexão, status online ou vídeo.

Tipos de conexão: `WIFI`, `ETHERNET`, `OTHER`. Protocolos configuráveis: `RTSP`, `ONVIF`, `HTTP`, `HTTPS`, `OTHER`. Nesta etapa são apenas metadados, sem abertura de conexão.

## Credenciais

`CameraCredentialService` cifra um documento com usuário e senha usando AES-256-GCM, IV aleatório, tag de autenticação e AAD vinculada ao par organização/câmera. A chave de 32 bytes fica em `CAMERA_CREDENTIAL_KEY`, fora do banco. A descriptografia existe somente como método interno para o futuro gateway.

DTOs nunca incluem senha, ciphertext, IV, tag ou indicação derivada das credenciais. Atualizações de credenciais retornam `204` e a auditoria registra somente a ação.

## API e permissões

- `GET /api/v1/cameras`: OWNER, ADMIN, OPERATOR e VIEWER.
- `GET /api/v1/cameras/:id`: todas as roles autenticadas.
- `POST /api/v1/cameras`: OWNER e ADMIN.
- `PATCH /api/v1/cameras/:id`: OWNER e ADMIN.
- `PATCH /api/v1/cameras/:id/status`: ativa/desativa administrativamente; OWNER e ADMIN.
- `PATCH /api/v1/cameras/:id/credentials`: OWNER e ADMIN.
- `DELETE /api/v1/cameras/:id`: soft delete; OWNER e ADMIN.

Listagem aceita `page`, `limit` (máximo 100), filtros validados de status, conectividade, tipo, protocolo e localização, busca no banco e ordenação por allowlist. Toda consulta combina o ID solicitado com `organizationId` obtido da sessão/membership. Recursos de outro tenant retornam `CAMERA_NOT_FOUND`.

## Limites e exclusão

Criação utiliza `EntitlementService`: exige `LIVE_VIEW` e reserva atomicamente uma vaga de câmera. Falhas liberam a reserva. Soft delete mantém relações e histórico, libera a vaga comercial e impede novas consultas comuns.

## Gateway futuro

Não foi criado `Gateway` ou `gatewayId` vazio. `updateConnectionFromTrustedGateway` delimita a futura entrada interna para conectividade e `lastSeenAt`, mas não está exposta em rota pública. Associação, autenticação de dispositivo e heartbeat serão definidos no Prompt 07.
