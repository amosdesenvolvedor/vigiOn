import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { z } from 'zod';

const rowSchema = z
  .object({
    Fabricante: z.string().trim().max(120),
    'Marca/Ecossistema': z.string().trim().min(1).max(120),
    'Modelo/Família': z.string().trim().min(1).max(160),
    Categoria: z.string().trim().max(160),
    'Provisionamento Wi‑Fi / QR': z.string().trim().max(1000),
    'QR utilizável pelo Vigion?': z.string().trim().max(500),
    'Wi‑Fi típico': z.string().trim().max(500),
    ONVIF: z.string().trim().max(120),
    'Perfil ONVIF': z.string().trim().max(120),
    RTSP: z.string().trim().max(120),
    'Porta RTSP': z.string().trim().max(40),
    'Porta ONVIF': z.string().trim().max(40),
    'RTSP principal': z.string().trim().max(500),
    'RTSP secundário': z.string().trim().max(500),
    'Credencial p/ stream': z.string().trim().max(500),
    PTZ: z.string().trim().max(120),
    Áudio: z.string().trim().max(500),
    'Observação de integração': z.string().trim().max(2000),
    'Nível de confiança': z.string().trim().max(120),
    Fonte: z.string().trim().max(1000),
  })
  .strict();

export type CatalogSpreadsheetRow = z.infer<typeof rowSchema>;
export type CatalogImportReport = {
  processed: number;
  imported: number;
  updated: number;
  ignored: number;
  rejected: Array<{ row: number; reason: string }>;
  unknownFields: Array<{ row: number; fields: string[] }>;
};

export const normalizeCatalogName = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');

const support = (value: string): 'SUPPORTED' | 'UNSUPPORTED' | 'CONDITIONAL' | 'UNKNOWN' => {
  const normalized = normalizeCatalogName(value);
  if (normalized === 'sim' || normalized.startsWith('sim (') || normalized.startsWith('sim;'))
    return 'SUPPORTED';
  if (normalized === 'não') return 'UNSUPPORTED';
  if (/condicional|depende|verificar por versão/.test(normalized)) return 'CONDITIONAL';
  return 'UNKNOWN';
};

const parsePort = (value: string) => {
  const match = value.match(/^\d{1,5}$/);
  if (!match) return undefined;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : undefined;
};

const parsePath = (value: string) => {
  if (!/^rtsp:\/\/IP(?::\d+)?\//i.test(value)) return undefined;
  const path = value.replace(/^rtsp:\/\/IP(?::\d+)?/i, '');
  return path.length <= 255 && !/@/.test(path) ? path : undefined;
};

const safeUrl = (value: string) => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
      return undefined;
    return url.toString().slice(0, 1000);
  } catch {
    return undefined;
  }
};

export function validateCatalogRows(input: unknown[]) {
  const accepted: Array<{ row: number; value: CatalogSpreadsheetRow }> = [];
  const rejected: Array<{ row: number; reason: string }> = [];
  input.forEach((raw, index) => {
    const parsed = rowSchema.safeParse(raw);
    const row = index + 2;
    if (!parsed.success) rejected.push({ row, reason: 'estrutura ou tamanho de campo inválido' });
    else if (!parsed.data.Fabricante || parsed.data.Fabricante === '—')
      rejected.push({ row, reason: 'fabricante não identificado' });
    else accepted.push({ row, value: parsed.data });
  });
  return { accepted, rejected };
}

