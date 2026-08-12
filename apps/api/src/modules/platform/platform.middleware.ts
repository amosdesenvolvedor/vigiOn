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
    select: { id: true },
  });
  if (!user) {
    console.warn(JSON.stringify({ event: 'platform.admin.denied', userId: request.auth.userId }));
    return next(new AuthError(403, 'PLATFORM_FORBIDDEN', 'Platform access denied'));
  }
  next();
};
