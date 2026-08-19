# Verificação local de câmeras

O Prompt 4/7 adiciona uma etapa explícita entre a descoberta e a criação da câmera. Confirmar um
candidato não cria uma `Camera` e não altera a compatibilidade global do catálogo.

## Fluxo

1. A API aceita somente um candidato previamente descoberto e confirmado no mesmo tenant.
2. Usuário e senha são informados explicitamente. Não há tentativa de credenciais padrão nem força
   bruta.
3. A API cifra a credencial com X25519, HKDF-SHA256 e AES-256-GCM para a chave pública do Gateway.
4. O Gateway limita a verificação ao IPv4 privado e à porta registrados pelo processo de descoberta.
5. São consultados Device Information, Capabilities, perfis Media e Stream URI. O URI só é aceito se
   for RTSP, não contiver credenciais e apontar para o mesmo endereço descoberto.
6. O handshake RTSP usa somente `DESCRIBE`, com Basic ou Digest após desafio. Nenhum vídeo é baixado.
7. A API persiste apenas identidade, capacidades e evidências sanitizadas. O payload cifrado do
   comando é apagado ao concluir, cancelar ou expirar.

As sessões expiram em cinco minutos, a execução no Gateway é limitada a vinte segundos e há no
máximo cinco envios de credenciais por usuário/candidato em quinze minutos. O Gateway mínimo para
esta etapa é `0.2.0`.

## Segurança

- XML limitado a 256 KiB, sem DTD, entidades externas ou stylesheet.
- Resposta RTSP/SDP limitada a 64 KiB.
- XAddr ONVIF e URI RTSP precisam manter exatamente o endereço descoberto.
- Resultados não aceitam URI, SDP, usuário ou senha.
- Logs e auditoria registram IDs e estados, nunca segredos.
