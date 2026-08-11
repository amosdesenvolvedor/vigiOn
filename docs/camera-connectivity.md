# Conectividade de câmeras

## Relação com o gateway

`Camera.gatewayId` é opcional e representa a associação atual. A solução simples suporta troca de gateway; cada alteração registra gateway anterior/novo no AuditLog. Excluir gateway desassocia suas câmeras e redefine conectividade como UNKNOWN.

## CameraConnector

O Edge Agent define `connect()`, `disconnect()`, `getStatus()`, `getMetadata()` e `testConnection()`. O registro seleciona conectores por protocolo. RTSP e ONVIF estão preparados como adaptadores, mas deliberadamente não abrem stream, gravam ou fazem discovery nesta etapa. Implementações futuras poderão adicionar bibliotecas sem reescrever o loop de comunicação.

## Test connection

OWNER/ADMIN envia `TEST_CAMERA` a um gateway ONLINE. O agente responde `SUCCESS`, `FAILED`, `TIMEOUT`, `AUTHENTICATION_ERROR` ou `UNSUPPORTED_PROTOCOL`, sem retornar senha ou URL sensível. A resposta atualiza somente estado técnico e `lastSeenAt` em sucesso.

## Descoberta

A camada ONVIF futura fará discovery somente na rede local administrada pelo cliente, com escopo, intervalo e timeout explícitos; nunca fará scan indiscriminado externo. Resultados serão candidatos DISCOVERED e exigirão seleção, credenciais e teste pelo usuário antes do cadastro. Nenhuma câmera é cadastrada automaticamente.

## RTSP e ONVIF

RTSP permanece na LAN entre câmera e agente. O Prompt 08 adicionou remux HLS temporário e player, sem tornar RTSP público ou persistir gravações. ONVIF será usado futuramente para discovery, metadados, perfis e URLs locais. Nenhuma biblioteca ONVIF foi adicionada porque host/path RTSP podem ser configurados diretamente.

## Erros estáveis

Os contratos usam `GATEWAY_NOT_FOUND`, `GATEWAY_UNAUTHORIZED`, `GATEWAY_OFFLINE`, `CAMERA_NOT_FOUND`, `PAIRING_CODE_EXPIRED`, `PAIRING_CODE_INVALID`, `COMMAND_NOT_FOUND`, `RATE_LIMITED` e resultados de conexão padronizados. Conectores devem mapear erros internos sem vazar detalhes sensíveis.
