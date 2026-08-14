import { randomBytes, randomUUID } from 'node:crypto';
import type {
  ExternalIdentityProvider,
  OrganizationMembership,
  PrismaClient,
  User,
} from '@prisma/client';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { AuthError, invalidCredentials } from './auth.errors';
import { hashPassword, verifyPassword } from './password';
import { createAccessToken, createOpaqueToken, hashOpaqueToken } from './tokens';
import type { AuthTokens, RequestMetadata, TokenDelivery } from './auth.types';
import { MfaService } from './mfa.service';

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
  private readonly mfa: MfaService;
  constructor(
    private readonly prisma: PrismaClient,
    private readonly delivery: TokenDelivery,
  ) {
    this.mfa = new MfaService(prisma);
  }

  private async issueSession(
    user: User,
    membership: OrganizationMembership,
    metadata: RequestMetadata,
    mfaVerified = false,
  ): Promise<AuthTokens> {
    const refreshToken = createOpaqueToken();
    const session = await this.prisma.session.create({
      data: {
        organizationId: membership.organizationId,
        userId: user.id,
        familyId: randomUUID(),
        tokenHash: hashOpaqueToken(refreshToken),
        expiresAt: plusDays(env.REFRESH_TOKEN_TTL_DAYS),
        mfaVerifiedAt: mfaVerified ? new Date() : null,
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
    const periodEnd = plusDays(30);

    const user = await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.create({
        data: {
          name: input.organizationName,
          slug: slugify(input.organizationName),
          timezone: input.timezone,
          storageUsage: { create: {} },
          resourceCounter: { create: { memberCount: 1 } },
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
      const subscription = await tx.subscription.create({
        data: {
          organizationId: organization.id,
          planId: freePlan.id,
          status: 'ACTIVE',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
      });
      await tx.subscriptionHistory.create({
        data: {
          organizationId: organization.id,
          subscriptionId: subscription.id,
          planId: freePlan.id,
          planCode: freePlan.code,
          planVersion: freePlan.version,
          status: 'ACTIVE',
          reason: 'REGISTRATION_FREE',
          limitsSnapshot: {
            maxCameras: freePlan.maxCameras,
            maxStorageBytes: freePlan.maxStorageBytes.toString(),
            retentionDays: freePlan.retentionDays,
            maxUsers: freePlan.maxUsers,
          },
          featuresSnapshot: freePlan.enabledFeatures as never,
          periodStart: now,
          periodEnd,
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
          action: 'SUBSCRIPTION_CREATED',
          entityType: 'Subscription',
          entityId: subscription.id,
          metadata: { planCode: freePlan.code, planVersion: freePlan.version },
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

  async login(email: string, password: string, metadata: RequestMetadata, mfaCode?: string) {
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
    const mfa = await this.mfa.status(user.id);
    if (mfa.enrolled) {
      if (!mfaCode) throw new AuthError(401, 'MFA_REQUIRED', 'Multi-factor authentication required');
      await this.mfa.verify(user.id, membership.organizationId, mfaCode, metadata);
    }
    const tokens = await this.issueSession(user, membership, metadata, mfa.enrolled);
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

  async loginWithExternalIdentity(
    transactionId: string,
    identity: {
      provider: ExternalIdentityProvider;
      subject: string;
      email: string;
      emailVerified: boolean;
      displayName: string;
    },
    metadata: RequestMetadata,
  ): Promise<
    | { kind: 'SESSION'; user: User; membership: OrganizationMembership; tokens: AuthTokens }
    | { kind: 'ONBOARDING' | 'MFA'; completionToken: string }
  > {
    const external = await this.prisma.externalIdentity.findUnique({
      where: {
        provider_providerSubject: {
          provider: identity.provider,
          providerSubject: identity.subject,
        },
      },
      include: {
        user: {
          include: {
            memberships: {
              where: { status: 'ACTIVE', organization: { status: 'ACTIVE', deletedAt: null } },
              orderBy: { createdAt: 'asc' },
              take: 1,
            },
          },
        },
      },
    });

    if (external) {
      const user = external.user;
      const membership = user.memberships[0];
      if (user.status !== 'ACTIVE' || user.deletedAt || !membership)
        throw new AuthError(403, 'OAUTH_ACCOUNT_UNAVAILABLE', 'Account is unavailable');
      const mfa = await this.mfa.status(user.id);
      if (mfa.enrolled) {
        const completionToken = createOpaqueToken();
        await this.prisma.oAuthTransaction.update({
          where: { id: transactionId },
          data: {
            completionPurpose: 'MFA',
            completionTokenHash: hashOpaqueToken(completionToken),
            providerSubject: identity.subject,
            email: identity.email,
            emailVerified: identity.emailVerified,
            displayName: identity.displayName,
          },
        });
        return { kind: 'MFA', completionToken };
      }
      const tokens = await this.issueSession(user, membership, metadata);
      await this.prisma.$transaction([
        this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } }),
        this.prisma.auditLog.create({
          data: {
            organizationId: membership.organizationId,
            actorUserId: user.id,
            action: 'OAUTH_LOGIN_SUCCESS',
            entityType: 'ExternalIdentity',
            entityId: external.id,
            metadata: { provider: identity.provider },
            ...metadata,
          },
        }),
      ]);
      return { kind: 'SESSION', user, membership, tokens };
    }

    if (!identity.emailVerified)
      throw new AuthError(400, 'OAUTH_EMAIL_UNVERIFIED', 'Provider email is not verified');

    const email = normalizeEmail(identity.email);
    const matchingUser = await this.prisma.user.findUnique({
      where: { normalizedEmail: email },
      include: {
        memberships: {
          where: { status: 'ACTIVE', organization: { status: 'ACTIVE', deletedAt: null } },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });
    if (matchingUser) {
      if (identity.provider !== 'GOOGLE' || !matchingUser.emailVerifiedAt)
        throw new AuthError(
          409,
          'OAUTH_LINK_REQUIRED',
          'Sign in with your password before linking this provider',
        );
      const membership = matchingUser.memberships[0];
      if (matchingUser.status !== 'ACTIVE' || matchingUser.deletedAt || !membership)
        throw new AuthError(403, 'OAUTH_ACCOUNT_UNAVAILABLE', 'Account is unavailable');
      const linked = await this.prisma.externalIdentity.create({
        data: {
          userId: matchingUser.id,
          provider: identity.provider,
          providerSubject: identity.subject,
          email: identity.email,
          emailVerified: true,
        },
      });
      const mfa = await this.mfa.status(matchingUser.id);
      if (mfa.enrolled) {
        const completionToken = createOpaqueToken();
        await this.prisma.oAuthTransaction.update({
          where: { id: transactionId },
          data: {
            completionPurpose: 'MFA',
            completionTokenHash: hashOpaqueToken(completionToken),
            providerSubject: identity.subject,
            email: identity.email,
            emailVerified: true,
            displayName: identity.displayName,
          },
        });
        return { kind: 'MFA', completionToken };
      }
      const tokens = await this.issueSession(matchingUser, membership, metadata);
      await this.prisma.$transaction([
        this.prisma.user.update({ where: { id: matchingUser.id }, data: { lastLoginAt: new Date() } }),
        this.prisma.auditLog.create({
          data: {
            organizationId: membership.organizationId,
            actorUserId: matchingUser.id,
            action: 'OAUTH_IDENTITY_LINKED',
            entityType: 'ExternalIdentity',
            entityId: linked.id,
            metadata: { provider: identity.provider, method: 'verified_email' },
            ...metadata,
          },
        }),
      ]);
      return { kind: 'SESSION', user: matchingUser, membership, tokens };
    }

    const completionToken = createOpaqueToken();
    await this.prisma.oAuthTransaction.update({
      where: { id: transactionId },
      data: {
        completionPurpose: 'ONBOARDING',
        completionTokenHash: hashOpaqueToken(completionToken),
        providerSubject: identity.subject,
        email: identity.email,
        emailVerified: true,
        displayName: identity.displayName,
      },
    });
    return { kind: 'ONBOARDING', completionToken };
  }

  async completeExternalOnboarding(
    completionToken: string,
    input: { name: string; organizationName: string; timezone: string },
    metadata: RequestMetadata,
  ) {
    const transaction = await this.findPendingOAuth(completionToken, 'ONBOARDING');
    if (
      !transaction.providerSubject ||
      !transaction.email ||
      !transaction.emailVerified ||
      !transaction.displayName
    )
      throw new AuthError(400, 'OAUTH_TRANSACTION_INVALID', 'OAuth transaction is invalid');
    const normalizedEmail = normalizeEmail(transaction.email);
    if (await this.prisma.user.findUnique({ where: { normalizedEmail } }))
      throw new AuthError(409, 'OAUTH_LINK_REQUIRED', 'Account already exists');
    const freePlan = await this.prisma.plan.findUnique({ where: { slug: 'free' } });
    if (!freePlan)
      throw new AuthError(503, 'PLAN_UNAVAILABLE', 'Registration is temporarily unavailable');
    const now = new Date();
    const periodEnd = plusDays(30);
    const passwordHash = await hashPassword(randomBytes(48).toString('base64url'));
    const result = await this.prisma.$transaction(async (tx) => {
      const consumed = await tx.oAuthTransaction.updateMany({
        where: { id: transaction.id, completedAt: null },
        data: { completedAt: now },
      });
      if (consumed.count !== 1)
        throw new AuthError(400, 'OAUTH_TRANSACTION_REUSED', 'OAuth transaction was already used');
      const organization = await tx.organization.create({
        data: {
          name: input.organizationName,
          slug: slugify(input.organizationName),
          timezone: input.timezone,
          storageUsage: { create: {} },
          resourceCounter: { create: { memberCount: 1 } },
        },
      });
      const user = await tx.user.create({
        data: {
          organizationId: organization.id,
          name: input.name,
          email: transaction.email!,
          normalizedEmail,
          passwordHash,
          role: 'OWNER',
          status: 'ACTIVE',
          emailVerifiedAt: now,
        },
      });
      const membership = await tx.organizationMembership.create({
        data: { userId: user.id, organizationId: organization.id, role: 'OWNER', status: 'ACTIVE' },
      });
      const externalIdentity = await tx.externalIdentity.create({
        data: {
          userId: user.id,
          provider: transaction.provider,
          providerSubject: transaction.providerSubject!,
          email: transaction.email!,
          emailVerified: true,
        },
      });
      await tx.organizationSettings.create({ data: { organizationId: organization.id } });
      const subscription = await tx.subscription.create({
        data: {
          organizationId: organization.id,
          planId: freePlan.id,
          status: 'ACTIVE',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
        },
      });
      await tx.subscriptionHistory.create({
        data: {
          organizationId: organization.id,
          subscriptionId: subscription.id,
          planId: freePlan.id,
          planCode: freePlan.code,
          planVersion: freePlan.version,
          status: 'ACTIVE',
          reason: 'SOCIAL_REGISTRATION_FREE',
          limitsSnapshot: {
            maxCameras: freePlan.maxCameras,
            maxStorageBytes: freePlan.maxStorageBytes.toString(),
            retentionDays: freePlan.retentionDays,
            maxUsers: freePlan.maxUsers,
          },
          featuresSnapshot: freePlan.enabledFeatures as never,
          periodStart: now,
          periodEnd,
        },
      });
      await tx.auditLog.createMany({
        data: [
          {
            organizationId: organization.id,
            actorUserId: user.id,
            action: 'ORGANIZATION_CREATED',
            entityType: 'Organization',
            entityId: organization.id,
            ...metadata,
          },
          {
            organizationId: organization.id,
            actorUserId: user.id,
            action: 'OAUTH_IDENTITY_CREATED',
            entityType: 'ExternalIdentity',
            entityId: externalIdentity.id,
            metadata: { provider: transaction.provider },
            ...metadata,
          },
        ],
      });
      return { user, membership };
    });
    logger.info('oauth.identity.created', {
      provider: transaction.provider,
      userId: result.user.id,
    });
    return {
      ...result,
      returnTo: transaction.returnTo,
      tokens: await this.issueSession(result.user, result.membership, metadata),
    };
  }

  async completeExternalMfa(completionToken: string, code: string, metadata: RequestMetadata) {
    const transaction = await this.findPendingOAuth(completionToken, 'MFA');
    if (!transaction.providerSubject)
      throw new AuthError(400, 'OAUTH_TRANSACTION_INVALID', 'OAuth transaction is invalid');
    const external = await this.prisma.externalIdentity.findUnique({
      where: {
        provider_providerSubject: {
          provider: transaction.provider,
          providerSubject: transaction.providerSubject,
        },
      },
      include: {
        user: {
          include: {
            memberships: {
              where: { status: 'ACTIVE', organization: { status: 'ACTIVE', deletedAt: null } },
              orderBy: { createdAt: 'asc' },
              take: 1,
            },
          },
        },
      },
    });
    const membership = external?.user.memberships[0];
    if (!external || !membership || external.user.status !== 'ACTIVE' || external.user.deletedAt)
      throw new AuthError(403, 'OAUTH_ACCOUNT_UNAVAILABLE', 'Account is unavailable');
    await this.mfa.verify(external.user.id, membership.organizationId, code, metadata);
    const consumed = await this.prisma.oAuthTransaction.updateMany({
      where: { id: transaction.id, completedAt: null },
      data: { completedAt: new Date() },
    });
    if (consumed.count !== 1)
      throw new AuthError(400, 'OAUTH_TRANSACTION_REUSED', 'OAuth transaction was already used');
    return {
      user: external.user,
      membership,
      returnTo: transaction.returnTo,
      tokens: await this.issueSession(external.user, membership, metadata, true),
    };
  }

  private async findPendingOAuth(completionToken: string, purpose: 'ONBOARDING' | 'MFA') {
    const transaction = await this.prisma.oAuthTransaction.findUnique({
      where: { completionTokenHash: hashOpaqueToken(completionToken) },
    });
    if (
      !transaction ||
      transaction.completionPurpose !== purpose ||
      transaction.completedAt ||
      transaction.expiresAt <= new Date()
    )
      throw new AuthError(400, 'OAUTH_TRANSACTION_INVALID', 'OAuth transaction is invalid or expired');
    return transaction;
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
          mfaVerifiedAt: current.mfaVerifiedAt,
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
