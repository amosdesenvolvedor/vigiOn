# Inteligência contextual de eventos

O Prompt 12 adiciona uma camada determinística entre `CameraEvent` e `AlertService`. Ela não usa IA generativa nem visão computacional e não afirma que um crime ocorreu.

```text
CameraEvent -> ContextEngine -> RiskEngine -> EventClassification -> AlertService
```

## Horários e timezone

Schedules pertencem à organização e podem ter override por câmera. A precedência é câmera, organização e, na ausência de configuração, contexto desconhecido. `ALWAYS` considera atividade esperada, `SCHEDULED` avalia intervalos e `DISABLED` desativa a interpretação de horário. Intervalos usam minutos locais e aceitam cruzamento da meia-noite. Exceções por data podem fechar o dia ou definir abertura especial.

O instante do evento permanece UTC. Dia, data e minuto local são derivados do timezone IANA persistido na organização com `Intl.DateTimeFormat`. Nenhum offset fixo do servidor é usado.

## Zonas

Zonas são polígonos normalizados (`0..1`) com 3 a 20 pontos e prioridade NORMAL ou HIGH. Nesta versão servem como contexto da câmera: o MotionDetector ainda não informa coordenadas do movimento, portanto a existência de uma zona HIGH habilitada é um fator conservador, e não prova de que o movimento ocorreu dentro do polígono. O editor visual avançado fica para uma evolução posterior.

## Score e classificação

`riskScore` mede prioridade operacional em `0..1`; não é probabilidade de crime. Engine versão 1:

- base de movimento: 0,10;
- fora do horário: +0,35;
- zona de alta prioridade: +0,20;
- atividade persistente: +0,25.

Níveis: LOW abaixo de 0,30; MEDIUM de 0,30 a 0,549; HIGH de 0,55 a 0,799; VERY_HIGH a partir de 0,80. Pesos e thresholds ficam centralizados no `RiskEngine`.

Classificações:

- NORMAL_ACTIVITY: nenhum fator adicional;
- OUT_OF_HOURS_ACTIVITY: fora do horário efetivo;
- UNUSUAL_ACTIVITY: persistência sem fora de horário;
- POSSIBLE_INTRUSION: exige simultaneamente fora do horário, zona HIGH e persistência.

Persistência significa três eventos MOTION da mesma câmera em cinco minutos ou duração de pelo menos 60 segundos. Queries são limitadas por câmera, tenant e janela. `POSSIBLE_BREAK_IN` não foi implementado porque não existe evidência objetiva de dano, contato ou arrombamento.

## Limites técnicos

Object Detection, reconhecimento facial, placas e OpenAI não são utilizados. Não há modelo de visão instalado no gateway ou na cloud. Snapshots privados continuam disponíveis na timeline, mas não são duplicados nem processados automaticamente. Recursos `SMART_ALERTS` e `ADVANCED_EVENTS` já existem no sistema de entitlements para evolução comercial; a configuração contextual básica não foi bloqueada por plano nesta etapa.
