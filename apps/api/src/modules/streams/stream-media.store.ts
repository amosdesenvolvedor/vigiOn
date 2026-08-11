import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env';
import { AuthError } from '../auth/auth.errors';

const safeMediaName = /^(?:index\.m3u8|segment-[0-9]{1,8}\.ts)$/;

export class StreamMediaStore {
  private sessionDirectory(sessionId: string) {
    return path.join(env.STREAM_MEDIA_ROOT, sessionId);
  }
  private mediaPath(sessionId: string, name: string) {
    if (!safeMediaName.test(name))
      throw new AuthError(400, 'INVALID_MEDIA_NAME', 'Invalid media object');
    return path.join(this.sessionDirectory(sessionId), name);
  }
  async put(sessionId: string, name: string, data: Buffer) {
    if (name === 'index.m3u8') {
      const playlist = data.toString('utf8');
      if (
        data.length > 65_536 ||
        /(?:URI\s*=|:\/\/)/i.test(playlist) ||
        playlist
          .split(/\r?\n/)
          .filter((line) => line && !line.startsWith('#'))
          .some((line) => !/^segment-[0-9]{1,8}\.ts$/.test(line))
      )
        throw new AuthError(400, 'INVALID_PLAYLIST', 'Playlist contains invalid media references');
    }
    await mkdir(this.sessionDirectory(sessionId), { recursive: true, mode: 0o700 });
    await writeFile(this.mediaPath(sessionId, name), data, { mode: 0o600 });
  }
  async get(sessionId: string, name: string) {
    try {
      return await readFile(this.mediaPath(sessionId, name));
    } catch {
      throw new AuthError(404, 'STREAM_MEDIA_NOT_READY', 'Stream media is not ready');
    }
  }
  async remove(sessionId: string) {
    await rm(this.sessionDirectory(sessionId), { recursive: true, force: true });
  }
}
