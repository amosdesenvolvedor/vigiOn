import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cameraHealthBatchSchema } from './camera-health.schemas';

const valid = () => ({
  messageId: randomUUID(),
  protocolVersion: '1',
  entries: [
    {
      cameraId: randomUUID(),
      generation: 1,
      sequence: 1,
      observedAt: new Date().toISOString(),
      status: 'ONLINE',
      checks: { onvif: 'OK', rtsp: 'OK' },
      consecutiveFailures: 0,
    },
  ],
});

describe('camera health batch contract', () => {
  it('accepts a bounded operational status batch', () => {
    expect(cameraHealthBatchSchema.parse(valid()).entries).toHaveLength(1);
  });

  it('rejects public addresses and weak rediscovery evidence', () => {
    const input = valid();
    Object.assign(input.entries[0]!, {
      observedTarget: {
        address: '8.8.8.8',
        servicePort: 80,
        evidence: 'MODEL_MATCH',
      },
    });
    expect(cameraHealthBatchSchema.safeParse(input).success).toBe(false);
  });

  it('rejects unknown fields and empty batches', () => {
    expect(
      cameraHealthBatchSchema.safeParse({ ...valid(), entries: [], secret: 'x' }).success,
    ).toBe(false);
  });
});
