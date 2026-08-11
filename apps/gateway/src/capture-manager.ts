import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import type { Readable } from 'node:stream';
import path from 'node:path';
import type { RtspSource } from './stream-envelope';

type MediaProcess = ChildProcessByStdio<null, null, Readable>;
type SpawnProcess = (command: string, args: string[]) => MediaProcess;
type Upload = (
  assetId: string,
  uploadPath: string,
  data: Buffer,
  checksum: string,
) => Promise<void>;
type ReportFailure = (assetId: string, errorCode: string) => Promise<void>;
interface PendingUpload {
  assetId: string;
  uploadPath: string;
  file: string;
  createdAt: number;
  attempts: number;
  nextAttemptAt?: number;
}
interface Recording {
  assetId: string;
  process: MediaProcess;
  file: string;
  uploadPath: string;
}

export class CaptureManager {
  private readonly recordings = new Map<string, Recording>();
  private readonly completed = new Set<string>();
  constructor(
    private readonly upload: Upload,
    private readonly staging = process.env.VIGION_MEDIA_STAGING ?? './gateway-media',
    private readonly maxStagingBytes = Number(
      process.env.VIGION_MEDIA_STAGING_MAX_BYTES ?? 536_870_912,
    ),
    private readonly maxAttempts = Number(process.env.VIGION_UPLOAD_MAX_ATTEMPTS ?? 8),
    private readonly ttlMs = Number(process.env.VIGION_UPLOAD_TTL_SECONDS ?? 86_400) * 1000,
    private readonly ffmpeg = process.env.VIGION_FFMPEG_PATH ?? 'ffmpeg',
    private readonly spawnProcess: SpawnProcess = (command, args) =>
      spawn(command, args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'] }),
    private readonly reportFailure: ReportFailure = async () => undefined,
  ) {}

  async snapshot(assetId: string, source: RtspSource, uploadPath: string, maxBytes: number) {
    if (this.completed.has(assetId)) return 'SUCCESS' as const;
    await this.ensureCapacity(maxBytes);
    const file = await this.file(assetId, 'jpg');
    const result = await this.run([
      ...inputArgs(source),
      '-frames:v',
      '1',
      '-q:v',
      '3',
      '-f',
      'image2',
      file,
    ]);
    if (result !== 'SUCCESS') {
      await rm(file, { force: true });
      return result;
    }
    if ((await stat(file)).size > maxBytes) {
      await rm(file, { force: true });
      return 'LOCAL_STORAGE_LIMIT_REACHED' as const;
    }
    await this.enqueue({ assetId, uploadPath, file, createdAt: Date.now(), attempts: 0 });
    await this.flush();
    this.completed.add(assetId);
    return 'SUCCESS' as const;
  }

  async startRecording(
    assetId: string,
    source: RtspSource,
    uploadPath: string,
    maxBytes: number,
    durationSeconds: number,
  ) {
    if (this.recordings.has(assetId) || this.completed.has(assetId)) return 'SUCCESS' as const;
    await this.ensureCapacity(maxBytes);
    const file = await this.file(assetId, 'mp4');
    let process: MediaProcess;
    try {
      process = this.spawnProcess(this.ffmpeg, [
        ...inputArgs(source),
        '-map',
        '0:v:0',
        '-an',
        '-c:v',
        'copy',
        '-t',
        String(durationSeconds),
        '-movflags',
        '+faststart',
        '-f',
        'mp4',
        file,
      ]);
    } catch {
      return 'FAILED' as const;
    }
    const recording = { assetId, process, file, uploadPath };
    this.recordings.set(assetId, recording);
    process.once('exit', () => {
      void this.finish(recording, maxBytes);
    });
    return 'SUCCESS' as const;
  }
  async stopRecording(assetId: string) {
    const recording = this.recordings.get(assetId);
    if (!recording) return 'SUCCESS' as const;
    if (recording.process.exitCode === null) recording.process.kill('SIGINT');
    return 'SUCCESS' as const;
  }
  async flush() {
    await mkdir(this.staging, { recursive: true, mode: 0o700 });
    const metadata = (await readdir(this.staging)).filter((name) =>
      /^[0-9a-f-]{36}\.json$/.test(name),
    );
    for (const name of metadata) {
      const metaFile = path.join(this.staging, name);
      let item: PendingUpload;
      try {
        item = JSON.parse(await readFile(metaFile, 'utf8')) as PendingUpload;
      } catch {
        continue;
      }
      if (Date.now() - item.createdAt > this.ttlMs) {
        await rm(item.file, { force: true });
        await rm(metaFile, { force: true });
        continue;
      }
      if (item.attempts >= this.maxAttempts || (item.nextAttemptAt ?? 0) > Date.now()) continue;
      try {
        const data = await readFile(item.file);
        await this.upload(
          item.assetId,
          item.uploadPath,
          data,
          createHash('sha256').update(data).digest('hex'),
        );
        await rm(item.file, { force: true });
        await rm(metaFile, { force: true });
        this.completed.add(item.assetId);
      } catch {
        item.attempts += 1;
        item.nextAttemptAt =
          Date.now() +
          Math.min(60_000, 1000 * 2 ** item.attempts) +
          Math.floor(Math.random() * 500);
        await writeFile(metaFile, JSON.stringify(item), { mode: 0o600 });
        if (item.attempts >= this.maxAttempts)
          await this.reportFailure(item.assetId, 'UPLOAD_RETRY_EXHAUSTED').catch(() => undefined);
      }
    }
  }
  async cleanup() {
    for (const recording of this.recordings.values())
      if (recording.process.exitCode === null) recording.process.kill('SIGINT');
    await this.flush();
  }
  activeRecordingCount() {
    return this.recordings.size;
  }

  private async finish(recording: Recording, maxBytes: number) {
    if (this.recordings.get(recording.assetId) !== recording) return;
    this.recordings.delete(recording.assetId);
    try {
      const size = (await stat(recording.file)).size;
      if (!size || size > maxBytes) throw new Error('Invalid recording size');
      await this.enqueue({
        assetId: recording.assetId,
        uploadPath: recording.uploadPath,
        file: recording.file,
        createdAt: Date.now(),
        attempts: 0,
      });
      await this.flush();
    } catch {
      await rm(recording.file, { force: true });
    }
  }
  private async enqueue(item: PendingUpload) {
    await writeFile(path.join(this.staging, `${item.assetId}.json`), JSON.stringify(item), {
      mode: 0o600,
    });
  }
  private async ensureCapacity(reservation: number) {
    await mkdir(this.staging, { recursive: true, mode: 0o700 });
    let used = 0;
    for (const name of await readdir(this.staging)) {
      try {
        const info = await stat(path.join(this.staging, name));
        if (info.isFile()) used += info.size;
      } catch {
        /* raced cleanup */
      }
    }
    if (used + reservation > this.maxStagingBytes) throw new Error('LOCAL_STORAGE_LIMIT_REACHED');
  }
  private async file(assetId: string, extension: 'jpg' | 'mp4') {
    await mkdir(this.staging, { recursive: true, mode: 0o700 });
    return path.join(this.staging, `${assetId}-${randomUUID()}.${extension}`);
  }
  private run(args: string[]) {
    return new Promise<'SUCCESS' | 'FAILED'>((resolve) => {
      let process: MediaProcess;
      try {
        process = this.spawnProcess(this.ffmpeg, args);
      } catch {
        resolve('FAILED');
        return;
      }
      process.once('exit', (code) => resolve(code === 0 ? 'SUCCESS' : 'FAILED'));
      process.once('error', () => resolve('FAILED'));
    });
  }
}

const inputArgs = (source: RtspSource) => [
  '-hide_banner',
  '-loglevel',
  'error',
  '-rtsp_transport',
  source.stream.transport,
  '-i',
  rtspUrl(source),
];
const rtspUrl = (source: RtspSource) => {
  const { host, port, path: streamPath } = source.stream;
  if (
    !/^(?!.*[/@?#\s])(?:\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)$/.test(host) ||
    !/^\/(?!\/)[^\s?#]*$/.test(streamPath) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw new Error('Invalid source');
  return `rtsp://${encodeURIComponent(source.username)}:${encodeURIComponent(source.password)}@${host}:${port}${streamPath}`;
};
