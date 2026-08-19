import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';

export type QrConfidence = 'EXACT' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
export type QrType =
  | 'VIGION'
  | 'MANUFACTURER_SERIAL'
  | 'MANUFACTURER_UID'
  | 'MANUFACTURER_TOKEN'
  | 'MANUFACTURER_PROPRIETARY'
  | 'URL'
  | 'TEXT'
  | 'JSON'
  | 'NETWORK_CONFIGURATION'
  | 'UNKNOWN';

type Candidate = {
  value: string;
  confidence: QrConfidence;
  source: 'EXPLICIT_PAYLOAD' | 'CATALOG';
};
type Identifier = {
  type:
    | 'SERIAL_NUMBER'
    | 'UID'
    | 'DEVICE_ID'
    | 'MAC_ADDRESS'
    | 'ACTIVATION_CODE'
    | 'TOKEN'
    | 'UNKNOWN';
  value: string;
  confidence: QrConfidence;
  source: 'EXPLICIT_PAYLOAD';
};
type CatalogMatch = {
  modelId: string;
  variantId: string;
  manufacturer: string;
  brand: string;
  model: string;
  hardwareVersion: string | null;
  confidence: QrConfidence;
};

export type QrAnalysisResult = {
  type: QrType;
  recognized: boolean;
  manufacturerCandidate: Candidate | null;
  modelCandidate: Candidate | null;
  variantCandidate: Candidate | null;
  identifiers: Identifier[];
  catalogMatches: CatalogMatch[];
  confidence: QrConfidence;
  requiresUserConfirmation: boolean;
  warnings: string[];
  nextAction:
    | 'CONFIRM_IDENTIFICATION'
    | 'SELECT_CATALOG_MODEL'
    | 'CONTINUE_MANUALLY'
    | 'VIGION_QR_RECOGNIZED';
};

const normalize = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
const clean = (value: unknown) =>
  typeof value === 'string' && value.length <= 512 ? value.normalize('NFKC').trim() : '';

const inspectJson = (value: unknown, depth = 0): void => {
  if (depth > 5) throw new Error('QR JSON exceeds maximum depth');
  if (!value || typeof value !== 'object') return;
  const entries = Object.entries(value);
  if (entries.length > 64) throw new Error('QR JSON has too many fields');
  for (const [key, child] of entries) {
    if (['__proto__', 'prototype', 'constructor'].includes(key))
      throw new Error('QR JSON contains a forbidden field');
    if (typeof child === 'string' && child.length > 2048)
      throw new Error('QR JSON contains an oversized string');
    inspectJson(child, depth + 1);
  }
};

const identifierKeys: Record<string, Identifier['type']> = {
  serial: 'SERIAL_NUMBER',
  serialnumber: 'SERIAL_NUMBER',
  uid: 'UID',
  deviceid: 'DEVICE_ID',
  mac: 'MAC_ADDRESS',
  macaddress: 'MAC_ADDRESS',
  activationcode: 'ACTIVATION_CODE',
  token: 'TOKEN',
};

export class QrAnalysisService {
  constructor(private readonly prisma: PrismaClient) {}

  async analyze(payload: string): Promise<QrAnalysisResult> {
    const raw = payload.normalize('NFKC').trim();
    const base = {
      manufacturerCandidate: null,
      modelCandidate: null,
      variantCandidate: null,
      identifiers: [] as Identifier[],
      catalogMatches: [] as CatalogMatch[],
      warnings: ['A identificação por QR não autentica nem conecta a câmera.'],
    };

    const vigion = this.vigionQr(raw);
    if (vigion)
      return {
        ...base,
        type: 'VIGION',
        recognized: true,
        confidence: 'EXACT',
        requiresUserConfirmation: true,
        nextAction: 'VIGION_QR_RECOGNIZED',
      };

    let type: QrType = 'TEXT';
    let fields: Record<string, unknown> = {};
    if (/^WIFI:/iu.test(raw)) {
      type = 'NETWORK_CONFIGURATION';
      base.warnings.push(
        'Configuração de rede detectada; SSID e senha não são extraídos nem utilizados.',
      );
    } else if (/^(?:[a-z][a-z0-9+.-]*:\/\/|javascript:|data:|file:|mailto:)/iu.test(raw)) {
      type = 'URL';
      try {
        const url = new URL(raw);
        if (!['http:', 'https:'].includes(url.protocol))
          base.warnings.push('Esquema de URL não confiável; o endereço não foi acessado.');
        else
          base.warnings.push('URL classificada sem abertura, redirecionamento ou acesso de rede.');
      } catch {
        type = 'TEXT';
      }
    } else if (raw.startsWith('{')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        return this.unknown(base, 'JSON inválido.');
      }
      inspectJson(parsed);
      if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object')
        return this.unknown(base, 'Estrutura JSON não reconhecida.');
      fields = parsed as Record<string, unknown>;
      type = 'JSON';
    } else {
      fields = this.parseLabeledText(raw);
    }

