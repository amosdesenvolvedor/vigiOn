import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import { checkOnvifHealth } from './camera-verifier';
import {
  decryptStreamSource,
  type EncryptedStreamSource,
  type RtspSource,
} from './stream-envelope';

export type HealthCheck = 'OK' | 'FAILED' | 'AUTHENTICATION_ERROR' | 'PROTOCOL_ERROR' | 'SKIPPED';
export type HealthResult = {
  cameraId: string;
  generation: number;
  sequence: number;
  observedAt: string;
  status: 'ONLINE' | 'DEGRADED' | 'OFFLINE' | 'AUTHENTICATION_ERROR' | 'UNSUPPORTED';
  checks: { onvif: HealthCheck; rtsp: HealthCheck };
  consecutiveFailures: number;
  failureCode?: string;
  observedTarget?: {
    address: string;
    servicePort: number;
    evidence: 'ONVIF_ENDPOINT_REFERENCE_EXACT';
  };
};
export type HealthConfiguration = {
  cameraId: string;
  generation: number;
  healthProfile: {
    onvif: boolean;
    rtsp: boolean;
    normalIntervalSeconds: number;
    failureThreshold: number;
    maxBackoffSeconds: number;
  };
  identity: { endpointReference?: string; manufacturer?: string; model?: string };
  encryptedSource: EncryptedStreamSource;
};
type Runtime = HealthConfiguration & {
  source: RtspSource;
  sequence: number;
  failures: number;
  nextCheckAt: number;
  checking: boolean;
  rediscoveryAttempted: boolean;
};
type Checkers = { onvif: typeof checkOnvifHealth; rtsp: typeof checkRtspHealth };
type Rediscover = (
  identity: HealthConfiguration['identity'],
) => Promise<{ address: string; servicePort: number } | null>;

const digest = (challenge: string, source: RtspSource, uri: string) => {
  const params = Object.fromEntries(
    [...challenge.matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g)].map((match) => [
      match[1]!.toLowerCase(),
      match[2] ?? match[3] ?? '',
    ]),
  );
  if (!params.realm || !params.nonce) return null;
  const md5 = (value: string) => createHash('md5').update(value).digest('hex');
  const response = md5(
    `${md5(`${source.username}:${params.realm}:${source.password}`)}:${params.nonce}:${md5(`OPTIONS:${uri}`)}`,
  );
  return `Digest username="${source.username.replace(/["\\]/g, '')}", realm="${params.realm}", nonce="${params.nonce}", uri="${uri}", response="${response}"`;
};

export const checkRtspHealth = (source: RtspSource, signal: AbortSignal) =>
  new Promise<HealthCheck>((resolve) => {
    const socket = connect({ host: source.stream.host, port: source.stream.port });
    const uri = `rtsp://${source.stream.host}:${source.stream.port}${source.stream.path}`;
    let buffer = '';
    let retried = false;
    let settled = false;
    const finish = (result: HealthCheck) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    const send = (authorization?: string) =>
      socket.write(
        `OPTIONS ${uri} RTSP/1.0\r\nCSeq: ${retried ? 2 : 1}\r\n${authorization ? `Authorization: ${authorization}\r\n` : ''}\r\n`,
      );
    const abort = () => finish('FAILED');
    signal.addEventListener('abort', abort, { once: true });
    socket.setTimeout(3_000);
    socket.once('connect', () => send());
    socket.on('timeout', () => finish('FAILED'));
    socket.on('error', () => finish('FAILED'));
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      if (buffer.length > 32_768) return finish('PROTOCOL_ERROR');
      if (!buffer.includes('\r\n\r\n')) return;
      const status = Number(buffer.match(/^RTSP\/\d\.\d\s+(\d+)/)?.[1]);
      if (status === 401 && !retried) {
        const challenge = buffer.match(/WWW-Authenticate:\s*(Basic|Digest)\s+([^\r\n]+)/i);
        if (!challenge) return finish('AUTHENTICATION_ERROR');
        retried = true;
        buffer = '';
        const authorization =
          challenge[1]!.toLowerCase() === 'basic'
            ? `Basic ${Buffer.from(`${source.username}:${source.password}`).toString('base64')}`
            : digest(challenge[2]!, source, uri);
        return authorization ? send(authorization) : finish('AUTHENTICATION_ERROR');
      }
      if (status === 401 || status === 403) return finish('AUTHENTICATION_ERROR');
      finish(status >= 200 && status < 400 ? 'OK' : 'PROTOCOL_ERROR');
    });
  });

