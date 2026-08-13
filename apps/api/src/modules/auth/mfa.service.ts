import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { env } from '../../config/env';
import { AuthError } from './auth.errors';
import { hashOpaqueToken } from './tokens';
import { verifyPassword } from './password';
import type { RequestMetadata } from './auth.types';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const period = 30;

function key() {
  if (!env.MFA_ENCRYPTION_KEY) throw new AuthError(503, 'MFA_UNAVAILABLE', 'MFA is unavailable');
  return createHmac('sha256', 'vigion-mfa-encryption-v1').update(env.MFA_ENCRYPTION_KEY).digest();
}

function base32Encode(input: Buffer) {
  let bits = 0;
  let value = 0;
  let result = '';
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits) result += alphabet[(value << (5 - bits)) & 31];
  return result;
}

function base32Decode(input: string) {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const character of input.replace(/=+$/g, '').toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function encrypt(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString('base64url')).join('.');
}

function decrypt(payload: string) {
  const [iv, tag, ciphertext] = payload.split('.').map((part) => Buffer.from(part, 'base64url'));
  if (!iv || !tag || !ciphertext) throw new Error('Invalid encrypted MFA secret');
  const decipher = createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

function hotp(secret: string, step: number) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const digest = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return binary.toString().padStart(6, '0');
}

function validStep(secret: string, code: string) {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(Date.now() / 1000 / period);
  for (const step of [current - 1, current, current + 1]) {
    const expected = Buffer.from(hotp(secret, step));
    const supplied = Buffer.from(code);
    if (expected.length === supplied.length && timingSafeEqual(expected, supplied)) return step;
  }
  return null;
}

const recoveryCode = () => `${randomBytes(4).toString('hex')}-${randomBytes(4).toString('hex')}`;

export class MfaService {
  constructor(private readonly prisma: PrismaClient) {}

  async status(userId: string) {
    const credential = await this.prisma.mfaCredential.findUnique({ where: { userId } });
    return { enrolled: Boolean(credential?.enabledAt), pending: Boolean(credential && !credential.enabledAt) };
  }

  async begin(userId: string, email: string) {
    const existing = await this.prisma.mfaCredential.findUnique({ where: { userId } });
    if (existing?.enabledAt) throw new AuthError(409, 'MFA_ALREADY_ENABLED', 'MFA is already enabled');
    const secret = base32Encode(randomBytes(20));
    await this.prisma.mfaCredential.upsert({
      where: { userId },
      create: { userId, encryptedSecret: encrypt(secret) },
      update: { encryptedSecret: encrypt(secret), enabledAt: null, lastUsedStep: null },
    });
    const label = encodeURIComponent(`Vigion Cloud:${email}`);
    const otpauthUri = `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent('Vigion Cloud')}&algorithm=SHA1&digits=6&period=30`;
    return { secret, otpauthUri };
  }

  async confirm(userId: string, organizationId: string, code: string, metadata: RequestMetadata) {
    const credential = await this.prisma.mfaCredential.findUnique({ where: { userId } });
    if (!credential || credential.enabledAt) throw new AuthError(409, 'MFA_ENROLLMENT_INVALID', 'No pending enrollment');
    const step = validStep(decrypt(credential.encryptedSecret), code);
    if (step === null) throw new AuthError(401, 'MFA_CODE_INVALID', 'Invalid authentication code');
    const codes = Array.from({ length: 10 }, recoveryCode);
    await this.prisma.$transaction(async (tx) => {
      await tx.mfaCredential.update({ where: { userId }, data: { enabledAt: new Date(), lastUsedStep: step } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId } });
      await tx.mfaRecoveryCode.createMany({ data: codes.map((value) => ({ userId, codeHash: hashOpaqueToken(value) })) });
      await tx.auditLog.create({ data: { organizationId, actorUserId: userId, action: 'mfa.enrolled', entityType: 'User', entityId: userId, ...metadata } });
    });
    return { recoveryCodes: codes };
  }

  async verify(userId: string, organizationId: string, code: string, metadata: RequestMetadata) {
    const credential = await this.prisma.mfaCredential.findUnique({ where: { userId } });
    if (!credential?.enabledAt) throw new AuthError(403, 'MFA_ENROLLMENT_REQUIRED', 'MFA enrollment required');
    const step = validStep(decrypt(credential.encryptedSecret), code);
    if (step !== null) {
      const updated = await this.prisma.mfaCredential.updateMany({ where: { userId, enabledAt: { not: null }, OR: [{ lastUsedStep: null }, { lastUsedStep: { lt: step } }] }, data: { lastUsedStep: step } });
      if (updated.count === 1) return 'totp' as const;
      throw new AuthError(401, 'MFA_CODE_REPLAYED', 'Authentication code was already used');
    }
    const hash = hashOpaqueToken(code.toLowerCase());
    const recovery = await this.prisma.mfaRecoveryCode.findUnique({ where: { codeHash: hash } });
    if (!recovery || recovery.userId !== userId || recovery.usedAt) throw new AuthError(401, 'MFA_CODE_INVALID', 'Invalid authentication code');
    const consumed = await this.prisma.mfaRecoveryCode.updateMany({ where: { id: recovery.id, usedAt: null }, data: { usedAt: new Date() } });
    if (consumed.count !== 1) throw new AuthError(401, 'MFA_CODE_REPLAYED', 'Authentication code was already used');
    await this.prisma.auditLog.create({ data: { organizationId, actorUserId: userId, action: 'mfa.recovery_used', entityType: 'User', entityId: userId, ...metadata } });
    return 'recovery' as const;
  }

  async disable(userId: string, organizationId: string, password: string, code: string, metadata: RequestMetadata) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await verifyPassword(user.passwordHash, password))) throw new AuthError(401, 'INVALID_CREDENTIALS', 'Invalid credentials');
    await this.verify(userId, organizationId, code, metadata);
    await this.prisma.$transaction([
      this.prisma.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.prisma.mfaCredential.delete({ where: { userId } }),
      this.prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      this.prisma.auditLog.create({ data: { organizationId, actorUserId: userId, action: 'mfa.disabled', entityType: 'User', entityId: userId, ...metadata } }),
    ]);
  }
}
