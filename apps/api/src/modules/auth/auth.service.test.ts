import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from './auth.service';
import type { TokenDelivery } from './auth.types';

const prisma = new PrismaClient();
const suffix = randomUUID().slice(0, 8);
const password = 'Strong!Password123';
const organizationIds: string[] = [];
const delivered = { reset: '', verification: '' };
const delivery: TokenDelivery = {
  async sendPasswordReset(_email, token) {
    delivered.reset = token;
  },
  async sendEmailVerification(_email, token) {
    delivered.verification = token;
  },
  async sendOrganizationInvitation() {},
};
const service = new AuthService(prisma, delivery);
const metadata = { ipAddress: '127.0.0.1', userAgent: 'Vitest' };

async function register(label: string) {
  const result = await service.register(
    {
      name: `Owner ${label}`,
      email: `${label}-${suffix}@example.test`,
      password,
      organizationName: `Organization ${label}`,
      timezone: 'UTC',
    },
    metadata,
  );
  organizationIds.push(result.user.organizationId);
  return result;
}

beforeAll(async () => {
  await prisma.$connect();
  await prisma.plan.upsert({
    where: { slug: 'free' },
    update: {},
    create: {
      name: 'Free',
      slug: 'free',
      maxCameras: 1,
      maxStorageBytes: 1_000n,
      retentionDays: 1,
      maxUsers: 1,
      enabledFeatures: [],
    },
  });
});

afterAll(async () => {
  if (organizationIds.length) {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organizationInvitation.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await prisma.organizationMembership.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await prisma.organizationSettings.deleteMany({
      where: { organizationId: { in: organizationIds } },
    });
    await prisma.subscription.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.storageUsage.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  }
  await prisma.$disconnect();
});

describe('authentication lifecycle', () => {
  it('registers an OWNER with FREE trial and rejects duplicate email', async () => {
    const result = await register('register');
    expect(result.membership.role).toBe('OWNER');
    expect(delivered.verification).toHaveLength(64);
    await expect(register('register')).rejects.toMatchObject({ code: 'ACCOUNT_EXISTS' });
    await expect(
      prisma.subscription.findFirst({ where: { organizationId: result.user.organizationId } }),
    ).resolves.toMatchObject({ status: 'TRIAL' });
    await expect(
      prisma.auditLog.findFirst({
        where: { organizationId: result.user.organizationId, action: 'ORGANIZATION_CREATED' },
      }),
    ).resolves.toMatchObject({ entityId: result.user.organizationId });
  });

  it('logs in valid users and rejects wrong, missing, and inactive accounts identically', async () => {
    const { user } = await register('login');
    await expect(service.login(user.email, password, metadata)).resolves.toHaveProperty(
      'tokens.accessToken',
    );
    await expect(service.login(user.email, 'Wrong!Password123', metadata)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    await expect(
      service.login(`missing-${suffix}@example.test`, password, metadata),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    await prisma.user.update({ where: { id: user.id }, data: { status: 'INACTIVE' } });
    await expect(service.login(user.email, password, metadata)).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('rotates refresh tokens and detects reuse', async () => {
    const result = await register('refresh');
    const rotated = await service.refresh(result.tokens.refreshToken, metadata);
    expect(rotated.refreshToken).not.toBe(result.tokens.refreshToken);
    await expect(service.refresh(result.tokens.refreshToken, metadata)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_REUSED',
    });
    await expect(service.refresh(rotated.refreshToken, metadata)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_REUSED',
    });
  });

  it('rejects expired and explicitly revoked refresh tokens', async () => {
    const expired = await register('expired');
    await prisma.session.updateMany({
      where: { userId: expired.user.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(service.refresh(expired.tokens.refreshToken, metadata)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_EXPIRED',
    });
    const revoked = await register('revoked');
    await prisma.session.updateMany({
      where: { userId: revoked.user.id },
      data: { revokedAt: new Date() },
    });
    await expect(service.refresh(revoked.tokens.refreshToken, metadata)).rejects.toMatchObject({
      code: 'REFRESH_TOKEN_REUSED',
    });
  });

  it('revokes one session and all user sessions', async () => {
    const result = await register('logout');
    const session = await prisma.session.findFirstOrThrow({
      where: { userId: result.user.id, revokedAt: null },
    });
    await service.logout(session.id, result.user.id, result.user.organizationId, metadata);
    await expect(prisma.session.findUnique({ where: { id: session.id } })).resolves.toMatchObject({
      revokedAt: expect.any(Date),
    });
    await service.login(result.user.email, password, metadata);
    await service.login(result.user.email, password, metadata);
    await service.logoutAll(result.user.id, result.user.organizationId, metadata);
    await expect(
      prisma.session.count({ where: { userId: result.user.id, revokedAt: null } }),
    ).resolves.toBe(0);
  });

  it('resets a password once, rejects invalid/expired/used tokens, and revokes sessions', async () => {
    const result = await register('reset');
    await service.forgotPassword(result.user.email, metadata);
    const token = delivered.reset;
    await expect(
      service.resetPassword('invalid-token-value-that-is-long-enough', password, metadata),
    ).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
    const record = await prisma.oneTimeToken.findFirstOrThrow({
      where: { userId: result.user.id, type: 'PASSWORD_RESET', usedAt: null },
    });
    await prisma.oneTimeToken.update({
      where: { id: record.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(service.resetPassword(token, password, metadata)).rejects.toMatchObject({
      code: 'INVALID_RESET_TOKEN',
    });
    await service.forgotPassword(result.user.email, metadata);
    await service.resetPassword(delivered.reset, 'Another!Password123', metadata);
    await expect(
      service.resetPassword(delivered.reset, 'Another!Password123', metadata),
    ).rejects.toMatchObject({ code: 'INVALID_RESET_TOKEN' });
    await expect(
      prisma.session.count({ where: { userId: result.user.id, revokedAt: null } }),
    ).resolves.toBe(0);
  });

  it('verifies email with a one-time token', async () => {
    const result = await register('verify');
    await service.verifyEmail(delivered.verification, metadata);
    await expect(prisma.user.findUnique({ where: { id: result.user.id } })).resolves.toMatchObject({
      emailVerifiedAt: expect.any(Date),
    });
    await expect(service.verifyEmail(delivered.verification, metadata)).rejects.toMatchObject({
      code: 'INVALID_VERIFICATION_TOKEN',
    });
  });
});
