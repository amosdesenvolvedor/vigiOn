# Central de monitoramento e realtime

O dashboard usa a API como fonte de verdade e SSE apenas para invalidação em tempo quase real. O browser obtém um ticket opaco de 60 segundos por uma chamada com JWT em header. O ticket fixa usuário e organização; o endpoint SSE não aceita tenant escolhido pelo cliente e não coloca JWT na URL.

Mensagens usam protocolo versão 1 e carregam somente `type`, `entityId` e `occurredAt`. Eventos atuais: `EVENT_CREATED`, `DEVICE_STATUS_CHANGED`, `ALERT_CHANGED` e `NOTIFICATION_CREATED`. Após uma mensagem ou reconexão, o frontend consulta novamente `GET /dashboard/summary`, evitando duplicidade, problemas com eventos atrasados e estado divergente.

Há no máximo três conexões por usuário, heartbeat SSE a cada 20 segundos e polling de fallback a cada 60 segundos. Clientes lentos cuja escrita aplica backpressure são desconectados. A implementação é single-instance e em memória; múltiplas réplicas exigirão pub/sub compartilhado no Prompt 17.

O summary agrega contagens tenant-scoped, até 50 câmeras, 20 gateways, 20 eventos e 20 alertas, com includes controlados. A grade nunca inicia streams automaticamente. O usuário abre uma câmera online explicitamente, reutilizando `StreamSession`, player HLS seguro e limites existentes. Fechar o player solicita encerramento da sessão.

Editor visual de zonas e interface de exceções de schedule não foram incluídos: são configurações, não requisitos para a visão operacional deste prompt.
