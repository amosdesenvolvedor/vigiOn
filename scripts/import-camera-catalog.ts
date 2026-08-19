import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { importCatalogRows } from '../prisma/catalog-import';

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error('Uso: tsx scripts/import-camera-catalog.ts catalog.json');
  const path = resolve(input);
  const stat = await import('node:fs/promises').then(({ stat }) => stat(path));
  if (!stat.isFile() || stat.size > 10 * 1024 * 1024)
    throw new Error('Arquivo inválido ou acima de 10 MB.');
  const raw = JSON.parse(await readFile(path, 'utf8')) as unknown;
  if (!Array.isArray(raw)) throw new Error('O JSON deve conter uma lista de linhas.');
  const prisma = new PrismaClient();
  try {
    const report = await importCatalogRows(prisma, raw);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.rejected.length) process.exitCode = 2;
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Falha de importação.');
  process.exitCode = 1;
});
