# Conclusão segura do onboarding de câmeras

O Prompt 5/7 é o primeiro ponto do fluxo em que uma `Camera` pode ser criada. A ação ocorre somente
após o usuário preencher nome/local e clicar em **Adicionar câmera**.

## Autoridade e atomicidade

`POST /api/v1/camera-onboarding/complete` recebe apenas a sessão verificada e campos administrativos.
O backend bloqueia a linha da sessão (`FOR UPDATE`) e, em uma transação serializável:

1. revalida tenant, usuário, candidato confirmado, Gateway, validade e resultado;
2. bloqueia `MODEL_MISMATCH`, sessão incompleta, expirada ou já associada a outro dispositivo;
3. reserva o contador central de entitlement por atualização condicional;
4. procura duplicatas por hashes de serial, UID, device ID, MAC e endpoint ONVIF;
5. cria a `Camera` existente com origem `ONBOARDING`, estado administrativo `ACTIVE` e conectividade
   `UNKNOWN`;
6. persiste capacidades/evidências observadas sem promover o catálogo;
7. promove a credencial do cofre efêmero para `CameraCredential`, apagando o registro temporário;
8. marca a verificação `CONSUMED`, registra auditoria e enfileira `CAMERA_REGISTER`.

A associação única `Camera.verificationSessionId`, a chave de idempotência e o lock tornam repetições
HTTP e requests concorrentes idempotentes. Deadlocks de serialização são repetidos de forma limitada.

## Credenciais e Gateway

O cofre efêmero e o definitivo usam AES-256-GCM com AAD diferente. O ciphertext temporário enviado no
Prompt 4 nunca é copiado. O comando de registro recebe um novo envelope X25519/HKDF/AES-GCM com
contexto exclusivo. O Gateway `0.3.0` valida e descarta a credencial em memória; não cria arquivo de
password. Comandos aguardam até 24 horas e são reentregues pelo mecanismo existente após reconnect.

O ACK limpa o payload cifrado, mas não marca a câmera como `ONLINE`. A conectividade só muda após
evidência operacional posterior.

## Dados persistidos

- vínculo explícito com o Gateway e associação opcional ao catálogo;
- identidade mínima detectada;
- hashes tenant-scoped de identificadores fortes;
- capacidades e evidências detectadas;
- endpoint RTSP sanitizado, sem usuário/senha, incorporado apenas à credencial definitiva cifrada;
- rastreabilidade `creationSource=ONBOARDING` e sessão consumida.

Nenhuma alteração do Prompt 5 foi aplicada em produção.
