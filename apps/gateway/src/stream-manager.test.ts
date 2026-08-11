import type { ChildProcessByStdio } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import { PassThrough, type Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { StreamManager } from './stream-manager';

describe('gateway StreamManager', () => {
  it('starts one process per camera, reuses it and leaves no orphan after STOP', async () => {
    const uploads: string[] = [];
    let spawns = 0;
    const fakeSpawn = (_command: string, args: string[]) => {
      spawns += 1;
      const emitter = new EventEmitter() as EventEmitter & {
        stderr: PassThrough;
        exitCode: number | null;
        kill(signal?: NodeJS.Signals): boolean;
      };
      emitter.stderr = new PassThrough();
      emitter.exitCode = null;
      emitter.kill = () => {
        emitter.exitCode = 0;
        emitter.emit('exit', 0, null);
        return true;
      };
      const playlist = args.at(-1)!;
      const segmentTemplate = args[args.indexOf('-hls_segment_filename') + 1]!;
      void mkdir(requireDirectory(playlist), { recursive: true }).then(async () => {
        await writeFile(segmentTemplate.replace('%08d', '00000000'), Buffer.from('segment'));
        await writeFile(
          playlist,
          '#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nsegment-00000000.ts\n',
        );
      });
      return emitter as unknown as ChildProcessByStdio<null, null, Readable>;
    };
    const manager = new StreamManager(
      async (session, name) => {
        uploads.push(`${session}:${name}`);
      },
      2,
      2000,
      'ffmpeg-test',
      fakeSpawn,
    );
    const source = {
      username: 'user',
      password: 'password',
      stream: { host: '192.168.1.2', port: 554, path: '/live', transport: 'tcp' as const },
    };
    await expect(manager.start('session-1', 'camera-1', source)).resolves.toBe('SUCCESS');
    await expect(manager.start('session-2', 'camera-1', source)).resolves.toBe('SUCCESS');
    expect(spawns).toBe(1);
    expect(manager.activePipelineCount()).toBe(1);
    expect(uploads).toContain('session-1:index.m3u8');
    expect(uploads).toContain('session-2:index.m3u8');
    await manager.stop('session-1');
    expect(manager.activePipelineCount()).toBe(1);
    await manager.stop('session-2');
    expect(manager.activePipelineCount()).toBe(0);
  });

  it('rejects resource exhaustion without spawning unlimited processes', async () => {
    const manager = new StreamManager(async () => undefined, 0, 10, 'ffmpeg-test');
    await expect(
      manager.start('session', 'camera', {
        username: 'u',
        password: 'p',
        stream: { host: 'camera.local', port: 554, path: '/live', transport: 'tcp' },
      }),
    ).resolves.toBe('FAILED');
    expect(manager.activePipelineCount()).toBe(0);
  });

  it('cleans up the process when media upload fails during startup', async () => {
    const manager = new StreamManager(
      async () => {
        throw new Error('controlled upload failure');
      },
      1,
      2000,
      'ffmpeg-test',
      (_command, args) => fakeMediaProcess(args),
    );
    await expect(
      manager.start('session', 'camera', {
        username: 'u',
        password: 'p',
        stream: { host: 'camera.local', port: 554, path: '/live', transport: 'tcp' },
      }),
    ).resolves.toBe('FAILED');
    expect(manager.activePipelineCount()).toBe(0);
  });
});

const requireDirectory = (file: string) => file.slice(0, file.lastIndexOf('/'));
const fakeMediaProcess = (args: string[]) => {
  const emitter = new EventEmitter() as EventEmitter & {
    stderr: PassThrough;
    exitCode: number | null;
    kill(signal?: NodeJS.Signals): boolean;
  };
  emitter.stderr = new PassThrough();
  emitter.exitCode = null;
  emitter.kill = () => {
    emitter.exitCode = 0;
    emitter.emit('exit', 0, null);
    return true;
  };
  const playlist = args.at(-1)!;
  const segmentTemplate = args[args.indexOf('-hls_segment_filename') + 1]!;
  void mkdir(requireDirectory(playlist), { recursive: true }).then(async () => {
    await writeFile(segmentTemplate.replace('%08d', '00000000'), Buffer.from('segment'));
    await writeFile(playlist, '#EXTM3U\n#EXTINF:1,\nsegment-00000000.ts\n');
  });
  return emitter as unknown as ChildProcessByStdio<null, null, Readable>;
};
