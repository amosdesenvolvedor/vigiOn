import { Router, type Request, type Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { AuthError } from './auth.errors';
import { authenticate } from './auth.middleware';
import {
  changePasswordSchema,
  emailSchema,
  loginSchema,
  mfaCodeSchema,
  mfaDisableSchema,
  registerSchema,
  resetPasswordSchema,
  tokenSchema,
} from './auth.schemas';
import { AuthService } from './auth.service';
import { MfaService } from './mfa.service';
import { tokenDelivery } from './token-delivery';
import type { RequestMetadata } from './auth.types';

export const authRouter = Router();
const authService = new AuthService(prisma, tokenDelivery);
const mfaService = new MfaService(prisma);
const mfaLimiter = rateLimit({
  windowMs: 5 * 60_000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'MFA_RATE_LIMITED', message: 'Too many MFA attempts; try again later' } },
});
const sensitiveLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests; try again later' } },
});
const refreshCookie = 'vigioni_refresh';
const cookieOptions = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/api/v1/auth',
  maxAge: env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
};

function metadata(request: Request): RequestMetadata {
  const result: RequestMetadata = {};
  if (request.ip) result.ipAddress = request.ip;
  const userAgent = request.get('user-agent');
  if (userAgent) result.userAgent = userAgent.slice(0, 512);
  return result;
}

function setSession(
  response: Response,
  tokens: { accessToken: string; refreshToken: string; expiresIn: number },
) {
  response.cookie(refreshCookie, tokens.refreshToken, cookieOptions);
  return { accessToken: tokens.accessToken, expiresIn: tokens.expiresIn, tokenType: 'Bearer' };
}

const publicUser = (user: {
  id: string;
  name: string;
  email: string;
  role: string;
  emailVerifiedAt: Date | null;
  platformRole?: string | null;
}) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
  emailVerifiedAt: user.emailVerifiedAt,
  platformRole: user.platformRole ?? null,
});

