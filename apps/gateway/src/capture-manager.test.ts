import type { ChildProcessByStdio } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PassThrough, type Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { CaptureManager } from './capture-manager';

const directories: string[] = [];
afterEach(async () =>
  Promise.all(directories.splice(0).map((item) => rm(item, { recursive: true, force: true }))),
);
const source = {
  username: 'u',
  password: 'p',
  stream: { host: 'camera.local', port: 554, path: '/live', transport: 'tcp' as const },
};
const staging = async () => {
  const value = await mkdtemp(path.join(tmpdir(), 'vigion-capture-test-'));
  directories.push(value);
  return value;
};

describe('CaptureManager', () => {
  it('captures a JPEG, retries upload from persistent staging and cleans it on success', async () => {
    const directory = await staging();
    let attempts = 0;
    const manager = new CaptureManager(
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('offline');
      },
      directory,
      1000,
      4,
      60_000,
      'ffmpeg-test',
      (_command, args) => fakeProcess(args, 'snapshot'),
    );
    await expect(
      manager.snapshot(
        '00000000-0000-4000-8000-000000000001',
        source,
        '/media-assets/id/content',
        100,
      ),
    ).resolves.toBe('SUCCESS');
    const metadata = (await readdir(directory)).find((name) => name.endsWith('.json'))!;
    const pending = JSON.parse(await readFile(path.join(directory, metadata), 'utf8')) as object;
    await writeFile(
      path.join(directory, metadata),
      JSON.stringify({ ...pending, nextAttemptAt: 0 }),
    );
    const recovered = new CaptureManager(
      async () => {
        attempts += 1;
      },
      directory,
      1000,
      4,
      60_000,
    );
    await recovered.flush();
    expect(attempts).toBe(2);
    expect(await readdir(directory)).toEqual([]);
  });
  it('starts and stops one bounded recording without orphaning the process', async () => {
    const directory = await staging();
    const uploads: Buffer[] = [];
    const manager = new CaptureManager(
      async (_id, _path, data) => {
        uploads.push(data);
      },
      directory,
      1000,
      4,
      60_000,
      'ffmpeg-test',
      (_command, args) => fakeProcess(args, 'recording'),
    );
    await expect(
      manager.startRecording('00000000-0000-4000-8000-000000000002', source, '/upload', 500, 60),
    ).resolves.toBe('SUCCESS');
    expect(manager.activeRecordingCount()).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 30));
    await manager.stopRecording('00000000-0000-4000-8000-000000000002');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(manager.activeRecordingCount()).toBe(0);
    expect(uploads).toHaveLength(1);
  });
  it('rejects capture before spawning when staging reservation exceeds its limit', async () => {
    const directory = await staging();
    await writeFile(path.join(directory, 'occupied'), Buffer.alloc(90));
    const manager = new CaptureManager(async () => undefined, directory, 100);
    await expect(manager.snapshot('id', source, '/upload', 20)).rejects.toThrow(
      'LOCAL_STORAGE_LIMIT_REACHED',
    );
  });
});

const fakeProcess = (args: string[], kind: 'snapshot' | 'recording') => {
  const emitter = new EventEmitter() as EventEmitter & {
    stderr: PassThrough;
    exitCode: number | null;
    kill(): boolean;
  };
  emitter.stderr = new PassThrough();
  emitter.exitCode = null;
  const file = args.at(-1)!;
  void mkdir(path.dirname(file), { recursive: true }).then(async () => {
    await writeFile(
      file,
      kind === 'snapshot'
        ? Buffer.from([0xff, 0xd8, 1, 0xff, 0xd9])
        : Buffer.from([0, 0, 0, 12, ...Buffer.from('ftyp'), 1, 2, 3, 4]),
    );
    if (kind === 'snapshot') {
      emitter.exitCode = 0;
      emitter.emit('exit', 0, null);
    }
  });
  emitter.kill = () => {
    emitter.exitCode = 0;
    emitter.emit('exit', 0, null);
    return true;
  };
  return emitter as unknown as ChildProcessByStdio<null, null, Readable>;
};