    const manufacturer = clean(
      fields.manufacturer ?? fields.fabricante ?? fields.brand ?? fields.marca,
    );
    const model = clean(fields.model ?? fields.modelo);
    const variant = clean(
      fields.hardwareVersion ?? fields.hardware ?? fields.variant ?? fields.versao,
    );
    for (const [key, value] of Object.entries(fields)) {
      const identifierType = identifierKeys[normalize(key).replace(/[^a-z0-9]/g, '')];
      const identifierValue = clean(value);
      if (identifierType && identifierValue)
        base.identifiers.push({
          type: identifierType,
          value: identifierValue,
          confidence: 'HIGH',
          source: 'EXPLICIT_PAYLOAD',
        });
    }
    if (base.identifiers.length === 1) {
      const identifier = base.identifiers[0]!;
      if (identifier.type === 'SERIAL_NUMBER') type = 'MANUFACTURER_SERIAL';
      if (identifier.type === 'UID') type = 'MANUFACTURER_UID';
      if (identifier.type === 'TOKEN') type = 'MANUFACTURER_TOKEN';
    }

    const matches = await this.catalogMatches(manufacturer, model, variant);
    base.catalogMatches.push(...matches);
    const manufacturerCandidate: Candidate | null = manufacturer
      ? {
          value: manufacturer,
          confidence: matches.length ? 'HIGH' : 'MEDIUM',
          source: 'EXPLICIT_PAYLOAD' as const,
        }
      : null;
    const modelCandidate: Candidate | null = model
      ? {
          value: model,
          confidence: matches.length ? 'HIGH' : 'MEDIUM',
          source: 'EXPLICIT_PAYLOAD' as const,
        }
      : null;
    const variantCandidate: Candidate | null = variant
      ? {
          value: variant,
          confidence: matches.length === 1 ? 'HIGH' : 'MEDIUM',
          source: 'EXPLICIT_PAYLOAD' as const,
        }
      : null;
    const confidence: QrConfidence =
      matches.length === 1 && manufacturer && model
        ? variant
          ? 'EXACT'
          : 'HIGH'
        : matches.length > 1
          ? 'MEDIUM'
          : manufacturer || model
            ? 'LOW'
            : 'UNKNOWN';
    return {
      ...base,
      type,
      recognized: matches.length > 0,
      manufacturerCandidate,
      modelCandidate,
      variantCandidate,
      confidence,
      requiresUserConfirmation: true,
      nextAction: matches.length
        ? 'CONFIRM_IDENTIFICATION'
        : manufacturer
          ? 'SELECT_CATALOG_MODEL'
          : 'CONTINUE_MANUALLY',
    };
  }

  private vigionQr(raw: string) {
    try {
      const expected = new URL(env.APP_URL);
      const url = new URL(raw);
      return (
        url.protocol === 'https:' &&
        url.origin === expected.origin &&
        /^\/qr\/camera\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
          url.pathname,
        ) &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      );
    } catch {
      return false;
    }
  }

  private parseLabeledText(raw: string) {
    const result: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const segment of raw.split(/[;\n]/u).slice(0, 32)) {
      const match = segment.match(/^\s*([A-Za-z][A-Za-z0-9 _-]{0,31})\s*[:=]\s*(.{1,512})\s*$/u);
      if (match) result[match[1]!] = match[2]!;
    }
    return result;
  }

  private async catalogMatches(
    manufacturer: string,
    model: string,
    variant: string,
  ): Promise<CatalogMatch[]> {
    if (!manufacturer && !model) return [];
    const normalizedManufacturer = normalize(manufacturer);
    const normalizedModel = normalize(model);
    const rows = await this.prisma.cameraCatalogVariant.findMany({
      where: {
        model: {
          ...(normalizedModel
            ? {
                OR: [
                  { normalizedName: normalizedModel },
                  { aliasRecords: { some: { normalizedName: normalizedModel } } },
                ],
              }
            : {}),
          ...(normalizedManufacturer
            ? {
                brand: {
                  OR: [
                    { normalizedName: normalizedManufacturer },
                    { manufacturer: { normalizedName: normalizedManufacturer } },
                  ],
                },
              }
            : {}),
        },
        ...(variant
          ? { OR: [{ hardwareVersion: variant }, { name: variant }, { sku: variant }] }
          : {}),
      },
      take: 10,
      include: { model: { include: { brand: { include: { manufacturer: true } } } } },
    });
    return rows.map((row) => ({
      modelId: row.model.id,
      variantId: row.id,
      manufacturer: row.model.brand.manufacturer.name,
      brand: row.model.brand.name,
      model: row.model.name,
      hardwareVersion: row.hardwareVersion,
      confidence: variant ? 'EXACT' : rows.length === 1 ? 'HIGH' : 'MEDIUM',
    }));
  }

  private unknown(
    base: Omit<
      QrAnalysisResult,
      'type' | 'recognized' | 'confidence' | 'requiresUserConfirmation' | 'nextAction'
    >,
    warning: string,
  ): QrAnalysisResult {
    base.warnings.push(warning);
    return {
      ...base,
      type: 'UNKNOWN',
      recognized: false,
      confidence: 'UNKNOWN',
      requiresUserConfirmation: true,
      nextAction: 'CONTINUE_MANUALLY',
    };
  }
}