export async function importCatalogRows(
  prisma: PrismaClient,
  input: unknown[],
): Promise<CatalogImportReport> {
  const validated = validateCatalogRows(input);
  const report: CatalogImportReport = {
    processed: input.length,
    imported: 0,
    updated: 0,
    ignored: 0,
    rejected: validated.rejected,
    unknownFields: [],
  };

  await prisma.$transaction(
    async (tx) => {
      for (const entry of validated.accepted) {
        const row = entry.value;
        const manufacturerName = row.Fabricante.replace(/\s+/g, ' ').trim();
        const brandName = row['Marca/Ecossistema'].replace(/\s+/g, ' ').trim();
        const modelName = row['Modelo/Família'].replace(/\s+/g, ' ').trim();
        const manufacturerNormalized = normalizeCatalogName(manufacturerName);
        const brandNormalized = normalizeCatalogName(brandName);
        const modelNormalized = normalizeCatalogName(modelName);
        const existingVariant = await tx.cameraCatalogVariant.findUnique({
          where: {
            identityKey: `${manufacturerNormalized}|${brandNormalized}|${modelNormalized}|default`,
          },
          select: { id: true },
        });
        const manufacturer = await tx.cameraCatalogManufacturer.upsert({
          where: { normalizedName: manufacturerNormalized },
          update: {},
          create: { name: manufacturerName, normalizedName: manufacturerNormalized },
        });
        const brand = await tx.cameraCatalogBrand.upsert({
          where: {
            manufacturerId_normalizedName: {
              manufacturerId: manufacturer.id,
              normalizedName: brandNormalized,
            },
          },
          update: {},
          create: {
            manufacturerId: manufacturer.id,
            name: brandName,
            normalizedName: brandNormalized,
          },
        });
        const model = await tx.cameraCatalogModel.upsert({
          where: { brandId_normalizedName: { brandId: brand.id, normalizedName: modelNormalized } },
          update: {},
          create: {
            brandId: brand.id,
            name: modelName,
            normalizedName: modelNormalized,
            ...(row.Categoria ? { notes: row.Categoria } : {}),
          },
        });
        const identityKey = `${manufacturerNormalized}|${brandNormalized}|${modelNormalized}|default`;
        const unknownFields: string[] = [];
        const wifi = normalizeCatalogName(row['Wi‑Fi típico']);
        const connectivity = wifi.includes('2,4') ? ['WIFI_2_4_GHZ'] : [];
        if (!connectivity.length) unknownFields.push('connectivity');
        const qrUsable = support(row['QR utilizável pelo Vigion?']);
        if (qrUsable === 'UNKNOWN') unknownFields.push('qrUsableByVigion');
        const appRequired = /\bapp\b/i.test(row['Provisionamento Wi‑Fi / QR'])
          ? 'SUPPORTED'
          : 'UNKNOWN';
        const variant = await tx.cameraCatalogVariant.upsert({
          where: { identityKey },
          update: {},
          create: {
            modelId: model.id,
            identityKey,
            connectivity,
            qrProfile: /propriet/i.test(
              `${row['Provisionamento Wi‑Fi / QR']} ${row['QR utilizável pelo Vigion?']}`,
            )
              ? 'MANUFACTURER_PROPRIETARY'
              : 'UNKNOWN',
            qrProprietary: /propriet/i.test(
              `${row['Provisionamento Wi‑Fi / QR']} ${row['QR utilizável pelo Vigion?']}`,
            )
              ? 'SUPPORTED'
              : 'UNKNOWN',
            qrUsableByVigion: qrUsable,
            manufacturerAppRequired: appRequired,
            ...(row['Observação de integração'] ? { notes: row['Observação de integração'] } : {}),
          },
        });
        const confidence = 'UNVERIFIED' as const;
        const protocolRows: Array<{
          protocol: 'ONVIF' | 'RTSP';
          value: string;
          port: string;
          main?: string;
          secondary?: string;
        }> = [
          { protocol: 'ONVIF', value: row.ONVIF, port: row['Porta ONVIF'] },
          {
            protocol: 'RTSP',
            value: row.RTSP,
            port: row['Porta RTSP'],
            main: row['RTSP principal'],
            secondary: row['RTSP secundário'],
          },
        ];
        for (const protocol of protocolRows) {
          await tx.cameraCatalogProtocol.upsert({
            where: { variantId_protocol: { variantId: variant.id, protocol: protocol.protocol } },
            update: {},
            create: {
              variantId: variant.id,
              protocol: protocol.protocol,
              support: support(protocol.value),
              confidence,
              ...(parsePort(protocol.port) !== undefined
                ? { defaultPort: parsePort(protocol.port) }
                : {}),
              ...(protocol.main && parsePath(protocol.main)
                ? { mainStreamPath: parsePath(protocol.main) }
                : {}),
              ...(protocol.secondary && parsePath(protocol.secondary)
                ? { secondaryStreamPath: parsePath(protocol.secondary) }
                : {}),
              authenticationRequired: /conta|credencial/i.test(row['Credencial p/ stream'])
                ? 'SUPPORTED'
                : 'UNKNOWN',
              ...(protocol.protocol === 'ONVIF' && /^profile\s/i.test(row['Perfil ONVIF'])
                ? { onvifProfiles: [row['Perfil ONVIF']] }
                : {}),
            },
          });
        }
        for (const [capability, value] of [
          ['PTZ', row.PTZ],
          ['AUDIO_INPUT', row['Áudio']],
        ] as const) {
          await tx.cameraCatalogCapability.upsert({
            where: { variantId_capability: { variantId: variant.id, capability } },
            update: {},
            create: { variantId: variant.id, capability, support: support(value), confidence },
          });
        }
        if (appRequired === 'SUPPORTED') {
          await tx.cameraCatalogProvisioning.upsert({
            where: { variantId_type: { variantId: variant.id, type: 'MANUFACTURER_APP_REQUIRED' } },
            update: {},
            create: {
              variantId: variant.id,
              type: 'MANUFACTURER_APP_REQUIRED',
              support: 'SUPPORTED',
              confidence,
              notes: row['Provisionamento Wi‑Fi / QR'],
            },
          });
        }
        await tx.cameraCatalogCompatibility.upsert({
          where: { variantId: variant.id },
          update: {},
          create: {
            variantId: variant.id,
            level: 'UNKNOWN',
            confidence,
            reason: row['Observação de integração'] || 'Aguardando validação técnica.',
          },
        });
        const url = safeUrl(row.Fonte);
        if (url) {
          const fingerprint = createHash('sha256').update(`${variant.id}|${url}`).digest('hex');
          await tx.cameraCatalogSource.upsert({
            where: { fingerprint },
            update: {},
            create: {
              variantId: variant.id,
              modelId: model.id,
              manufacturerId: manufacturer.id,
              type: 'MANUFACTURER_DOCUMENTATION',
              title: `Fonte inicial — ${brandName} ${modelName}`,
              url,
              publisher: manufacturerName,
              fingerprint,
              notes: 'Importada como referência; a URL isoladamente não confirma capacidades.',
            },
          });
        }
        if (unknownFields.length)
          report.unknownFields.push({ row: entry.row, fields: unknownFields });
        if (existingVariant) report.ignored += 1;
        else report.imported += 1;
      }
    },
    { timeout: 60_000 },
  );
  return report;
}
