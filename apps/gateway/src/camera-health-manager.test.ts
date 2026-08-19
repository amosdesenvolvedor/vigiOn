import {
  createCipheriv,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  CameraHealthManager,
  type HealthCheck,
  type HealthConfiguration,
  type HealthResult,
} from './camera-health-manager';

const encrypt = (publicKeyPem: string) => {
  const recipient = createPublicKey(publicKeyPem);
  const ephemeral = generateKeyPairSync('x25519');
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipient });
  const key = Buffer.from(hkdfSync('sha256', shared, Buffer.alloc(0), 'vigioni-stream-v1', 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from('vigioni-stream-source-v1'));
  const source = {
    username: 'camera',
    password: 'not-logged',
    stream: { host: '192.168.1.10', port: 554, path: '/stream', transport: 'tcp' },
  };
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(source)), cipher.final()]);
  return {
    ephemeralPublicKey: ephemeral.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    initializationVector: iv.toString('base64url'),
    authenticationTag: cipher.getAuthTag().toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
};

const setup = (
  checks: Exclude<HealthCheck, 'SKIPPED'>[],
  rediscover?: () => Promise<{ address: string; servicePort: number } | null>,
) => {
  const keys = generateKeyPairSync('x25519');
  const results: HealthResult[] = [];
  const checker = async () => checks.shift() ?? 'OK';
  const manager = new CameraHealthManager(
    keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    async (result) => {
      results.push(result);
    },
    () => Date.now(),
    () => 0,
    1,
    { onvif: checker, rtsp: checker },
    rediscover,
  );
  const configuration: HealthConfiguration = {
    cameraId: '00000000-0000-4000-8000-000000000001',
    generation: 1,
    healthProfile: {
      onvif: true,
      rtsp: false,
      normalIntervalSeconds: 60,
      failureThreshold: 3,
      maxBackoffSeconds: 300,
    },
    identity: { endpointReference: 'urn:uuid:exact' },
    encryptedSource: encrypt(keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()),
  };
  manager.sync([configuration]);
  return { manager, results, configuration };
};

describe('CameraHealthManager', () => {
  it('applies hysteresis and distinguishes authentication failure', async () => {
    const { manager, results, configuration } = setup([
      'FAILED',
      'FAILED',
      'FAILED',
      'OK',
      'AUTHENTICATION_ERROR',
    ]);
    for (let index = 0; index < 5; index += 1) await manager.checkNow(configuration.cameraId);
    expect(results.map((item) => item.status)).toEqual([
      'DEGRADED',
      'DEGRADED',
      'OFFLINE',
      'ONLINE',
      'AUTHENTICATION_ERROR',
    ]);
    expect(JSON.stringify(results)).not.toContain('not-logged');
    manager.stop();
  });

  it('rediscoveries only with strong endpoint identity and emits exact evidence once', async () => {
    const rediscover = vi.fn(async () => ({ address: '192.168.1.20', servicePort: 80 }));
    const { manager, results, configuration } = setup(['FAILED', 'FAILED', 'FAILED'], rediscover);
    await manager.checkNow(configuration.cameraId);
    await manager.checkNow(configuration.cameraId);
    await manager.checkNow(configuration.cameraId);
    expect(rediscover).toHaveBeenCalledOnce();
    expect(results.at(-1)?.observedTarget).toEqual({
      address: '192.168.1.20',
      servicePort: 80,
      evidence: 'ONVIF_ENDPOINT_REFERENCE_EXACT',
    });
    manager.stop();
  });

  it('removes disabled cameras from memory and does not run them again', async () => {
    const { manager, results, configuration } = setup(['OK']);
    manager.sync([]);
    expect(await manager.checkNow(configuration.cameraId)).toBe(false);
    expect(results).toHaveLength(0);
    manager.stop();
  });

  it('restores scheduling from cloud sync after a Gateway restart without re-registration', async () => {
    const first = setup(['OK']);
    expect(await first.manager.checkNow(first.configuration.cameraId)).toBe(true);
    first.manager.stop();
    const restarted = setup(['OK']);
    expect(await restarted.manager.checkNow(restarted.configuration.cameraId)).toBe(true);
    expect(restarted.results).toMatchObject([{ status: 'ONLINE', sequence: 1 }]);
    restarted.manager.stop();
  });
});
