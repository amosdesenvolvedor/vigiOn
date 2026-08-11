# Streaming e visualização

## Arquitetura implementada

```text
Camera RTSP (LAN)
     ↓
Gateway StreamManager + FFmpeg
     ↓  HLS temporário, segmentos de 1 segundo
HTTPS autenticado Gateway → Cloud
     ↓
Media store efêmero da sessão
     ↓  token curto no header Stream
HLS.js no navegador autorizado
```

O control plane continua usando HTTPS long polling para `START_STREAM`, `STOP_STREAM`, reentrega e ACK. Os bytes não trafegam nessa fila: o media plane possui endpoints autenticados próprios para upload e leitura de HLS.

## Decisão HLS

HLS com segmentos curtos foi escolhido por compatibilidade com navegadores, operação simples sobre HTTPS, ausência de signaling/TURN e custo previsível. A latência esperada é aproximadamente 3–8 segundos e não é subsegundo. WebRTC poderá ser avaliado quando essa exigência justificar ICE, TURN e uma camada de mídia adicional. Somente um pipeline foi implementado.

O player usa HLS.js 1.6.17 e envia o token no header `Authorization: Stream ...`; o token não aparece na URL. Playlists externas, `URI=` e path traversal são rejeitados para impedir vazamento do header e SSRF indireto.

## Sessão e autorização

`StreamSession` persiste o ciclo `REQUESTED → STARTING → ACTIVE → STOPPING → ENDED`, além de `FAILED` e `EXPIRED`. Estado de câmera, gateway, API e stream permanecem distintos. A mídia é efêmera em `STREAM_MEDIA_ROOT`, nunca em `StorageFile`.

`POST /api/v1/cameras/:cameraId/stream-sessions` exige usuário, `cameras:view`, organização derivada da sessão e `Idempotency-Key` UUID. O backend valida LIVE_VIEW, câmera ACTIVE, protocolo RTSP, gateway ONLINE, associação e limite simultâneo. OWNER, ADMIN, OPERATOR e VIEWER podem visualizar segundo a matriz existente; somente o criador consulta/encerra sua sessão.

O token é curto, determinístico para retries da mesma chave, armazenado somente como SHA-256, associado a sessão/usuário/expiração e revogável pelo estado da sessão. GET/DELETE tenant-scoped impedem IDOR. O gateway só envia mídia para sessões vinculadas ao seu próprio tenant e ID.

## Credenciais e RTSP

Host, porta, path, transporte, usuário e senha ficam dentro do `CameraCredential` AES-256-GCM existente. Para iniciar, a cloud recupera a configuração no backend e cria um envelope efêmero X25519 + HKDF-SHA256 + AES-256-GCM destinado à chave pública do gateway. O comando e o banco de comandos nunca contêm plaintext.

O gateway valida host/path/porta e inicia FFmpeg com array de argumentos e `shell: false`. Nenhuma URL RTSP, senha ou stderr bruto é registrada. A conexão RTSP ocorre somente no gateway local; a cloud não acessa o host da câmera.

## FFmpeg, codecs e recursos

O pipeline usa `-c:v copy`: H.264 é remuxado sem transcoding, reduzindo CPU. H.265/HEVC não possui compatibilidade universal no browser e resulta em `UNSUPPORTED_CODEC` quando detectado; transcoding não foi habilitado. Áudio também não é incluído nesta fundação.

`StreamManager` limita pipelines, compartilha uma fonte por câmera entre sessões, mantém referências dos viewers, encerra FFmpeg em STOP/último viewer/shutdown e força SIGKILL após grace period. Uploads falhos são tentados novamente pelo próximo ciclo sem criar outro processo.

## Expiração e observabilidade

TTL absoluto, idle timeout e timeout de início são configuráveis. Cleanup marca sessões abandonadas como EXPIRED, remove mídia e enfileira STOP_STREAM mesmo que o gateway esteja temporariamente offline. Logs estruturados incluem IDs, tenant, duração/resultado quando disponível, nunca secrets.

Eventos implementados/preparados: `stream.requested`, `stream.started` via ativação da playlist, `stream.failed`, `stream.stopped` e `stream.expired`. As tabelas e estados permitem métricas futuras de streams ativos, falhas e duração sem antecipar a infraestrutura de observabilidade posterior.

## Configuração

Cloud:

- `STREAM_SESSION_TTL_SECONDS=600`
- `STREAM_IDLE_TIMEOUT_SECONDS=90`
- `STREAM_START_TIMEOUT_SECONDS=45`
- `MAX_ACTIVE_STREAMS_PER_ORG=10`
- `STREAM_MEDIA_ROOT=/tmp/vigion-streams`

Gateway:

- `VIGION_FFMPEG_PATH=ffmpeg`
- `VIGION_MAX_STREAMS=4`
- `VIGION_STREAM_START_TIMEOUT_SECONDS=30`

O Dockerfile do gateway instala FFmpeg. O diretório de mídia cloud é descartável e deve ser tratado como cache de uma única instância; escala horizontal futura exigirá media node/volume efêmero compartilhado ou roteamento consistente.

## Limitações validadas

- Lifecycle, compartilhamento e limites foram testados com processo simulado.
- Sessões, tokens, expiração, tenant e comandos foram testados com MariaDB real local.
- Pipeline com câmera RTSP física/controlada: **NÃO VALIDADO**, pois nenhuma fonte RTSP local foi fornecida.
- Reprodução visual ponta a ponta com frames reais: **NÃO VALIDADO** pelo mesmo motivo.
- ONVIF: **NÃO IMPLEMENTADO**; não é necessário quando host/path RTSP são configurados diretamente.

Não há gravação, retenção, snapshots históricos, IA ou storage definitivo neste módulo.
