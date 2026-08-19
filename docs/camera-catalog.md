# Catálogo técnico de câmeras

O catálogo é global e descreve conhecimento técnico; `Camera` continua sendo a instância física de uma organização. Uma câmera pode apontar opcionalmente para `CameraCatalogVariant`, mas câmeras antigas e modelos desconhecidos permanecem válidos.

## Modelo de dados

- `CameraCatalogManufacturer`, `CameraCatalogBrand` e `CameraCatalogFamily` formam a taxonomia comercial.
- `CameraCatalogModel` guarda nome, aliases, categoria e resolução.
- `CameraCatalogVariant` diferencia hardware, região, firmware, SKU, conectividade e metadados de QR.
- `CameraCatalogCapability` e `CameraCatalogProtocol` usam `SUPPORTED`, `UNSUPPORTED`, `CONDITIONAL` ou `UNKNOWN`.
- `CameraCatalogProvisioning` registra estratégias conhecidas, sem executá-las.
- `CameraCatalogCompatibility` classifica o resultado global para o VigiOn.
- `CameraCatalogSource` registra referências; uma URL não promove automaticamente uma afirmação.

Compatibilidade, protocolo, provisionamento e QR são dimensões independentes. Por exemplo, RTSP pode estar `SUPPORTED` enquanto o provisionamento exige `MANUFACTURER_APP_REQUIRED`. Da mesma forma, QR físico não implica que o VigiOn possa interpretar ou gerar esse QR.

`CatalogQrProfileType` separa explicitamente `VIGION` dos perfis `MANUFACTURER_*`; um QR proprietário nunca é convertido implicitamente em QR VigiOn. As capacidades do catálogo são esperadas. `Camera.detectedCapabilities` é um campo separado e opcional para observações futuras do Gateway; a informação detectada terá prioridade operacional sem reescrever o catálogo global.

## Confiança

- `OFFICIAL_CONFIRMED`: documentação oficial confirma especificamente o modelo/variante e comportamento.
- `COMMUNITY_CONFIRMED`: evidência comunitária reproduzível, ainda não oficial.
- `LAB_VERIFIED`: equipe VigiOn reproduziu o comportamento no equipamento físico identificado.
- `INFERRED`: inferência explícita, nunca apresentada como confirmação.
- `UNVERIFIED`: dado inicial ainda não validado.

Todos os dados da planilha inicial são importados como `UNVERIFIED`, mesmo quando a linha contém uma URL oficial. Valores “Condicional”, “Depende” e “Verificar por versão” tornam-se `CONDITIONAL`; “Verificar” e “Não assumir” tornam-se `UNKNOWN`.

## Provisionamento

Os tipos `VIGION_DIRECT`, `ONVIF_DISCOVERY`, `RTSP_MANUAL`, `MANUFACTURER_QR`, `MANUFACTURER_APP_REQUIRED`, `MANUFACTURER_CLOUD_REQUIRED`, `AP_MODE`, `BLUETOOTH_ASSISTED`, `QR_WIFI`, `PROPRIETARY_P2P`, `MANUAL` e `UNKNOWN` são somente metadados nesta fase. Nenhum driver, descoberta, scan, conexão ou payload proprietário é executado.

## Importação

1. Converter a primeira planilha para JSON seguro:

   `npm run catalog:parse -- matriz.xlsx > catalog.json`

2. Revisar o JSON e executar:

   `npm run catalog:import -- catalog.json`

O parser aceita apenas `.xlsx`, limita tamanhos, não habilita macros, rejeita fórmulas e não faz requisições externas. O importador valida cada linha com esquema estrito, normaliza somente chaves de busca, preserva nomes comerciais, executa em transação, usa chaves únicas e emite relatório de importados, ignorados, rejeitados e campos desconhecidos. URLs com credenciais ou protocolos diferentes de HTTP(S) são descartadas.

Reexecução é segura: registros existentes não são apagados nem têm confiança sobrescrita. O seed determinístico contém somente as 33 linhas inicialmente mais estruturadas (Tapo, Mibo e Reolink). O importador completo pode carregar as demais como conhecimento não verificado.

## Adicionar ou validar modelos

Novos modelos devem ser criados por `PLATFORM_ADMIN` com MFA validado. Registre variante de hardware/região separada sempre que isso puder alterar capacidades. Acrescente fontes sem segredos e mantenha informações não verificadas como `UNKNOWN`/`UNVERIFIED`.

Para validação de laboratório, registre modelo, hardware, região, firmware, data, procedimento reproduzível e resultado. Só então promova os campos efetivamente testados para `LAB_VERIFIED`; não promova automaticamente capacidades relacionadas.

## Camera Compatibility Policy

O VigiOn somente declara um modelo oficialmente suportado quando existe evidência técnica específica e suficiente para a variante aplicável. Nome comercial, presença de Wi-Fi, URL genérica, QR físico ou compatibilidade de outro hardware da mesma família não constituem prova.

Uma classificação `SUPPORTED` exige que os protocolos/capacidades necessários estejam confirmados e que as limitações de provisionamento sejam comunicadas. `PARTIAL` e `EXPERIMENTAL` devem explicar o motivo. Dependência exclusiva de tecnologia proprietária deve ser classificada como `PROPRIETARY_ONLY`; ausência confirmada como `UNSUPPORTED`; falta de evidência como `UNKNOWN`.

## APIs

Consultas autenticadas:

- `GET /api/v1/camera-catalog/manufacturers`
- `GET /api/v1/camera-catalog/models`
- `GET /api/v1/camera-catalog/search`
- `GET /api/v1/camera-catalog/models/:id`
- `GET /api/v1/camera-catalog/models/:id/compatibility`

Administração global (`PLATFORM_ADMIN` + MFA):

- `POST /api/v1/camera-catalog/admin/manufacturers`
- `POST /api/v1/camera-catalog/admin/brands`
- `POST /api/v1/camera-catalog/admin/families`
- `POST /api/v1/camera-catalog/admin/models`
- `PATCH /api/v1/camera-catalog/admin/variants/:id/compatibility`

Usuários tenant podem consultar para seleção futura, mas `OWNER`/`ADMIN` de organização não podem alterar o catálogo global.
