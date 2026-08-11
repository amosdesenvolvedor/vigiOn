import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { StreamMediaStore } from './stream-media.store';

const store = new StreamMediaStore();
const sessions: string[] = [];
afterEach(async () => Promise.all(sessions.splice(0).map((id) => store.remove(id))));

describe('ephemeral HLS media store', () => {
  it('accepts only local session segment references', async () => {
    const id = randomUUID();
    sessions.push(id);
    await expect(
      store.put(id, 'index.m3u8', Buffer.from('#EXTM3U\n#EXTINF:1,\nsegment-00000001.ts\n')),
    ).resolves.toBeUndefined();
    expect((await store.get(id, 'index.m3u8')).toString('utf8')).toContain('#EXTM3U');
  });
  it('rejects external playlist URLs and path traversal', async () => {
    const id = randomUUID();
    sessions.push(id);
    await expect(
      store.put(id, 'index.m3u8', Buffer.from('#EXTM3U\nhttps://metadata.invalid/secret\n')),
    ).rejects.toMatchObject({ code: 'INVALID_PLAYLIST' });
    await expect(store.put(id, '../index.m3u8', Buffer.from('x'))).rejects.toMatchObject({
      code: 'INVALID_MEDIA_NAME',
    });
  });
});
