# Experiência mobile e PWA

O Vigion Cloud evolui a aplicação React existente como PWA, sem um segundo código-base nativo. O manifesto define modo `standalone`, identidade e ícones locais. A navegação móvel usa cinco destinos touch-friendly e mantém o layout desktop.

## Service Worker e privacidade

O Service Worker manual guarda somente shell, bundles e assets públicos versionados. Requests `/api/`, SSE, HLS, snapshots, recordings e respostas autenticadas nunca são interceptados. Navegação usa rede primeiro e o shell offline apenas informa que o dispositivo perdeu conexão; nenhum histórico privado é disponibilizado offline. Logout solicita a limpeza dos caches públicos, além de desmontar SSE e players.

Atualizações não recarregam silenciosamente uma live: quando existe worker aguardando, o usuário escolhe **Atualizar aplicativo**. O cache antigo é removido na ativação.

## Push

O usuário ativa push explicitamente. O browser cria uma subscription vinculada, pela API autenticada, ao usuário e organização da sessão. O endpoint nunca recebe IDs arbitrários. Uma subscription não pode ser apropriada por outro usuário. Múltiplos dispositivos são suportados.

Alertas criam uma `Notification` no canal `PUSH` somente quando a preferência do evento estiver habilitada e sua severidade mínima for atendida. O worker existente entrega por Web Push/VAPID a todas as subscriptions ativas. HTTP 404/410 revoga endpoints expirados; falhas não interrompem In-App ou Email. O push contém apenas título, texto factual e deep link interno validado.

Variáveis obrigatórias para habilitar entrega:

```text
WEB_PUSH_VAPID_PUBLIC_KEY=
WEB_PUSH_VAPID_PRIVATE_KEY=
WEB_PUSH_SUBJECT=mailto:security@vigion.cloud
```

Gere o par uma única vez com `npx web-push generate-vapid-keys`. A chave privada fica somente no ambiente da API. Rotacionar as chaves invalida subscriptions anteriores, que precisarão ser recriadas.

Web Push depende do suporte do navegador. Em iOS, a experiência depende de versão compatível e normalmente da PWA adicionada à tela inicial. Suporte físico em iOS/Android só deve ser declarado após teste real.

## Live no mobile

O player HLS continua lazy e abre apenas após toque. Fechar, navegar, sair ou manter o app em background por 60 segundos encerra a `StreamSession`. Perda abrupta continua protegida pelo TTL do backend.

O editor visual de zonas permanece fora desta etapa: o detector atual não informa a posição exata do movimento no polígono. A UI de exceções de agenda também permanece no backend até existir um fluxo de configurações dedicado e testável.
