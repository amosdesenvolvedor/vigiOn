import { chmod, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  ConnectorRegistry,
  PreparedConnector,
  type ConnectionTestResult,
} from './connectors/camera-connector';
import { LocalQueue } from './local-queue';

const cloudUrl = process.env.VIGION_CLOUD_URL ?? 'https://vigion.cloud';
if (process.env.NODE_ENV === 'production' && !cloudUrl.startsWith('https://'))
  throw new Error('Production gateway requires HTTPS');
const configFile = process.env.VIGION_GATEWAY_CONFIG ?? './gateway-config.json';
const queue = new LocalQueue(process.env.VIGION_GATEWAY_QUEUE ?? './gateway-queue.json');
const connectors = new ConnectorRegistry();
connectors.register(new PreparedConnector('RTSP'));
connectors.register(new PreparedConnector('ONVIF'));

interface Config {
  gatewayId: string;
  secret: string;
  heartbeatIntervalSeconds: number;
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
    return JSON.parse(await readFile(configFile, 'utf8')) as Config;
  } catch {
    return null;
  }
};
const claim = async (): Promise<Config> => {
  const pairingCode = process.env.VIGION_PAIRING_CODE;
  if (!pairingCode) throw new Error('VIGION_PAIRING_CODE is required for first installation');
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
    }),
  });
  const config = {
    ...result.credential,
    heartbeatIntervalSeconds: result.heartbeatIntervalSeconds,
  };
  await writeFile(configFile, JSON.stringify(config), { mode: 0o600 });
  await chmod(configFile, 0o600);
  return config;
};
const processCommands = async (config: Config) => {
  const { commands } = await request<{
    commands: Array<{ commandId: string; type: string; payload: unknown }>;
  }>('/commands', { method: 'GET' }, config);
  for (const command of commands) {
    let status: ConnectionTestResult = 'FAILED';
    if (command.type === 'TEST_CAMERA') {
      const payload = command.payload as { protocol?: string };
      status = await connectors.get(payload.protocol ?? 'UNKNOWN').testConnection();
    }
    await queue.enqueue({ messageId: randomUUID(), commandId: command.commandId, status });
  }
};
const run = async () => {
  const config = (await loadConfig()) ?? (await claim());
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
          }),
        },
        config,
      );
      await processCommands(config);
      await queue.flush((payload) =>
        request('/commands/ack', { method: 'POST', body: JSON.stringify(payload) }, config),
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
