import { Readable } from 'node:stream';
import { Client } from 'minio';
import { env } from '../../config/env';
import { AuthError } from '../auth/auth.errors';

export interface ObjectStorageService {
  put(key: string, data: Buffer, mimeType: string): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export class S3ObjectStorageService implements ObjectStorageService {
  private readonly client: Client;
  private ready?: Promise<void>;

  constructor() {
    const endpoint = new URL(env.OBJECT_STORAGE_ENDPOINT);
    this.client = new Client({
      endPoint: endpoint.hostname,
      port: Number(endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80)),
      useSSL: endpoint.protocol === 'https:',
      accessKey: env.OBJECT_STORAGE_ACCESS_KEY ?? 'not-configured',
      secretKey: env.OBJECT_STORAGE_SECRET_KEY ?? 'not-configured',
      region: env.OBJECT_STORAGE_REGION,
      pathStyle: true,
    });
  }

  async put(key: string, data: Buffer, mimeType: string) {
    await this.ensureBucket();
    await this.client.putObject(env.OBJECT_STORAGE_BUCKET, safeKey(key), data, data.length, {
      'Content-Type': mimeType,
    });
  }
  async get(key: string) {
    await this.ensureBucket();
    return this.client.getObject(env.OBJECT_STORAGE_BUCKET, safeKey(key));
  }
  async delete(key: string) {
    await this.ensureBucket();
    await this.client.removeObject(env.OBJECT_STORAGE_BUCKET, safeKey(key));
  }
  async exists(key: string) {
    await this.ensureBucket();
    try {
      await this.client.statObject(env.OBJECT_STORAGE_BUCKET, safeKey(key));
      return true;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'NotFound' || code === 'NoSuchKey') return false;
      throw error;
    }
  }
  async health() {
    if (!env.OBJECT_STORAGE_ACCESS_KEY || !env.OBJECT_STORAGE_SECRET_KEY) return false;
    return this.client.bucketExists(env.OBJECT_STORAGE_BUCKET);
  }
  private ensureBucket() {
    if (!env.OBJECT_STORAGE_ACCESS_KEY || !env.OBJECT_STORAGE_SECRET_KEY)
      throw new AuthError(503, 'STORAGE_UNAVAILABLE', 'Object storage is not configured');
    return (this.ready ??= (async () => {
      if (!(await this.client.bucketExists(env.OBJECT_STORAGE_BUCKET)))
        await this.client.makeBucket(env.OBJECT_STORAGE_BUCKET, env.OBJECT_STORAGE_REGION);
    })());
  }
}

const safeKey = (key: string) => {
  if (
    !/^organizations\/[0-9a-f-]{36}\/cameras\/[0-9a-f-]{36}\/[0-9]{4}\/[0-9]{2}\/[0-9]{2}\/[0-9a-f-]{36}\.(?:jpg|mp4)$/.test(
      key,
    )
  )
    throw new AuthError(400, 'INVALID_STORAGE_KEY', 'Invalid object key');
  return key;
};
