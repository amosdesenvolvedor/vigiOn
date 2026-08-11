import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { mkdtemp, readdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { RtspSource } from './stream-envelope';

export type StreamStartResult =
  | 'SUCCESS'
  | 'FAILED'
  | 'TIMEOUT'
  | 'AUTHENTICATION_ERROR'
  | 'UNSUPPORTED_CODEC';
type Upload = (sessionId: string, name: string, data: Buffer) => Promise<void>;
type MediaProcess = ChildProcessByStdio<null, null, Readable>;
type SpawnProcess = (command: string, args: string[]) => MediaProcess;
interface Pipeline {
  cameraId: string;
  directory: string;
  process: MediaProcess;
  sessions: Set<string>;
  uploaded: Map<string, number>;
  uploader?: ReturnType<typeof setInterval>;
  stderr: string;
}

export class StreamManager {
  private readonly pipelines = new Map<string, Pipeline>();
  private readonly sessionCamera = new Map<string, string>();
  constructor(
    private readonly upload: Upload,
    private readonly maxStreams = Number(process.env.VIGION_MAX_STREAMS ?? 4),
    private readonly startTimeoutMs = Number(
      process.env.VIGION_STREAM_START_TIMEOUT_SECONDS ?? 30,
    ) * 1000,
    private readonly ffmpegPath = process.env.VIGION_FFMPEG_PATH ?? 'ffmpeg',
    private readonly spawnProcess: SpawnProcess = (command, args) =>
      spawn(command, args, { shell: false, stdio: ['ignore', 'ignore', 'pipe'] }),
  ) {}

  async start(sessionId: string, cameraId: string, source: RtspSource): Promise<StreamStartResult> {
    const existingCamera = this.sessionCamera.get(sessionId);
    if (existingCamera) return existingCamera === cameraId ? 'SUCCESS' : 'FAILED';
    const existing = this.pipelines.get(cameraId);
    if (existing) {
      existing.sessions.add(sessionId);
      this.sessionCamera.set(sessionId, cameraId);
      await this.uploadFiles(existing, sessionId);
      return 'SUCCESS';
    }
    if (this.pipelines.size >= this.maxStreams) return 'FAILED';
    const directory = await mkdtemp(path.join(tmpdir(), 'vigioni-stream-'));
    const input = this.rtspUrl(source);
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-rtsp_transport',
      source.stream.transport,
      '-i',
      input,
      '-map',
      '0:v:0',
      '-an',
      '-c:v',
      'copy',
      '-f',
      'hls',
      '-hls_time',
      '1',
      '-hls_list_size',
      '6',
      '-hls_flags',
      'delete_segments+omit_endlist+independent_segments',
      '-hls_segment_filename',
      path.join(directory, 'segment-%08d.ts'),
      path.join(directory, 'index.m3u8'),
    ];
    let process: MediaProcess;
    try {
      process = this.spawnProcess(this.ffmpegPath, args);
    } catch {
      await rm(directory, { recursive: true, force: true });
      return 'FAILED';
    }
    const pipeline: Pipeline = {
      cameraId,
      directory,
      process,
      sessions: new Set([sessionId]),
      uploaded: new Map(),
      stderr: '',
    };
    this.pipelines.set(cameraId, pipeline);
    this.sessionCamera.set(sessionId, cameraId);
    process.stderr.on('data', (chunk: Buffer) => {
      pipeline.stderr = `${pipeline.stderr}${chunk.toString('utf8')}`.slice(-4000);
    });
    process.once('exit', () => {
      if (this.pipelines.get(cameraId) === pipeline) void this.destroy(pipeline);
    });
    pipeline.uploader = setInterval(() => {
      void this.uploadFiles(pipeline).catch(() => undefined);
    }, 500);
    let result: StreamStartResult;
    try {
      result = await this.waitForPlaylist(pipeline);
    } catch {
      result = 'FAILED';
    }
    if (result !== 'SUCCESS') await this.stop(sessionId);
    return result;
  }

  async stop(sessionId: string) {
    const cameraId = this.sessionCamera.get(sessionId);
    if (!cameraId) return;
    this.sessionCamera.delete(sessionId);
    const pipeline = this.pipelines.get(cameraId);
    if (!pipeline) return;
    pipeline.sessions.delete(sessionId);
    if (!pipeline.sessions.size) await this.destroy(pipeline);
  }

  async cleanup() {
    await Promise.all([...this.pipelines.values()].map((item) => this.destroy(item)));
  }
  activePipelineCount() {
    return this.pipelines.size;
  }

  private rtspUrl(source: RtspSource) {
    const host = source.stream.host;
    if (!/^(?!.*[/@?#\s])(?:\[[0-9a-fA-F:]+\]|[a-zA-Z0-9.-]+)$/.test(host))
      throw new Error('Invalid source');
    if (!/^\/(?!\/)[^\s?#]*$/.test(source.stream.path)) throw new Error('Invalid source');
    if (
      !Number.isInteger(source.stream.port) ||
      source.stream.port < 1 ||
      source.stream.port > 65535
    )
      throw new Error('Invalid source');
    return `rtsp://${encodeURIComponent(source.username)}:${encodeURIComponent(source.password)}@${host}:${source.stream.port}${source.stream.path}`;
  }
  private async waitForPlaylist(pipeline: Pipeline): Promise<StreamStartResult> {
    const started = Date.now();
    while (Date.now() - started < this.startTimeoutMs) {
      if (pipeline.process.exitCode !== null) return this.classify(pipeline.stderr);
      let playlistReady = false;
      try {
        playlistReady = (await stat(path.join(pipeline.directory, 'index.m3u8'))).size > 0;
      } catch {
        /* waiting */
      }
      if (playlistReady) {
        await this.uploadFiles(pipeline);
        return 'SUCCESS';
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return 'TIMEOUT';
  }
  private classify(stderr: string): StreamStartResult {
    const safe = stderr.toLowerCase();
    if (safe.includes('401 unauthorized') || safe.includes('authentication'))
      return 'AUTHENTICATION_ERROR';
    if (safe.includes('hevc') || safe.includes('h265') || safe.includes('codec not supported'))
      return 'UNSUPPORTED_CODEC';
    return 'FAILED';
  }
  private async uploadFiles(pipeline: Pipeline, onlySession?: string) {
    let files: string[] = [];
    try {
      files = await readdir(pipeline.directory);
    } catch {
      return;
    }
    const selected = files.filter((name) => /^(?:index\.m3u8|segment-[0-9]{8}\.ts)$/.test(name));
    for (const name of selected.sort((a) => (a === 'index.m3u8' ? 1 : -1))) {
      const file = path.join(pipeline.directory, name);
      const modified = (await stat(file)).mtimeMs;
      const sessions = onlySession ? [onlySession] : [...pipeline.sessions];
      for (const sessionId of sessions) {
        const key = `${sessionId}:${name}`;
        if (pipeline.uploaded.get(key) === modified) continue;
        await this.upload(sessionId, name, await readFile(file));
        pipeline.uploaded.set(key, modified);
      }
    }
  }
  private async destroy(pipeline: Pipeline) {
    if (pipeline.uploader) clearInterval(pipeline.uploader);
    this.pipelines.delete(pipeline.cameraId);
    for (const session of pipeline.sessions) this.sessionCamera.delete(session);
    if (pipeline.process.exitCode === null) {
      pipeline.process.kill('SIGTERM');
      const timer = setTimeout(() => pipeline.process.kill('SIGKILL'), 3000);
      timer.unref();
    }
    await rm(pipeline.directory, { recursive: true, force: true });
  }
}
