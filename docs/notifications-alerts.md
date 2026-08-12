# Alertas e notificações

O fluxo desta etapa mantém responsabilidades separadas:

```text
CameraEvent -> AlertPolicyService -> Alert -> Notification -> worker/provider
```

`MOTION`, `CAMERA_OFFLINE` e `GATEWAY_OFFLINE` geram alertas com a severidade factual do evento. `CAMERA_ONLINE` e `GATEWAY_ONLINE` não geram um novo alerta; eles resolvem alertas abertos ou reconhecidos do mesmo dispositivo. O vínculo único por evento impede reprocessamento duplicado.

## Destinatários e preferências

OWNER, ADMIN e OPERATOR ativos são destinatários iniciais. VIEWER não recebe alertas por padrão. O backend deriva organização, usuário e e-mail da sessão e do banco; nenhum endpoint aceita destinatários arbitrários.

Cada usuário pode configurar `eventType + channel + minimumSeverity`. Na ausência de registro, os defaults são:

- IN_APP habilitado para os três eventos acionáveis;
- EMAIL desabilitado;
- PUSH indisponível.

As preferências são auditadas. Registros in-app são paginados, podem ser marcados como lidos individualmente ou em lote e são mantidos indefinidamente nesta fase. Não há exclusão pelo usuário.

## E-mail e controle de flood

O e-mail reutiliza o Resend existente e só é entregue ao endereço persistido e verificado do usuário. Conteúdo dinâmico é escapado, não inclui snapshots nem informações técnicas, e o link aponta para `APP_URL`. A aceitação do Resend é registrada como `SENT`; não é declarada como confirmação de entrega.

O worker consulta notificações pendentes/fracassadas em intervalos configuráveis, usa backoff exponencial, máximo de tentativas e TTL. A chamada externa não acontece dentro da transação que persiste evento e alerta. Um cooldown por usuário, tenant e tipo de evento reduz e-mails em cenários de flapping. A agregação de movimento permanece no Event Engine.

## Push e evolução

Push não foi implementado porque o frontend não possui PWA/service worker nem infraestrutura de subscriptions. A separação por canal permite adicionar um provider futuro sem acoplar o EventService. Contexto, classificação inteligente, risco, horários e IA pertencem ao Prompt 12 e não fazem parte desta policy.