authRouter.post('/register', sensitiveLimiter, async (request, response, next) => {
  try {
    const input = registerSchema.parse(request.body);
    const result = await authService.register(input, metadata(request));
    response.status(201).json({
      user: publicUser({ ...result.user, role: result.membership.role }),
      session: setSession(response, result.tokens),
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/login', sensitiveLimiter, async (request, response, next) => {
  try {
    const input = loginSchema.parse(request.body);
    const result = await authService.login(input.email, input.password, metadata(request), input.mfaCode);
    response.json({
      user: publicUser({ ...result.user, role: result.membership.role }),
      session: setSession(response, result.tokens),
    });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/refresh', sensitiveLimiter, async (request, response, next) => {
  try {
    const token = request.cookies?.[refreshCookie] as string | undefined;
    if (!token) throw new AuthError(401, 'INVALID_REFRESH_TOKEN', 'Invalid session');
    const tokens = await authService.refresh(token, metadata(request));
    response.json({ session: setSession(response, tokens) });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout', authenticate, async (request, response, next) => {
  try {
    await authService.logout(
      request.auth!.sessionId,
      request.auth!.userId,
      request.auth!.organizationId,
      metadata(request),
    );
    response.clearCookie(refreshCookie, cookieOptions).status(204).send();
  } catch (error) {
    next(error);
  }
});

authRouter.post('/logout-all', authenticate, async (request, response, next) => {
  try {
    await authService.logoutAll(
      request.auth!.userId,
      request.auth!.organizationId,
      metadata(request),
    );
    response.clearCookie(refreshCookie, cookieOptions).status(204).send();
  } catch (error) {
    next(error);
  }
});

authRouter.post('/forgot-password', sensitiveLimiter, async (request, response, next) => {
  try {
    const { email } = emailSchema.parse(request.body);
    await authService.forgotPassword(email, metadata(request));
    response.json({ message: 'If the address is registered, recovery instructions will be sent' });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/reset-password', sensitiveLimiter, async (request, response, next) => {
  try {
    const input = resetPasswordSchema.parse(request.body);
    await authService.resetPassword(input.token, input.password, metadata(request));
    response.clearCookie(refreshCookie, cookieOptions).json({ message: 'Password updated' });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/verify-email', sensitiveLimiter, async (request, response, next) => {
  try {
    const { token } = tokenSchema.parse(request.body);
    await authService.verifyEmail(token, metadata(request));
    response.json({ message: 'Email verified' });
  } catch (error) {
    next(error);
  }
});

authRouter.post('/change-password', authenticate, async (request, response, next) => {
  try {
    const input = changePasswordSchema.parse(request.body);
    await authService.changePassword(
      request.auth!.userId,
      input.currentPassword,
      input.password,
      metadata(request),
    );
    response
      .clearCookie(refreshCookie, cookieOptions)
      .json({ message: 'Password updated; sign in again' });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/me', authenticate, async (request, response, next) => {
  try {
    const user = await prisma.user.findFirst({
      where: {
        id: request.auth!.userId,
        organizationId: request.auth!.organizationId,
        deletedAt: null,
      },
      include: { organization: { select: { id: true, name: true, slug: true, status: true } } },
    });
    if (!user) throw new AuthError(401, 'UNAUTHORIZED', 'Authentication required');
    const membership = await prisma.organizationMembership.findFirst({
      where: {
        id: request.auth!.membershipId,
        userId: user.id,
        organizationId: request.auth!.organizationId,
        status: 'ACTIVE',
      },
    });
    const organization = await prisma.organization.findFirst({
      where: { id: request.auth!.organizationId, status: 'ACTIVE', deletedAt: null },
      select: { id: true, name: true, slug: true },
    });
    if (!membership || !organization)
      throw new AuthError(403, 'ORGANIZATION_SUSPENDED', 'Organization is not active');
    const mfa = await mfaService.status(user.id);
    response.json({
      user: publicUser({ ...user, role: membership.role }),
      organization,
      membership: { id: membership.id, role: membership.role, status: membership.status },
      mfa,
    });
  } catch (error) {
    next(error);
  }
});

authRouter.get('/mfa/status', authenticate, async (request, response) => {
  response.json(await mfaService.status(request.auth!.userId));
});

authRouter.post('/mfa/enroll', authenticate, mfaLimiter, async (request, response, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.auth!.userId }, select: { email: true } });
    response.json(await mfaService.begin(request.auth!.userId, user.email));
  } catch (error) { next(error); }
});

authRouter.post('/mfa/confirm', authenticate, mfaLimiter, async (request, response, next) => {
  try {
    const { code } = mfaCodeSchema.parse(request.body);
    const result = await mfaService.confirm(request.auth!.userId, request.auth!.organizationId, code, metadata(request));
    await prisma.session.update({ where: { id: request.auth!.sessionId }, data: { mfaVerifiedAt: new Date() } });
    response.json(result);
  } catch (error) { next(error); }
});

authRouter.post('/mfa/disable', authenticate, mfaLimiter, async (request, response, next) => {
  try {
    const input = mfaDisableSchema.parse(request.body);
    await mfaService.disable(request.auth!.userId, request.auth!.organizationId, input.password, input.code, metadata(request));
    response.clearCookie(refreshCookie, cookieOptions).status(204).send();
  } catch (error) { next(error); }
});

authRouter.get('/sessions', authenticate, async (request, response) => {
  const sessions = await prisma.session.findMany({
    where: {
      userId: request.auth!.userId,
      organizationId: request.auth!.organizationId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: {
      id: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
      ipAddress: true,
      userAgent: true,
    },
    orderBy: { createdAt: 'desc' },
  });
  response.json({
    sessions: sessions.map((session) => ({
      ...session,
      current: session.id === request.auth!.sessionId,
    })),
  });
});

authRouter.delete('/sessions/:id', authenticate, async (request, response) => {
  const sessionId = request.params.id;
  if (typeof sessionId !== 'string')
    return response
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Session not found' } });
  const result = await prisma.session.updateMany({
    where: {
      id: sessionId,
      userId: request.auth!.userId,
      organizationId: request.auth!.organizationId,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });
  if (result.count === 0)
    return response
      .status(404)
      .json({ error: { code: 'NOT_FOUND', message: 'Session not found' } });
  await prisma.auditLog.create({
    data: {
      organizationId: request.auth!.organizationId,
      actorUserId: request.auth!.userId,
      action: 'SESSION_REVOKED',
      entityType: 'Session',
      entityId: sessionId,
      ...metadata(request),
    },
  });
  response.status(204).send();
});
