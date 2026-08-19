import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CameraCatalogService } from '../apps/api/src/modules/camera-catalog/camera-catalog.service';
import { importCatalogRows, validateCatalogRows } from './catalog-import';
import { initialCameraCatalogRows } from './catalog-seed-data';

const prisma = new PrismaClient();
const suffix = randomUUID().slice(0, 8);
const manufacturerName = `Catalog Test ${suffix}`;

beforeAll(() => prisma.$connect());
afterAll(async () => {
  const manufacturer = await prisma.cameraCatalogManufacturer.findUnique({
    where: { normalizedName: manufacturerName.toLowerCase() },
  });
  if (manufacturer) {
    const brands = await prisma.cameraCatalogBrand.findMany({
      where: { manufacturerId: manufacturer.id },
      select: { id: true },
    });
    const models = await prisma.cameraCatalogModel.findMany({
      where: { brandId: { in: brands.map(({ id }) => id) } },
      select: { id: true },
    });
    const variants = await prisma.cameraCatalogVariant.findMany({
      where: { modelId: { in: models.map(({ id }) => id) } },
      select: { id: true },
    });
    await prisma.cameraCatalogSource.deleteMany({
      where: {
        OR: [
          { manufacturerId: manufacturer.id },
          { modelId: { in: models.map(({ id }) => id) } },
          { variantId: { in: variants.map(({ id }) => id) } },
        ],
      },
    });
    await prisma.cameraCatalogVariant.deleteMany({
      where: { id: { in: variants.map(({ id }) => id) } },
    });
    await prisma.cameraCatalogAlias.deleteMany({
      where: { modelId: { in: models.map(({ id }) => id) } },
    });
    await prisma.cameraCatalogModel.deleteMany({
      where: { id: { in: models.map(({ id }) => id) } },
    });
    await prisma.cameraCatalogBrand.deleteMany({
      where: { id: { in: brands.map(({ id }) => id) } },
    });
    await prisma.cameraCatalogManufacturer.delete({ where: { id: manufacturer.id } });
  }
  await prisma.$disconnect();
});

describe('camera catalog import', () => {
  it('rejects malformed rows and missing manufacturers', () => {
    const result = validateCatalogRows([{ Fabricante: '—' }, { injected: true }]);
    expect(result.accepted).toHaveLength(0);
    expect(result.rejected).toHaveLength(2);
  });

  it('rejects malformed XLSX input without executing it', () => {
    const path = resolve(tmpdir(), `catalog-${suffix}.xlsx`);
    writeFileSync(path, 'not a workbook', { mode: 0o600 });
    expect(() =>
      execFileSync('python3', ['scripts/parse-camera-catalog-xlsx.py', path], {
        cwd: resolve(__dirname, '..'),
        stdio: 'pipe',
      }),
    ).toThrow();
  });

  it('imports idempotently and preserves unverified confidence', async () => {
    const row = {
      ...initialCameraCatalogRows[0]!,
      Fabricante: manufacturerName,
      'Marca/Ecossistema': `Brand ${suffix}`,
      'Modelo/Família': `Model ${suffix}`,
    };
    await expect(importCatalogRows(prisma, [row])).resolves.toMatchObject({
      imported: 1,
      rejected: [],
    });
    await expect(importCatalogRows(prisma, [row])).resolves.toMatchObject({
      imported: 0,
      ignored: 1,
    });
    const model = await prisma.cameraCatalogModel.findFirstOrThrow({
      where: { normalizedName: `model ${suffix}` },
      include: { variants: { include: { protocols: true, compatibility: true } } },
    });
    expect(model.variants[0]?.protocols.find(({ protocol }) => protocol === 'RTSP')).toMatchObject({
      support: 'SUPPORTED',
      confidence: 'UNVERIFIED',
    });
    expect(model.variants[0]?.compatibility).toMatchObject({
      level: 'UNKNOWN',
      confidence: 'UNVERIFIED',
    });
  });

  it('preserves conditional support instead of converting it to unknown', async () => {
    const row = {
      ...initialCameraCatalogRows.find((item) => item['Marca/Ecossistema'] === 'Reolink')!,
      Fabricante: manufacturerName,
      'Marca/Ecossistema': `Conditional ${suffix}`,
      'Modelo/Família': `Conditional ${suffix}`,
    };
    await importCatalogRows(prisma, [row]);
    const protocol = await prisma.cameraCatalogProtocol.findFirstOrThrow({
      where: { variant: { model: { normalizedName: `conditional ${suffix}` } }, protocol: 'RTSP' },
    });
    expect(protocol).toMatchObject({ support: 'CONDITIONAL', confidence: 'UNVERIFIED' });
  });

  it('searches globally without organization scope and supports aliases', async () => {
    const model = await prisma.cameraCatalogModel.findFirstOrThrow({
      where: { normalizedName: `model ${suffix}` },
    });
    await prisma.cameraCatalogAlias.create({
      data: { modelId: model.id, name: `Alias ${suffix}`, normalizedName: `alias ${suffix}` },
    });
    const result = await new CameraCatalogService(prisma).models({
      page: 1,
      limit: 10,
      search: `ALIAS ${suffix}`,
      sortBy: 'name',
      sortOrder: 'asc',
    });
    expect(result.pagination.total).toBe(1);
    expect(result.items[0]?.id).toBe(model.id);
  });
});
