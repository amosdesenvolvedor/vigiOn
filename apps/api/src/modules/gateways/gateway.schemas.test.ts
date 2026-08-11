import { describe, expect, it } from 'vitest';
import { claimGatewaySchema, commandAckSchema, heartbeatSchema } from './gateway.schemas';

describe('gateway machine payload validation', () => {
  it('rejects tenant injection in heartbeat and claim', () => {
    expect(() =>
      heartbeatSchema.parse({
        messageId: crypto.randomUUID(),
        version: '1.0.0',
        protocolVersion: '1',
        timestamp: new Date().toISOString(),
        status: 'ONLINE',
        organizationId: crypto.randomUUID(),
      }),
    ).toThrow();
    expect(() =>
      claimGatewaySchema.parse({
        pairingCode: 'VIGION-AAAA-BBBB-CCCC',
        name: 'Edge',
        version: '1.0.0',
        protocolVersion: '1',
        organizationId: crypto.randomUUID(),
      }),
    ).toThrow();
  });
  it('rejects unknown command results and malformed messages', () => {
    expect(() =>
      commandAckSchema.parse({
        messageId: 'bad',
        commandId: crypto.randomUUID(),
        status: 'ROOT_ACCESS',
      }),
    ).toThrow();
  });
});
