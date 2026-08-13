import type { RequestHandler } from 'express';
import { prisma } from '../../lib/prisma';
import { AuthError } from '../auth/auth.errors';

export const requirePlatformAdmin: RequestHandler = async (request, _response, next) => {
  if (!request.auth) return next(new AuthError(401, 'UNAUTHORIZED', 'Authentication required'));
  const user = await prisma.user.findFirst({
    where: {
      id: request.auth.userId,
      status: 'ACTIVE',
      deletedAt: null,
      platformRole: 'PLATFORM_ADMIN',
    },
    select: { id: true, mfaCredential: { select: { enabledAt: true } } },
  });
  if (!user) {
    console.warn(JSON.stringify({ event: 'platform.admin.denied', userId: request.auth.userId }));
    return next(new AuthError(403, 'PLATFORM_FORBIDDEN', 'Platform access denied'));
  }
  if (!user.mfaCredential?.enabledAt) {
    return next(new AuthError(403, 'MFA_ENROLLMENT_REQUIRED', 'MFA enrollment required'));
  }
  const session = await prisma.session.findFirst({
    where: { id: request.auth.sessionId, userId: user.id, revokedAt: null, mfaVerifiedAt: { not: null } },
    select: { id: true },
  });
  if (!session) return next(new AuthError(403, 'MFA_REQUIRED', 'Multi-factor authentication required'));
  next();
};
