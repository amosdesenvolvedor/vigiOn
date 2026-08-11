import { randomUUID } from 'node:crypto';
import type { OrganizationMembership, PrismaClient, User } from '@prisma/client';
import { env } from '../../config/env';
import { AuthError, invalidCredentials } from './auth.errors';
import { hashPassword, verifyPassword } from './password';
import { createAccessToken, createOpaqueToken, hashOpaqueToken } from './tokens';
import type { AuthTokens, RequestMetadata, TokenDelivery } from './auth.types';

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const plusDays = (days: number) => new Date(Date.now() + days * 86_400_000);
const plusMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000);
const plusHours = (hours: number) => new Date(Date.now() + hours * 3_600_000);
const slugify = (name: string) =>
  `${name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 70)}-${randomUUID().slice(0, 8)}`;

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly delivery: TokenDelivery,
  ) {}

  private async issueSession(
    user: User,
    membership: OrganizationMembership,
    metadata: RequestMetadata,
  ): Promise<AuthTokens> {
    const refreshToken = createOpaqueToken();
    const session = await this.prisma.session.create({
      data: {
        organizationId: membership.organizationId,
        userId: user.id,
        familyId: randomUUID(),
        tokenHash: hashOpaqueToken(refreshToken),
        expiresAt: plusDays(env.REFRESH_TOKEN_TTL_DAYS),
        ...metadata,
      },
    });
    return {
      refreshToken,
      accessToken: createAccessToken({
        userId: user.id,
        organizationId: membership.organizationId,
        membershipId: membership.id,
        role: membership.role,
        sessionId: session.id,
      }),
      expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async register(
    input: {
      name: string;
      email: string;
      password: string;
      organizationName: string;
      timezone: string;
    },
    metadata: RequestMetadata,
  ) {
    const normalizedEmail = normalizeEmail(input.email);
    const existing = await this.prisma.user.findUnique({ where: { normalizedEmail } });
    if (existing) throw new AuthError(409, 'ACCOUNT_EXISTS', 'Unable to create account');

    const freePlan = await this.prisma.plan.findUnique({ where: { slug: 'free' } });
    if (!freePlan)
      throw new AuthError(503, 'PLAN_UNAVAILABLE', 'Registration is temporarily unavailable');
    const passwordHash = await hashPassword(input.password);
    const now = new Date();
    const trialEndsAt = plusDays(14);

    const user = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: input.organizationName,
          slug: slugify(input.organizationName),
          timezone: input.timezone,
          storageUsage: { create: {} },
        },
      });
      const createdUser = await tx.user.create({
        data: {
          organizationId: organization.id,
          name: input.name,
          email: input.email.trim(),
          normalizedEmail,
          passwordHash,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });
      const membership = await tx.organizationMembership.create({
        data: {
          userId: createdUser.id,
          organizationId: organization.id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });
      await tx.organizationSettings.create({ data: { organizationId: organization.id } });
      await tx.subscription.create({
        data: {
          organizationId: organization.id,
          planId: freePlan.id,
          status: 'TRIAL',
          currentPeriodStart: now,
          currentPeriodEnd: trialEndsAt,
          trialEndsAt,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          actorUserId: createdUser.id,
          action: 'ORGANIZATION_CREATED',
          entityType: 'Organization',
          entityId: organization.id,
          ...metadata,
        },
      });
      await tx.auditLog.create({
        data: {
          organizationId: organization.id,
          actorUserId: createdUser.id,
          action: 'REGISTER',
          entityType: 'User',
          entityId: createdUser.id,
          ...metadata,
        },
      });
      return { user: createdUser, membership };
    });

    const verificationToken = await this.createOneTimeToken(user.user, 'EMAIL_VERIFICATION');
    await this.deliverSafely(() =>
      this.delivery.sendEmailVerification(user.user.email, verificationToken),
    );
    return {
      user: user.user,
      membership: user.membership,
      tokens: await this.issueSession(user.user, user.membership, metadata),
    };
  }

  async login(email: string, password: string, metadata: RequestMetadata) {
    const user = await this.prisma.user.findUnique({
      where: { normalizedEmail: normalizeEmail(email) },
      include: {
        memberships: {
          where: { status: 'ACTIVE', organization: { status: 'ACTIVE', deletedAt: null } },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });
    if (!user || !(await verifyPassword(user.passwordHash, password))) {
      await this.prisma.auditLog.create({
        data: { action: 'LOGIN_FAILED', entityType: 'User', ...metadata },
      });
      throw invalidCredentials();
    }
    if (user.status !== 'ACTIVE' || user.deletedAt || !user.memberships[0])
      throw invalidCredentials();

    const membership = user.memberships[0];
    const tokens = await this.issueSession(user, membership, metadata);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
      this.prisma.auditLog.create({
        data: {
          organizationId: membership.organizationId,
          actorUserId: user.id,
          action: 'LOGIN_SUCCESS',
          entityType: 'Session',
          ...metadata,
        },
      }),
    ]);
    return { user, membership, tokens };
  }

  async refresh(rawToken: string, metadata: RequestMetadata): Promise<AuthTokens> {
    const current = await this.prisma.session.findUnique({
      where: { tokenHash: hashOpaqueToken(rawToken) },
      include: { user: true },
    });
    if (!current) throw new AuthError(401, 'INVALID_REFRESH_TOKEN', 'Invalid session');
    if (current.revokedAt) {
      await this.prisma.session.updateMany({
        where: { familyId: current.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new AuthError(401, 'REFRESH_TOKEN_REUSED', 'Invalid session');
    }
    if (
      current.expiresAt <= new Date() ||
      current.user.status !== 'ACTIVE' ||
      current.user.deletedAt
    ) {
      await this.prisma.session.update({
        where: { id: current.id },
        data: { revokedAt: new Date() },
      });
      throw new AuthError(401, 'REFRESH_TOKEN_EXPIRED', 'Invalid session');
    }

    const membership = await this.prisma.organizationMembership.findFirst({
      where: {
        userId: current.userId,
        organizationId: current.organizationId,
        status: 'ACTIVE',
      },
    });
    if (!membership) throw new AuthError(401, 'UNAUTHORIZED', 'Authentication required');
    const nextToken = createOpaqueToken();
    const next = await this.prisma.$transaction(async (tx) => {
      const session = await tx.session.create({
        data: {
          organizationId: current.organizationId,
          userId: current.userId,
          familyId: current.familyId,
          tokenHash: hashOpaqueToken(nextToken),
          expiresAt: plusDays(env.REFRESH_TOKEN_TTL_DAYS),
          ...metadata,
        },
      });
      const updated = await tx.session.updateMany({
        where: { id: current.id, revokedAt: null },
        data: { revokedAt: new Date(), lastUsedAt: new Date(), replacedById: session.id },
      });
      if (updated.count !== 1) throw new AuthError(401, 'REFRESH_TOKEN_REUSED', 'Invalid session');
      return session;
    });
    return {
      refreshToken: nextToken,
      accessToken: createAccessToken({
        userId: current.userId,
        organizationId: current.organizationId,
        membershipId: membership.id,
        role: membership.role,
        sessionId: next.id,
      }),
      expiresIn: env.ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async logout(
    sessionId: string,
    userId: string,
    organizationId: string,
    metadata: RequestMetadata,
  ) {
    await this.prisma.$transaction([
      this.prisma.session.updateMany({
        where: { id: sessionId, userId },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId,
          actorUserId: userId,
          action: 'LOGOUT',
          entityType: 'Session',
          entityId: sessionId,
          ...metadata,
        },
      }),
    ]);
  }

  async logoutAll(userId: string, organizationId: string, metadata: RequestMetadata) {
    await this.prisma.$transaction([
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId,
          actorUserId: userId,
          action: 'LOGOUT_ALL',
          entityType: 'Session',
          ...metadata,
        },
      }),
    ]);
  }

  async forgotPassword(email: string, metadata: RequestMetadata) {
    const user = await this.prisma.user.findUnique({
      where: { normalizedEmail: normalizeEmail(email) },
    });
    if (!user || user.status !== 'ACTIVE' || user.deletedAt) return;
    const token = await this.createOneTimeToken(user, 'PASSWORD_RESET');
    await this.prisma.auditLog.create({
      data: {
        organizationId: user.organizationId,
        actorUserId: user.id,
        action: 'PASSWORD_RESET_REQUESTED',
        entityType: 'User',
        entityId: user.id,
        ...metadata,
      },
    });
    await this.deliverSafely(() => this.delivery.sendPasswordReset(user.email, token));
  }

  async resetPassword(token: string, password: string, metadata: RequestMetadata) {
    const record = await this.prisma.oneTimeToken.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
      include: { user: true },
    });
    if (
      !record ||
      record.type !== 'PASSWORD_RESET' ||
      record.usedAt ||
      record.expiresAt <= new Date()
    ) {
      throw new AuthError(400, 'INVALID_RESET_TOKEN', 'Invalid or expired token');
    }
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      this.prisma.oneTimeToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: record.organizationId,
          actorUserId: record.userId,
          action: 'PASSWORD_RESET_COMPLETED',
          entityType: 'User',
          entityId: record.userId,
          ...metadata,
        },
      }),
    ]);
  }

  async verifyEmail(token: string, metadata: RequestMetadata) {
    const record = await this.prisma.oneTimeToken.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
    });
    if (
      !record ||
      record.type !== 'EMAIL_VERIFICATION' ||
      record.usedAt ||
      record.expiresAt <= new Date()
    ) {
      throw new AuthError(400, 'INVALID_VERIFICATION_TOKEN', 'Invalid or expired token');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      }),
      this.prisma.oneTimeToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.auditLog.create({
        data: {
          organizationId: record.organizationId,
          actorUserId: record.userId,
          action: 'EMAIL_VERIFIED',
          entityType: 'User',
          entityId: record.userId,
          ...metadata,
        },
      }),
    ]);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    password: string,
    metadata: RequestMetadata,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !(await verifyPassword(user.passwordHash, currentPassword)))
      throw invalidCredentials();
    const passwordHash = await hashPassword(password);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          organizationId: user.organizationId,
          actorUserId: userId,
          action: 'PASSWORD_CHANGED',
          entityType: 'User',
          entityId: userId,
          ...metadata,
        },
      }),
    ]);
  }

  private async createOneTimeToken(user: User, type: 'PASSWORD_RESET' | 'EMAIL_VERIFICATION') {
    const token = createOpaqueToken();
    await this.prisma.$transaction([
      this.prisma.oneTimeToken.updateMany({
        where: { userId: user.id, type, usedAt: null },
        data: { usedAt: new Date() },
      }),
      this.prisma.oneTimeToken.create({
        data: {
          organizationId: user.organizationId,
          userId: user.id,
          type,
          tokenHash: hashOpaqueToken(token),
          expiresAt:
            type === 'PASSWORD_RESET'
              ? plusMinutes(env.PASSWORD_RESET_TTL_MINUTES)
              : plusHours(env.EMAIL_VERIFICATION_TTL_HOURS),
        },
      }),
    ]);
    return token;
  }

  private async deliverSafely(deliver: () => Promise<void>) {
    try {
      await deliver();
    } catch {
      console.error('Authentication email delivery failed');
    }
  }
}
