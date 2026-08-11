# Gateway / Edge Agent

## Arquitetura

O VigiOn usa `câmera na LAN → gateway local → HTTPS de saída → cloud`. A câmera não precisa de IP público, port forwarding ou RTSP exposto. O agente não abre porta pública nem recebe conexões iniciadas pela cloud.

Nesta fundação, a comunicação usa HTTPS long polling. A escolha aproveita TLS e o proxy existentes, funciona atrás de NAT e suporta heartbeat, comandos, respostas e reconexão sem introduzir um broker prematuramente. MQTT pode ser avaliado quando telemetria e volume justificarem; o protocolo v1 preserva essa evolução.

## Identidade, pairing e autenticação

1. OWNER/ADMIN gera um código `VIGION-XXXX-XXXX-XXXX`, válido por 10 minutos por padrão.
2. Somente o hash SHA-256 normalizado do código é armazenado.
3. O instalador informa o código ao agente local.
4. O agente faz claim sem enviar `organizationId`.
5. A cloud consome o código atomicamente, cria `deviceId` e segredo aleatórios e devolve o segredo uma única vez.
6. O segredo permanente fica com permissão `0600` no gateway e somente seu hash scrypt com salt fica no banco.

JWT de usuário nunca autentica gateway. O esquema de máquina é `Authorization: Gateway <gatewayId>.<secret>`. Gateway desativado, excluído ou com segredo inválido recebe `GATEWAY_UNAUTHORIZED`. OWNER/ADMIN pode rotacionar a credencial por `POST /api/v1/gateways/:id/credentials/rotate`; o segredo anterior é revogado imediatamente e o novo aparece uma única vez.

## Protocolo v1

- `POST /api/v1/gateway-agent/claim`: claim público limitado por IP.
- `POST /api/v1/gateway-agent/heartbeat`: presença, versão e uptime real.
- `GET /api/v1/gateway-agent/commands`: polling de até 20 comandos.
- `POST /api/v1/gateway-agent/commands/ack`: resultado idempotente.

O agente envia `protocolVersion: "1"` e sua versão semântica. Alterações compatíveis adicionam campos opcionais; mudanças incompatíveis exigirão nova versão de protocolo e negociação explícita.

## Heartbeat, offline, reconexão e fila

O intervalo é devolvido pela cloud e deriva de `GATEWAY_OFFLINE_TIMEOUT_SECONDS` (120 segundos por padrão). `lastSeenAt` só avança após autenticação válida. Gateways ONLINE/CONNECTING sem heartbeat dentro do timeout passam a OFFLINE pelo serviço backend. Não há ONLINE artificial no cadastro.

Falhas usam backoff exponencial com jitter, limitado a 60 segundos. A fila local tem limite de 500 itens, TTL de 24 horas e até 8 tentativas. Arquivos de configuração/fila usam modo `0600`.

## Idempotência e comandos

Cada heartbeat/ack possui `messageId`; a combinação gateway/mensagem é única. Cada comando possui `commandId` globalmente único e expiração. Reentrega não duplica efeitos. Nesta etapa existem somente `GET_CAMERA_STATUS` (reservado) e `TEST_CAMERA`; reinicialização e streaming não foram habilitados.

## Segurança e isolamento

- Produção recusa cloud sem HTTPS.
- Tenant deriva exclusivamente da credencial da máquina.
- Payloads estritos rejeitam `organizationId`.
- Consultas combinam gateway e organização autenticada.
- Pairing, heartbeat, comandos e teste têm rate limit.
- Logs não incluem segredo, token, senha, credenciais ou URL RTSP.
- Associação/reassociação/desassociação é restrita a OWNER/ADMIN e auditada.

## Operação do agente

Construa com `docker build -f docker/gateway.Dockerfile -t vigioni-gateway .`. Na primeira execução forneça `VIGION_CLOUD_URL=https://vigion.cloud`, `VIGION_PAIRING_CODE` e `VIGION_GATEWAY_NAME`. Monte diretório persistente privado para `VIGION_GATEWAY_CONFIG` e `VIGION_GATEWAY_QUEUE`. Após claim, remova o código do ambiente.

O agente ainda não é um instalador final e não deve ser executado no servidor cloud como substituto de equipamento local.
