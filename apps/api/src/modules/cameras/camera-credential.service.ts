import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import { AuthError } from '../auth/auth.errors';

interface CameraCredentials {
  username: string;
  password: string;
}

type DatabaseClient = PrismaClient | Prisma.TransactionClient;

export class CameraCredentialService {
  private readonly key: Buffer | null;

  constructor() {
    const decoded = env.CAMERA_CREDENTIAL_KEY
      ? Buffer.from(env.CAMERA_CREDENTIAL_KEY, 'base64')
      : null;
    this.key = decoded?.length === 32 ? decoded : null;
  }

  async store(
    client: DatabaseClient,
    organizationId: string,
    cameraId: string,
    credentials: CameraCredentials,
  ) {
    const key = this.requireKey();
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, initializationVector);
    cipher.setAAD(Buffer.from(`${organizationId}:${cameraId}`));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(credentials), 'utf8'),
      cipher.final(),
    ]);
    const authenticationTag = cipher.getAuthTag();
    return client.cameraCredential.upsert({
      where: { cameraId },
      create: {
        organizationId,
        cameraId,
        ciphertext,
        initializationVector,
        authenticationTag,
      },
      update: { ciphertext, initializationVector, authenticationTag, keyVersion: 1 },
    });
  }

  async retrieveForBackend(
    organizationId: string,
    cameraId: string,
  ): Promise<CameraCredentials | null> {
    const record = await import('../../lib/prisma').then(({ prisma }) =>
      prisma.cameraCredential.findFirst({ where: { organizationId, cameraId } }),
    );
    if (!record) return null;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.requireKey(),
      record.initializationVector,
    );
    decipher.setAAD(Buffer.from(`${organizationId}:${cameraId}`));
    decipher.setAuthTag(record.authenticationTag);
    const plaintext = Buffer.concat([decipher.update(record.ciphertext), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as CameraCredentials;
  }

  private requireKey() {
    if (!this.key)
      throw new AuthError(
        503,
        'CAMERA_CREDENTIALS_UNAVAILABLE',
        'Camera credential storage is not configured',
      );
    return this.key;
  }
}
