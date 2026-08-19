import type { PrismaClient } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { QrAnalysisService } from './qr-analysis.service';

const variant = (hardwareVersion: string | null = 'V1') => ({
  id: `variant-${hardwareVersion ?? 'generic'}`,
  hardwareVersion,
  model: {
    id: 'model-c200',
    name: 'C200',
    brand: { name: 'Tapo', manufacturer: { name: 'TP-Link' } },
  },
});
const setup = (rows: ReturnType<typeof variant>[] = []) => {
  const findMany = vi.fn().mockResolvedValue(rows);
  const prisma = { cameraCatalogVariant: { findMany } } as unknown as PrismaClient;
  return { service: new QrAnalysisService(prisma), findMany };
};

describe('safe QR analysis', () => {
  it('recognizes only a structurally valid VigiOn URL on the configured origin', async () => {
    const { service } = setup();
    const valid = await service.analyze(
      'https://vigion.test/qr/camera/550e8400-e29b-41d4-a716-446655440000',
    );
    expect(valid).toMatchObject({
      type: 'VIGION',
      recognized: true,
      confidence: 'EXACT',
      requiresUserConfirmation: true,
    });
    const invalid = await service.analyze('VIGION:550e8400-e29b-41d4-a716-446655440000');
    expect(invalid).toMatchObject({ recognized: false, confidence: 'UNKNOWN' });
  });

  it('classifies unknown text, network configuration and URLs without network access', async () => {
    const { service, findMany } = setup();
    await expect(service.analyze('unrecognized opaque content')).resolves.toMatchObject({
      type: 'TEXT',
      recognized: false,
    });
    await expect(service.analyze('WIFI:T:WPA;S:private;P:secret;;')).resolves.toMatchObject({
      type: 'NETWORK_CONFIGURATION',
      recognized: false,
    });
    await expect(service.analyze('http://169.254.169.254/latest/meta-data')).resolves.toMatchObject(
      { type: 'URL', recognized: false },
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it('preserves identifier semantics from explicit fields', async () => {
    const { service } = setup();
    const result = await service.analyze('serial=SN1;uid=UID1;deviceId=DEV1;mac=AA:BB:CC:DD:EE:FF');
    expect(result.identifiers.map((item) => item.type)).toEqual([
      'SERIAL_NUMBER',
      'UID',
      'DEVICE_ID',
      'MAC_ADDRESS',
    ]);
  });

  it('matches an explicit manufacturer and model without fuzzy matching', async () => {
    const { service, findMany } = setup([variant()]);
    const result = await service.analyze(
      '{"manufacturer":"TP-Link","model":"C200","serial":"SN1"}',
    );
    expect(result).toMatchObject({
      type: 'MANUFACTURER_SERIAL',
      recognized: true,
      confidence: 'HIGH',
      nextAction: 'CONFIRM_IDENTIFICATION',
    });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 10 }));
  });

  it('returns multiple variants instead of selecting one', async () => {
    const { service } = setup([variant('V1'), variant('V2')]);
    const result = await service.analyze('manufacturer=TP-Link;model=C200');
    expect(result.catalogMatches).toHaveLength(2);
    expect(result).toMatchObject({ confidence: 'MEDIUM', requiresUserConfirmation: true });
  });

  it('keeps a known manufacturer with unknown model unconfirmed', async () => {
    const { service } = setup([]);
    const result = await service.analyze('{"manufacturer":"TP-Link","model":"NOT-A-MODEL"}');
    expect(result).toMatchObject({
      recognized: false,
      confidence: 'LOW',
      nextAction: 'SELECT_CATALOG_MODEL',
    });
  });

  it('rejects malformed, deeply nested, polluted and oversized JSON fields', async () => {
    const { service } = setup();
    await expect(service.analyze('{bad')).resolves.toMatchObject({ type: 'UNKNOWN' });
    await expect(service.analyze('{"a":{"b":{"c":{"d":{"e":{"f":{}}}}}}}')).rejects.toThrow(
      'maximum depth',
    );
    await expect(service.analyze('{"__proto__":{"admin":true}}')).rejects.toThrow(
      'forbidden field',
    );
    await expect(service.analyze(JSON.stringify({ model: 'a'.repeat(2049) }))).rejects.toThrow(
      'oversized string',
    );
  });
});
