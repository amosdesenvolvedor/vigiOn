import type { CatalogSpreadsheetRow } from './catalog-import';

const base = (overrides: Partial<CatalogSpreadsheetRow>): CatalogSpreadsheetRow => ({
  Fabricante: '',
  'Marca/Ecossistema': '',
  'Modelo/Família': '',
  Categoria: 'Wi‑Fi IP',
  'Provisionamento Wi‑Fi / QR': 'App do fabricante; onboarding do fabricante',
  'QR utilizável pelo Vigion?': 'Não diretamente',
  'Wi‑Fi típico': '2,4 GHz (confirmar HW/região)',
  ONVIF: 'Verificar',
  'Perfil ONVIF': 'Verificar',
  RTSP: 'Verificar',
  'Porta RTSP': 'Verificar',
  'Porta ONVIF': 'Verificar',
  'RTSP principal': 'Verificar',
  'RTSP secundário': 'Verificar',
  'Credencial p/ stream': 'Depende do fabricante',
  PTZ: 'Depende',
  Áudio: 'Depende',
  'Observação de integração': 'Exige validação por hardware e firmware.',
  'Nível de confiança': 'Pendente',
  Fonte: '',
  ...overrides,
});

const tapoModels = [
  'C100',
  'C110',
  'C113',
  'C120',
  'C200',
  'C210',
  'C216',
  'C225',
  'C310',
  'C320WS',
  'C325WB',
  'C500',
  'C510W',
  'C520WS',
  'C530WS',
];
const tapoBattery = ['C410', 'C420', 'C425'];
const miboModels = ['iM3', 'iM4', 'iM5', 'iM5 S', 'iM5+ Full Color', 'iM7', 'iM7 Full Color'];
const reolinkModels = [
  'E1',
  'E1 Pro',
  'E1 Zoom',
  'E1 Outdoor',
  'Lumus',
  'Argus (família)',
  'TrackMix WiFi',
  'Duo WiFi',
];

export const initialCameraCatalogRows: CatalogSpreadsheetRow[] = [
  ...tapoModels.map((model) =>
    base({
      Fabricante: 'TP-Link',
      'Marca/Ecossistema': 'Tapo',
      'Modelo/Família': model,
      'QR utilizável pelo Vigion?': 'Não diretamente; use QR Vigion para perfil/gateway',
      ONVIF: 'Sim',
      'Perfil ONVIF': 'Profile S',
      RTSP: 'Sim',
      'Porta RTSP': '554',
      'Porta ONVIF': '2020',
      'RTSP principal': 'rtsp://IP:554/stream1',
      'RTSP secundário': 'rtsp://IP:554/stream2',
      'Credencial p/ stream': 'Conta da Câmera criada no app Tapo',
      'Observação de integração': 'Após onboarding, gateway pode descobrir/testar ONVIF/RTSP.',
      'Nível de confiança': 'Alta',
      Fonte: 'https://www.tp-link.com/br/support/faq/4465/',
    }),
  ),
  ...tapoBattery.map((model) =>
    base({
      Fabricante: 'TP-Link',
      'Marca/Ecossistema': 'Tapo',
      'Modelo/Família': model,
      'QR utilizável pelo Vigion?': 'Não',
      ONVIF: 'Não',
      RTSP: 'Não',
      'Porta RTSP': '—',
      'Porta ONVIF': '—',
      'RTSP principal': '—',
      'RTSP secundário': '—',
      'Observação de integração': 'Modelo a bateria; sem integração local confirmada.',
      'Nível de confiança': 'Alta',
      Fonte: 'https://www.tp-link.com/br/support/faq/4465/',
    }),
  ),
  ...miboModels.map((model) =>
    base({
      Fabricante: 'Intelbras',
      'Marca/Ecossistema': 'Mibo',
      'Modelo/Família': model,
      ONVIF: 'Verificar por versão',
      RTSP: 'Sim (há tutorial Mibo RTSP)',
      'Observação de integração': 'Porta, path e ONVIF dependem do modelo/firmware.',
      'Nível de confiança': 'Média/Alta',
      Fonte:
        model === 'iM3'
          ? 'https://www.intelbras.com/pt-br/ajuda-download/download/camera-interna-inteligente-wi-fi-full-hd-im3'
          : 'https://www.intelbras.com/pt-br/ajuda-download/faq/camera-interna-inteligente-wi-fi-full-hd-360deg-im4',
    }),
  ),
  ...reolinkModels.map((model) =>
    base({
      Fabricante: 'Reolink',
      'Marca/Ecossistema': 'Reolink',
      'Modelo/Família': model,
      ONVIF: 'Condicional',
      RTSP: 'Condicional',
      'Porta RTSP': '554 (comum; validar)',
      'RTSP principal': 'rtsp://IP:554/h264Preview_01_main (validar)',
      'RTSP secundário': 'rtsp://IP:554/h264Preview_01_sub (validar)',
      'Observação de integração': 'Habilitar portas no app; suporte varia por modelo/firmware.',
      'Nível de confiança': 'Média/Alta',
      Fonte: 'https://support.reolink.com/hc/en-us/articles/900000617826/',
    }),
  ),
];
