# Captura, gravação e object storage

## Arquitetura

```text
Camera RTSP (rede local)
       ↓
CameraConnector + Gateway CaptureManager
       ↓
├── Snapshot JPEG
└── Segmento de gravação MP4 limitado
       ↓
Staging privado + fila persistente com retry/backoff
       ↓ HTTPS autenticado
VigiOn API
       ↓
ObjectStorageService → MinIO privado (S3-compatible)
       ↓
StorageFile + StorageUsage + retenção
       ↓
Usuário autorizado → link temporário assinado
```

Live view continua usando `StreamManager` e HLS efêmero. `CaptureManager` trata conteúdo persistente sem converter HLS em gravação. Nesta fundação, live e captura reutilizam credenciais e abstração RTSP, mas abrem processos RTSP distintos: compartilhar uma única entrada exigiria um media router/tee e aumentaria muito a complexidade do gateway. A evolução futura pode substituir apenas a origem, sem alterar assets e storage.

## Provedor escolhido

`ObjectStorageService` define `put`, `get`, `delete` e `exists`. A implementação inicial usa MinIO privado e compatível com S3, em volume Docker dedicado. A API é o único serviço cloud com credenciais e retransmite os uploads autorizados; o bucket não é público e o MinIO só publica porta em loopback.

Essa escolha funciona sem expor uma API S3 pública ou depender de um subdomínio adicional. O custo é a passagem dos bytes pela API e o mesmo domínio de falha da VM. Para escala e alta disponibilidade, configurar R2/S3/Oracle compatível e evoluir para URLs de upload pré-assinadas é a próxima etapa operacional; a regra de negócio não depende do provedor.

## Assets e formatos

O modelo existente `StorageFile` foi evoluído como Media Asset, preservando compatibilidade. Ele persiste tenant, câmera, gateway, solicitante, tipo, estado, chave gerada pelo backend, MIME, tamanho, reserva, SHA-256, captura, upload, expiração e soft delete.

- Snapshot: JPEG (`image/jpeg`), validado por assinatura binária.
- Recording: MP4 (`video/mp4`) com `-c:v copy`, `faststart`, sem transcoding e duração máxima configurável. Cada solicitação gera um segmento limitado; não existe gravação 24/7.
- H.264 e H.265 podem ser armazenados em MP4. A reprodução de HEVC depende do navegador.

Estados: `PENDING`, `CAPTURING`, `UPLOADING`, `AVAILABLE`, `FAILED`, `DELETING`, `DELETED` e `EXPIRED`. Eles não alteram status da câmera, gateway ou stream.

## Fluxos e segurança

Snapshot e gravação exigem autenticação, `storage:manage`, tenant derivado da sessão, câmera ACTIVE/RTSP, gateway ONLINE, `CLOUD_STORAGE` e, para vídeo, `RECORDING`. `Idempotency-Key` evita assets/comandos duplicados. A cloud reserva capacidade sob lock antes de criar o asset e gera a chave:

```text
organizations/{organizationId}/cameras/{cameraId}/YYYY/MM/DD/{assetId}.jpg|mp4
```

O comando contém um envelope X25519/HKDF/AES-GCM da origem e um endpoint ligado ao asset. O gateway não escolhe tenant, câmera ou storage key. Uploads exigem autenticação do gateway, associação persistida, tamanho autorizado, SHA-256 e assinatura binária. Retry do mesmo asset é idempotente.

O staging usa diretório `0700`, arquivos/metadata `0600`, nomes UUID, limite total e TTL. A fila persiste após reinício, usa tentativas máximas, backoff exponencial e jitter. Arquivos expirados são removidos; ao esgotar tentativas antes do TTL, permanecem no staging para diagnóstico/recuperação sem crescimento ilimitado.

## Uso e retenção

`StorageUsage.usedBytes` é autoridade para bytes usados e `reservedBytes` protege concorrência. A conclusão troca toda a reserva pelo tamanho real e incrementa `fileCount` uma vez. Delete repetido não reduz uso novamente.

`expiresAt` deriva de `Plan.retentionDays`. Um worker em intervalo próprio busca lotes expirados, marca `DELETING`, remove o objeto e somente então muda metadata/uso para `EXPIRED`. Falha do storage restaura o estado anterior e será tentada novamente. Metadata apagada permanece para auditoria, sem acesso ao conteúdo.

## Endpoints

- `POST /api/v1/cameras/:cameraId/snapshots`
- `POST /api/v1/cameras/:cameraId/recordings`
- `POST /api/v1/recordings/:id/stop`
- `GET /api/v1/media-assets`
- `GET /api/v1/media-assets/:id`
- `POST /api/v1/media-assets/:id/access`
- `DELETE /api/v1/media-assets/:id`
- `PUT /api/v1/gateway-agent/media-assets/:id/content` (somente gateway)

O link de conteúdo possui HMAC e expiração curta. IDs conhecidos não bastam para acessar, listar ou excluir conteúdo de outro tenant.

## Configuração

Cloud: `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_ACCESS_KEY`, `OBJECT_STORAGE_SECRET_KEY`, `MEDIA_ACCESS_TTL_SECONDS`, `SNAPSHOT_MAX_BYTES`, `RECORDING_MAX_BYTES`, `RECORDING_SEGMENT_SECONDS` e `RETENTION_INTERVAL_SECONDS`.

Gateway: `VIGION_MEDIA_STAGING`, `VIGION_MEDIA_STAGING_MAX_BYTES`, `VIGION_UPLOAD_MAX_ATTEMPTS` e `VIGION_UPLOAD_TTL_SECONDS`.

Credenciais reais ficam somente no `.env`/secret manager. Backup do banco não inclui os objetos; o volume/bucket precisa de política própria de backup e replicação.

## Limitações

- MinIO single-node na mesma VM não é storage altamente disponível.
- Upload passa pela API e é limitado a 64 MiB nesta etapa.
- Cada gravação é um segmento manual limitado; não há NVR, gravação contínua ou por evento.
- Não há motion detection, eventos inteligentes, timeline avançada ou IA.
