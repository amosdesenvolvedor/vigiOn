import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

interface QueuedMessage {
  id: string;
  createdAt: number;
  attempts: number;
  payload: unknown;
}

export class LocalQueue {
  constructor(
    private readonly file: string,
    private readonly limit = 500,
    private readonly ttlMs = 86_400_000,
  ) {}
  private async read(): Promise<QueuedMessage[]> {
    try {
      return JSON.parse(await readFile(this.file, 'utf8')) as QueuedMessage[];
    } catch {
      return [];
    }
  }
  private async save(items: QueuedMessage[]) {
    await writeFile(this.file, JSON.stringify(items), { mode: 0o600 });
  }
  async enqueue(payload: unknown) {
    const now = Date.now();
    const items = (await this.read()).filter((item) => now - item.createdAt < this.ttlMs);
    items.push({ id: randomUUID(), createdAt: now, attempts: 0, payload });
    await this.save(items.slice(-this.limit));
  }
  async flush(send: (payload: unknown) => Promise<void>) {
    const now = Date.now();
    const pending: QueuedMessage[] = [];
    for (const item of await this.read()) {
      if (now - item.createdAt >= this.ttlMs || item.attempts >= 8) continue;
      try {
        await send(item.payload);
      } catch {
        pending.push({ ...item, attempts: item.attempts + 1 });
      }
    }
    await this.save(pending);
  }
}
