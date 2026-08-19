export type CameraCatalogProfile = {
  manufacturer: string;
  ecosystem: string;
  models: string[];
  confidence: 'Alta' | 'Média/Alta' | 'Pendente';
  protocol?: 'RTSP' | 'OTHER';
  port?: string;
  path?: string;
  onboarding: string;
  warning: string;
};

// Catálogo derivado da matriz de compatibilidade fornecida para o VigiOn.
// Campos ainda não confirmados não recebem valores automáticos.
export const cameraCatalog: CameraCatalogProfile[] = [
  {
    manufacturer: 'TP-Link',
    ecosystem: 'Tapo',
    confidence: 'Alta',
    protocol: 'RTSP',
    port: '554',
    path: '/stream1',
    models: [
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
    ],
    onboarding:
      'Faça a configuração Wi-Fi no app Tapo e crie uma Conta da Câmera. Depois informe o IP local e essa credencial no VigiOn.',
    warning: 'O QR impresso na câmera não contém a conexão RTSP. Use-o somente no app Tapo.',
  },
  {
    manufacturer: 'TP-Link',
    ecosystem: 'Tapo (bateria)',
    confidence: 'Alta',
    protocol: 'OTHER',
    models: ['C410', 'C420', 'C425'],
    onboarding: 'Faça o onboarding no app Tapo.',
    warning:
      'A matriz informa que estes modelos não oferecem ONVIF/RTSP direto; a integração automática não está disponível.',
  },
  {
    manufacturer: 'Intelbras',
    ecosystem: 'Mibo',
    confidence: 'Média/Alta',
    protocol: 'RTSP',
    models: ['iM3', 'iM4', 'iM5', 'iM5 S', 'iM5+ Full Color', 'iM7', 'iM7 Full Color'],
    onboarding:
      'Configure a rede no app Mibo e habilite RTSP quando a versão do equipamento permitir. Informe IP, porta e caminho exibidos pelo fabricante.',
    warning:
      'Porta, caminho RTSP e suporte ONVIF variam por modelo/firmware e precisam ser confirmados.',
  },
  {
    manufacturer: 'Reolink',
    ecosystem: 'Reolink',
    confidence: 'Média/Alta',
    protocol: 'RTSP',
    port: '554',
    path: '/h264Preview_01_main',
    models: [
      'E1',
      'E1 Pro',
      'E1 Zoom',
      'E1 Outdoor',
      'Lumus',
      'Argus (família)',
      'TrackMix WiFi',
      'Duo WiFi',
    ],
    onboarding: 'Configure a câmera no app Reolink, habilite RTSP/ONVIF e informe o IP local.',
    warning:
      'RTSP/ONVIF e o caminho sugerido são condicionais ao modelo e firmware. Confirme antes de salvar.',
  },
  {
    manufacturer: 'Hangzhou Ezviz',
    ecosystem: 'EZVIZ',
    confidence: 'Pendente',
    models: ['C1C', 'C2C', 'C6N', 'C6W', 'H1c', 'H3c', 'H6c', 'H8c', 'C3N', 'C3X', 'BC1'],
    onboarding: 'Use o app oficial EZVIZ para o onboarding.',
    warning:
      'O QR e os protocolos são proprietários ou não confirmados. O VigiOn não preencherá RTSP automaticamente.',
  },
  {
    manufacturer: 'Dahua',
    ecosystem: 'IMOU',
    confidence: 'Pendente',
    models: [
      'Ranger 2',
      'Ranger Mini',
      'Cue 2',
      'Bullet 2',
      'Cruiser',
      'Cruiser SE',
      'Cell',
      'Rex',
    ],
    onboarding: 'Use o app oficial IMOU para o onboarding.',
    warning: 'O QR e os protocolos variam por geração/região e não serão presumidos.',
  },
  {
    manufacturer: 'Xiaomi',
    ecosystem: 'Xiaomi',
    confidence: 'Pendente',
    models: [
      'Smart Camera C200',
      'Smart Camera C300',
      'Smart Camera C400',
      'Smart Camera C500',
      'Smart Camera C700',
      'Outdoor Camera (família)',
    ],
    onboarding: 'Use o app Xiaomi Home para o onboarding.',
    warning: 'Integração RTSP/ONVIF não confirmada para estes modelos.',
  },
  {
    manufacturer: 'Amazon',
    ecosystem: 'Ring',
    confidence: 'Pendente',
    models: ['Indoor Cam', 'Stick Up Cam', 'Spotlight Cam', 'Floodlight Cam'],
    onboarding: 'Use o app Ring para o onboarding.',
    warning: 'QR e streaming são proprietários; não há configuração RTSP automática.',
  },
  {
    manufacturer: 'Google',
    ecosystem: 'Nest',
    confidence: 'Pendente',
    models: ['Nest Cam Indoor/Outdoor', 'Nest Cam Battery'],
    onboarding: 'Use o app Google Home para o onboarding.',
    warning: 'QR e streaming são proprietários; não há configuração RTSP automática.',
  },
  {
    manufacturer: 'Anker',
    ecosystem: 'eufy Security',
    confidence: 'Pendente',
    models: ['Indoor Cam', 'SoloCam', 'eufyCam', 'Floodlight Cam'],
    onboarding: 'Use o app eufy Security para o onboarding.',
    warning: 'Confirme a compatibilidade do modelo/firmware antes de informar uma URL de stream.',
  },
  {
    manufacturer: 'Amazon',
    ecosystem: 'Blink',
    confidence: 'Pendente',
    models: ['Mini', 'Mini 2', 'Outdoor', 'Indoor'],
    onboarding: 'Use o app Blink para o onboarding.',
    warning: 'QR e streaming são proprietários; não há configuração RTSP automática.',
  },
  {
    manufacturer: 'Aqara',
    ecosystem: 'Aqara',
    confidence: 'Pendente',
    models: ['Camera Hub G2H Pro', 'Camera Hub G3', 'Camera E1', 'G5 Pro'],
    onboarding: 'Use o app Aqara Home para o onboarding.',
    warning: 'QR e protocolos não estão confirmados e não serão presumidos.',
  },
  {
    manufacturer: 'Tuya',
    ecosystem: 'Smart Life / Tuya',
    confidence: 'Pendente',
    models: ['OEM / múltiplos modelos'],
    onboarding: 'Use o app indicado pelo fabricante do equipamento.',
    warning: 'Hardware e firmware variam entre OEMs; valide RTSP/ONVIF manualmente.',
  },
  {
    manufacturer: 'Shenzhen Xiongmai',
    ecosystem: 'XMEye / XM',
    confidence: 'Pendente',
    models: ['OEM / múltiplos modelos'],
    onboarding: 'Use o app indicado pelo fabricante do equipamento.',
    warning: 'Hardware e firmware variam entre OEMs; valide RTSP/ONVIF manualmente.',
  },
  {
    manufacturer: '',
    ecosystem: 'V380 / V380 Pro',
    confidence: 'Pendente',
    models: ['OEM / múltiplos modelos'],
    onboarding: 'Use o app indicado pelo fabricante do equipamento.',
    warning: 'Não imite o QR proprietário. Valide RTSP/ONVIF manualmente.',
  },
  {
    manufacturer: '',
    ecosystem: 'Yoosee',
    confidence: 'Pendente',
    models: ['OEM / múltiplos modelos'],
    onboarding: 'Use o app indicado pelo fabricante do equipamento.',
    warning: 'Não imite o QR proprietário. Valide RTSP/ONVIF manualmente.',
  },
  {
    manufacturer: '',
    ecosystem: 'ICSee',
    confidence: 'Pendente',
    models: ['OEM / múltiplos modelos'],
    onboarding: 'Use o app indicado pelo fabricante do equipamento.',
    warning: 'Não imite o QR proprietário. Valide RTSP/ONVIF manualmente.',
  },
];
