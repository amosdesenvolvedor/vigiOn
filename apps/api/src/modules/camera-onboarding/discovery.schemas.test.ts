import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { gatewayDiscoveryResultSchema, startDiscoverySchema } from './discovery.schemas';

describe('discovery boundary schemas', () => {
  it('rejects arbitrary CIDR, QR hosts, URLs and ports from user input', () => {
    const valid = { gatewayId: randomUUID(), expectedModel: 'C200' };
    expect(startDiscoverySchema.parse(valid)).toMatchObject(valid);
    for (const extra of [
      { cidr: '10.0.0.0/8' },
      { host: '192.168.1.1' },
      { url: 'http://router' },
      { port: 22 },
    ])
      expect(() => startDiscoverySchema.parse({ ...valid, ...extra })).toThrow();
  });
  it('accepts only private IPv4 and bounded gateway candidates', () => {
    const base = {
      messageId: randomUUID(),
      commandId: randomUUID(),
      sessionId: randomUUID(),
      protocolVersion: '1',
      status: 'RESULTS',
      candidates: [],
    };
    expect(gatewayDiscoveryResultSchema.parse(base)).toBeTruthy();
    expect(() =>
      gatewayDiscoveryResultSchema.parse({
        ...base,
        candidates: [
          { networkAddress: '169.254.169.254', servicePort: 80, evidence: 'ONVIF_WS_DISCOVERY' },
        ],
      }),
    ).toThrow();
    expect(() =>
      gatewayDiscoveryResultSchema.parse({
        ...base,
        candidates: [
          { networkAddress: '192.168.1.20', servicePort: 70000, evidence: 'ONVIF_WS_DISCOVERY' },
        ],
      }),
    ).toThrow();
  });
});
