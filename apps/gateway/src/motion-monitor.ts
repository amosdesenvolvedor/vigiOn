import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { EncryptedStreamSource, RtspSource } from './stream-envelope';
import { MotionAggregator, MotionDetector, type MotionSensitivity } from './motion-detector';

export interface MonitoringConfiguration {
  cameraId: string;
  sensitivity: MotionSensitivity;
  sampleFps: number;
  cooldownSeconds: number;
  captureSnapshot: boolean;
  updatedAt: string;
  encryptedSource: EncryptedStreamSource;
}
export interface EdgeEvent {
  messageId: string;
  eventId: string;
  protocolVersion: '1';
  cameraId: string;
  type: 'MOTION' | 'CAMERA_OFFLINE' | 'CAMERA_ONLINE';
  occurredAt: string;
  endedAt?: string;
  motionScore?: number;
}
type MediaProcess = ChildProcessByStdio<null, Readable, Readable>;
type SpawnProcess = (command: string, args: string[]) => MediaProcess;
interface Monitor {
  configuration: MonitoringConfiguration;
  process: MediaProcess;
  online: boolean;
  stopping: boolean;
}

export class MotionMonitorManager {
  private readonly monitors = new Map<string, Monitor>();
  constructor(
    private readonly emit: (event: EdgeEvent) => Promise<void>,
    private readonly decrypt: (source: EncryptedStreamSource) => RtspSource,
    private readonly width = Number(process.env.VIGION_MOTION_WIDTH ?? 320),
    private readonly height = Number(process.env.VIGION_MOTION_HEIGHT ?? 180),
    private readonly ffmpegPath = process.env.VIGION_FFMPEG_PATH ?? 'ffmpeg',
    private readonly spawnProcess: SpawnProcess = (command, args) =>
      spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] }),
  ) {}

  async sync(configurations: MonitoringConfiguration[]) {
    const requested = new Map(configurations.map((item) => [item.cameraId, item]));
    for (const [cameraId, monitor] of this.monitors)
      if (!requested.has(cameraId)) await this.stop(cameraId, monitor);
    for (const configuration of configurations) {
      const existing = this.monitors.get(configuration.cameraId);
      if (existing?.configuration.updatedAt === configuration.updatedAt) continue;
      if (existing) await this.stop(configuration.cameraId, existing);
      this.start(configuration);
    }
  }

  activeCount() {
    return this.monitors.size;
  }

  async cleanup() {
    await Promise.all([...this.monitors].map(([id, monitor]) => this.stop(id, monitor)));
  }

  private start(configuration: MonitoringConfiguration) {
    const source = this.decrypt(configuration.encryptedSource);
    const detector = new MotionDetector(configuration.sensitivity);
    const aggregator = new MotionAggregator(
      Math.max(1, configuration.cooldownSeconds * configuration.sampleFps),
      randomUUID,
    );
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-rtsp_transport',
      source.stream.transport,
      '-i',
      this.rtspUrl(source),
      '-map',
      '0:v:0',
      '-an',
      '-vf',
      `fps=${configuration.sampleFps},scale=${this.width}:${this.height},format=gray`,
      '-pix_fmt',
      'gray',
      '-f',
      'rawvideo',
      'pipe:1',
    ];
    const process = this.spawnProcess(this.ffmpegPath, args);
    const monitor: Monitor = { configuration, process, online: false, stopping: false };
    this.monitors.set(configuration.cameraId, monitor);
    const frameSize = this.width * this.height;
    let pending = Buffer.alloc(0);
    let stderr = '';
    process.stderr.on('data', (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString('utf8')}`.slice(-1000);
    });
    process.stdout.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= frameSize) {
        const frame = pending.subarray(0, frameSize);
        pending = pending.subarray(frameSize);
        if (!monitor.online) {
          monitor.online = true;
          void this.emit(this.connectivity(configuration.cameraId, 'CAMERA_ONLINE'));
        }
        const result = detector.analyze(frame);
        const transition = aggregator.update(result.motion, result.motionScore);
        if (transition)
          void this.emit({
            messageId: randomUUID(),
            eventId: transition.eventId,
            protocolVersion: '1',
            cameraId: configuration.cameraId,
            type: 'MOTION',
            occurredAt: transition.occurredAt,
            ...(transition.state === 'ENDED' ? { endedAt: transition.endedAt } : {}),
            motionScore: transition.motionScore,
          });
      }
    });
    let finalized = false;
    const finalize = () => {
      if (finalized) return;
      finalized = true;
      if (this.monitors.get(configuration.cameraId) === monitor)
        this.monitors.delete(configuration.cameraId);
      if (!monitor.stopping)
        void this.emit(this.connectivity(configuration.cameraId, 'CAMERA_OFFLINE'));
      console.info(
        JSON.stringify({
          event: 'motion.monitor_stopped',
          cameraId: configuration.cameraId,
          expected: monitor.stopping,
          ...(stderr ? { error: stderr.replaceAll(source.password, '[REDACTED]') } : {}),
        }),
      );
    };
    process.once('error', finalize);
    process.once('exit', finalize);
    console.info(
      JSON.stringify({
        event: 'motion.monitor_started',
        cameraId: configuration.cameraId,
        sampleFps: configuration.sampleFps,
      }),
    );
  }

  private connectivity(cameraId: string, type: 'CAMERA_OFFLINE' | 'CAMERA_ONLINE'): EdgeEvent {
    return {
      messageId: randomUUID(),
      eventId: randomUUID(),
      protocolVersion: '1',
      cameraId,
      type,
      occurredAt: new Date().toISOString(),
    };
  }

  private async stop(cameraId: string, monitor: Monitor) {
    monitor.stopping = true;
    this.monitors.delete(cameraId);
    if (monitor.process.exitCode === null) {
      monitor.process.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          if (monitor.process.exitCode === null) monitor.process.kill('SIGKILL');
          resolve();
        }, 3000);
        monitor.process.once('exit', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }
  }

  private rtspUrl(source: RtspSource) {
    const { host, port, path } = source.stream;
    if (
      !/^(?!.*[/@?#\s])(?:\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)$/.test(host) ||
      !/^\/(?!\/)[^\s?#]*$/.test(path) ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    )
      throw new Error('Invalid RTSP source');
    return `rtsp://${encodeURIComponent(source.username)}:${encodeURIComponent(source.password)}@${host}:${port}${path}`;
  }
}
