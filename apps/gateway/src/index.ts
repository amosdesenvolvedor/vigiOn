import { chmod, readFile, writeFile } from 'node:fs/promises';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import {
  ConnectorRegistry,
  PreparedConnector,
  RtspConnector,
  type StreamSourceConnector,
  type ConnectionTestResult,
} from './connectors/camera-connector';
import { LocalQueue } from './local-queue';
import { decryptStreamSource, type EncryptedStreamSource } from './stream-envelope';
import { StreamManager } from './stream-manager';
import { CaptureManager } from './capture-manager';
import {
  MotionMonitorManager,
  type MonitoringConfiguration,
  type EdgeEvent,
} from './motion-monitor';

const cloudUrl = process.env.VIGION_CLOUD_URL ?? 'https://vigion.cloud';
if (process.env.NODE_ENV === 'production' && !cloudUrl.startsWith('https://'))
  throw new Error('Production gateway requires HTTPS');
const configFile = process.env.VIGION_GATEWAY_CONFIG ?? './gateway-config.json';
const queue = new LocalQueue(process.env.VIGION_GATEWAY_QUEUE ?? './gateway-queue.json');
const eventQueue = new LocalQueue(
  process.env.VIGION_EVENT_QUEUE ?? './gateway-events.json',
  Number(process.env.VIGION_EVENT_QUEUE_LIMIT ?? 1000),
  Number(process.env.VIGION_EVENT_TTL_SECONDS ?? 86_400) * 1000,
);
const connectors = new ConnectorRegistry();
connectors.register(new RtspConnector());
connectors.register(new PreparedConnector('ONVIF'));

