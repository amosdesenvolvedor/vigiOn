import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import { AuthError } from '../auth/auth.errors';

type DatabaseClient = PrismaClient | Prisma.TransactionClient;
export type VerificationCredential = { username: string; password: string };

export class VerificationCredentialService {
  private readonly key = env.CAMERA_CREDENTIAL_KEY
    ? Buffer.from(env.CAMERA_CREDENTIAL_KEY, 'base64')
    : null;

  async store(client: DatabaseClient, organizationId: string, verificationSessionId: string,
    expiresAt: Date, credentials: VerificationCredential) {
    const key = this.requireKey();
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, initializationVector);
    cipher.setAAD(Buffer.from(`verification:${organizationId}:${verificationSessionId}`));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credentials), 'utf8'), cipher.final()]);
    return client.cameraVerificationCredential.upsert({
      where: { verificationSessionId },
      create: { organizationId, verificationSessionId, expiresAt, ciphertext,
        initializationVector, authenticationTag: cipher.getAuthTag() },
      update: { expiresAt, ciphertext, initializationVector, authenticationTag: cipher.getAuthTag(), keyVersion: 1 },
    });
  }

  async retrieve(client: DatabaseClient, organizationId: string, verificationSessionId: string) {
    const record = await client.cameraVerificationCredential.findFirst({
      where: { organizationId, verificationSessionId, expiresAt: { gt: new Date() } },
    });
    if (!record) return null;
    const decipher = createDecipheriv('aes-256-gcm', this.requireKey(), record.initializationVector);
    decipher.setAAD(Buffer.from(`verification:${organizationId}:${verificationSessionId}`));
    decipher.setAuthTag(record.authenticationTag);
    return JSON.parse(
      Buffer.concat([decipher.update(record.ciphertext), decipher.final()]).toString('utf8'),
    ) as VerificationCredential;
  }

  private requireKey() {
    if (!this.key || this.key.length !== 32)
      throw new AuthError(503, 'CAMERA_CREDENTIALS_UNAVAILABLE', 'Camera credential storage is not configured');
    return this.key;
  }
}