export class CameraHealthManager {
  private readonly runtime = new Map<string, Runtime>();
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private active = 0;
  constructor(
    private readonly privateKey: string,
    private readonly emit: (result: HealthResult) => Promise<void>,
    private readonly now = () => Date.now(),
    private readonly random = Math.random,
    private readonly concurrency = 4,
    private readonly checkers: Checkers = { onvif: checkOnvifHealth, rtsp: checkRtspHealth },
    private readonly rediscover?: Rediscover,
  ) {}

  sync(configurations: HealthConfiguration[]) {
    const desired = new Set(configurations.map((item) => item.cameraId));
    for (const id of this.runtime.keys()) if (!desired.has(id)) this.runtime.delete(id);
    for (const configuration of configurations) {
      const current = this.runtime.get(configuration.cameraId);
      if (current?.generation === configuration.generation) continue;
      const source = decryptStreamSource(this.privateKey, configuration.encryptedSource);
      this.runtime.set(configuration.cameraId, {
        ...configuration,
        source,
        sequence: 0,
        failures: 0,
        nextCheckAt: this.now() + Math.floor(this.random() * 5_000),
        checking: false,
        rediscoveryAttempted: false,
      });
    }
    this.schedule();
  }

  async checkNow(cameraId: string) {
    const item = this.runtime.get(cameraId);
    if (!item || item.checking) return false;
    item.nextCheckAt = this.now();
    await this.run(item);
    return true;
  }
  unregister(cameraId: string) {
    this.runtime.delete(cameraId);
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.runtime.clear();
  }

  private schedule(delay = 500) {
    if (this.stopped || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, delay);
    this.timer.unref();
  }
  private async tick() {
    const due = [...this.runtime.values()].filter(
      (item) => !item.checking && item.nextCheckAt <= this.now(),
    );
    for (const item of due.slice(0, Math.max(0, this.concurrency - this.active)))
      void this.run(item);
    this.schedule();
  }
  private async run(item: Runtime) {
    item.checking = true;
    this.active += 1;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const onvif = item.healthProfile.onvif
        ? await this.checkers.onvif(
            { address: item.source.stream.host, port: item.source.stream.port },
            item.source,
            controller.signal,
          )
        : 'SKIPPED';
      const rtsp = item.healthProfile.rtsp
        ? await this.checkers.rtsp(item.source, controller.signal)
        : 'SKIPPED';
      const required = [onvif, rtsp].filter((value) => value !== 'SKIPPED');
      const auth = required.includes('AUTHENTICATION_ERROR');
      const successes = required.filter((value) => value === 'OK').length;
      const failed = successes === 0;
      item.failures = failed ? Math.min(1000, item.failures + 1) : 0;
      if (!failed) item.rediscoveryAttempted = false;
      const status = auth
        ? 'AUTHENTICATION_ERROR'
        : !required.length
          ? 'UNSUPPORTED'
          : successes === required.length
            ? 'ONLINE'
            : successes > 0
              ? 'DEGRADED'
              : item.failures >= item.healthProfile.failureThreshold
                ? 'OFFLINE'
                : 'DEGRADED';
      item.sequence += 1;
      let observedTarget: HealthResult['observedTarget'];
      if (
        failed &&
        item.failures >= item.healthProfile.failureThreshold &&
        !item.rediscoveryAttempted &&
        item.identity.endpointReference &&
        this.rediscover
      ) {
        item.rediscoveryAttempted = true;
        const target = await this.rediscover(item.identity);
        if (target && target.address !== item.source.stream.host) {
          item.source.stream.host = target.address;
          item.source.stream.port = target.servicePort;
          observedTarget = { ...target, evidence: 'ONVIF_ENDPOINT_REFERENCE_EXACT' };
        }
      }
      await this.emit({
        cameraId: item.cameraId,
        generation: item.generation,
        sequence: item.sequence,
        observedAt: new Date(this.now()).toISOString(),
        status,
        checks: { onvif, rtsp },
        consecutiveFailures: item.failures,
        ...(observedTarget ? { observedTarget } : {}),
        ...(status !== 'ONLINE'
          ? { failureCode: auth ? 'AUTHENTICATION_REJECTED' : 'HEALTH_CHECK_FAILED' }
          : {}),
      });
      const base = item.healthProfile.normalIntervalSeconds * 1000;
      const backoff = item.failures
        ? Math.min(
            item.healthProfile.maxBackoffSeconds * 1000,
            15_000 * 2 ** Math.min(item.failures - 1, 4),
          )
        : base;
      item.nextCheckAt =
        this.now() + backoff + Math.floor(this.random() * Math.min(10_000, backoff / 4));
    } finally {
      clearTimeout(timeout);
      item.checking = false;
      this.active -= 1;
    }
  }
}