interface Config {
  gatewayId: string;
  secret: string;
  heartbeatIntervalSeconds: number;
  encryptionPrivateKey: string;
  encryptionPublicKey: string;
}
const request = async <T>(path: string, init: RequestInit, config?: Config): Promise<T> => {
  const response = await fetch(`${cloudUrl}/api/v1/gateway-agent${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(config ? { authorization: `Gateway ${config.gatewayId}.${config.secret}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(`Cloud request failed (${response.status})`);
  return response.json() as Promise<T>;
};
const loadConfig = async (): Promise<Config | null> => {
  try {
    const stored = JSON.parse(await readFile(configFile, 'utf8')) as Partial<Config>;
    if (!stored.gatewayId || !stored.secret || !stored.heartbeatIntervalSeconds) return null;
    if (!stored.encryptionPrivateKey || !stored.encryptionPublicKey) {
      const keys = encryptionKeys();
      const upgraded = { ...stored, ...keys } as Config;
      await saveConfig(upgraded);
      return upgraded;
    }
    return stored as Config;
  } catch {
    return null;
  }
};
const encryptionKeys = () => {
  const pair = generateKeyPairSync('x25519');
  return {
    encryptionPrivateKey: pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    encryptionPublicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
};
const saveConfig = async (config: Config) => {
  await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  await chmod(configFile, 0o600);
};
const claim = async (): Promise<Config> => {
  const pairingCode = process.env.VIGION_PAIRING_CODE;
  if (!pairingCode) throw new Error('VIGION_PAIRING_CODE is required for first installation');
  const keys = encryptionKeys();
  const result = await request<{
    credential: { gatewayId: string; secret: string };
    heartbeatIntervalSeconds: number;
  }>('/claim', {
    method: 'POST',
    body: JSON.stringify({
      pairingCode,
      name: process.env.VIGION_GATEWAY_NAME ?? 'Gateway principal',
      version: '0.1.0',
      protocolVersion: '1',
      encryptionPublicKey: keys.encryptionPublicKey,
    }),
  });
  const config = {
    ...result.credential,
    heartbeatIntervalSeconds: result.heartbeatIntervalSeconds,
    ...keys,
  };
  await saveConfig(config);
  return config;
};
const uploadMedia = async (config: Config, sessionId: string, name: string, data: Buffer) => {
  const response = await fetch(
    `${cloudUrl}/api/v1/gateway-agent/stream-media/${sessionId}/${name}`,
    {
      method: 'PUT',
      headers: {
        authorization: `Gateway ${config.gatewayId}.${config.secret}`,
        'content-type': name.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t',
      },
      body: data,
    },
  );
  if (!response.ok) throw new Error(`Media upload failed (${response.status})`);
};
const uploadAsset = async (
  config: Config,
  assetId: string,
  uploadPath: string,
  data: Buffer,
  checksum: string,
) => {
  const response = await fetch(`${cloudUrl}/api/v1/gateway-agent${uploadPath}`, {
    method: 'PUT',
    headers: {
      authorization: `Gateway ${config.gatewayId}.${config.secret}`,
      'content-type': 'application/octet-stream',
      'x-content-sha256': checksum,
    },
    body: data,
  });
  if (!response.ok) throw new Error(`Asset upload failed (${response.status})`);
};
const reportAssetFailure = async (config: Config, assetId: string, errorCode: string) => {
  await request(
    `/media-assets/${assetId}/failure`,
    { method: 'POST', body: JSON.stringify({ errorCode }) },
    config,
  );
};
const processCommands = async (
  config: Config,
  streams: StreamManager,
  captures: CaptureManager,
) => {
  const { commands } = await request<{
    commands: Array<{ commandId: string; type: string; payload: unknown }>;
  }>('/commands', { method: 'GET' }, config);
  for (const command of commands) {
    let status: ConnectionTestResult | 'UNSUPPORTED_CODEC' | 'LOCAL_STORAGE_LIMIT_REACHED' =
      'FAILED';
    if (command.type === 'TEST_CAMERA') {
      const payload = command.payload as { protocol?: string };
      status = await connectors.get(payload.protocol ?? 'UNKNOWN').testConnection();
    } else if (command.type === 'START_STREAM') {
      const payload = command.payload as {
        streamSessionId: string;
        cameraId: string;
        encryptedSource: EncryptedStreamSource;
      };
      const connector = connectors.get('RTSP');
      if (!('createStreamSource' in connector)) status = 'UNSUPPORTED_PROTOCOL';
      else
        status = await streams.start(
          payload.streamSessionId,
          payload.cameraId,
          (connector as StreamSourceConnector).createStreamSource(
            decryptStreamSource(config.encryptionPrivateKey, payload.encryptedSource),
          ),
        );
    } else if (command.type === 'STOP_STREAM') {
      const payload = command.payload as { streamSessionId: string };
      await streams.stop(payload.streamSessionId);
      status = 'SUCCESS';
    } else if (command.type === 'CAPTURE_SNAPSHOT' || command.type === 'START_RECORDING') {
      const payload = command.payload as {
        assetId: string;
        cameraId: string;
        encryptedSource: EncryptedStreamSource;
        uploadPath: string;
        maxBytes: string;
        maxDurationSeconds?: number;
      };
      const source = decryptStreamSource(config.encryptionPrivateKey, payload.encryptedSource);
      try {
        status =
          command.type === 'CAPTURE_SNAPSHOT'
            ? await captures.snapshot(
                payload.assetId,
                source,
                payload.uploadPath,
                Number(payload.maxBytes),
              )
            : await captures.startRecording(
                payload.assetId,
                source,
                payload.uploadPath,
                Number(payload.maxBytes),
                payload.maxDurationSeconds ?? 60,
              );
      } catch (error) {
        status =
          error instanceof Error && error.message === 'LOCAL_STORAGE_LIMIT_REACHED'
            ? 'LOCAL_STORAGE_LIMIT_REACHED'
            : 'FAILED';
      }
    } else if (command.type === 'STOP_RECORDING') {
      const payload = command.payload as { assetId: string };
      status = await captures.stopRecording(payload.assetId);
    }
    await queue.enqueue({ messageId: randomUUID(), commandId: command.commandId, status });
  }
};
const run = async () => {
  const config = (await loadConfig()) ?? (await claim());
  const streams = new StreamManager((sessionId, name, data) =>
    uploadMedia(config, sessionId, name, data),
  );
  const captures = new CaptureManager(
    (assetId, uploadPath, data, checksum) =>
      uploadAsset(config, assetId, uploadPath, data, checksum),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    (assetId, errorCode) => reportAssetFailure(config, assetId, errorCode),
  );
  const monitors = new MotionMonitorManager(
    (event: EdgeEvent) => eventQueue.enqueue(event),
    (source) => decryptStreamSource(config.encryptionPrivateKey, source),
  );
  const shutdown = () => {
    void Promise.all([streams.cleanup(), captures.cleanup(), monitors.cleanup()]).finally(() =>
      process.exit(0),
    );
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  let failures = 0;
  const startedAt = Date.now();
  for (;;) {
    try {
      await request(
        '/heartbeat',
        {
          method: 'POST',
          body: JSON.stringify({
            messageId: randomUUID(),
            version: '0.1.0',
            protocolVersion: '1',
            timestamp: new Date().toISOString(),
            uptime: Math.floor((Date.now() - startedAt) / 1000),
            status: failures ? 'CONNECTING' : 'ONLINE',
            encryptionPublicKey: config.encryptionPublicKey,
          }),
        },
        config,
      );
      await processCommands(config, streams, captures);
      const monitoring = await request<{ cameras: MonitoringConfiguration[] }>(
        '/monitoring-config',
        { method: 'GET' },
        config,
      );
      await monitors.sync(monitoring.cameras);
      await captures.flush();
      await queue.flush((payload) =>
        request('/commands/ack', { method: 'POST', body: JSON.stringify(payload) }, config),
      );
      await eventQueue.flush((payload) =>
        request('/events', { method: 'POST', body: JSON.stringify(payload) }, config),
      );
      failures = 0;
      await new Promise((resolve) => setTimeout(resolve, config.heartbeatIntervalSeconds * 1000));
    } catch (error) {
      failures += 1;
      console.error(
        JSON.stringify({
          event: 'gateway.disconnected',
          attempt: failures,
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      );
      const backoff = Math.min(60_000, 1000 * 2 ** Math.min(failures, 6));
      await new Promise((resolve) =>
        setTimeout(resolve, backoff + Math.floor(Math.random() * 500)),
      );
    }
  }
};
void run();
