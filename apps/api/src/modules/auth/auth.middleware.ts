import type { RequestHandler } from 'express';
import type { UserRole } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AuthError } from './auth.errors';
import { verifyAccessToken } from './tokens';

export const authenticate: RequestHandler = async (request, _response, next) => {
  try {
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token)
      throw new AuthError(401, 'UNAUTHORIZED', 'Authentication required');
    const auth = verifyAccessToken(token);
    const session = await prisma.session.findFirst({
      where: {
        id: auth.sessionId,
        userId: auth.userId,
        organizationId: auth.organizationId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { status: 'ACTIVE', deletedAt: null },
      },
    });
    if (!session) throw new AuthError(401, 'UNAUTHORIZED', 'Authentication required');
    const membership = await prisma.organizationMembership.findFirst({
      where: {
        id: auth.membershipId,
        userId: auth.userId,
        organizationId: auth.organizationId,
        status: 'ACTIVE',
      },
    });
    if (!membership) throw new AuthError(401, 'UNAUTHORIZED', 'Authentication required');
    request.auth = { ...auth, role: membership.role };
    next();
  } catch (error) {
    next(
      error instanceof AuthError
        ? error
        : new AuthError(401, 'UNAUTHORIZED', 'Authentication required'),
    );
  }
};

export type Permission =
  | 'users:manage'
  | 'cameras:view'
  | 'cameras:manage'
  | 'gateways:view'
  | 'gateways:manage'
  | 'events:view'
  | 'events:manage'
  | 'notifications:view'
  | 'storage:view'
  | 'storage:manage'
  | 'settings:manage'
  | 'plan:manage';

const permissions: Record<UserRole, ReadonlySet<Permission>> = {
  OWNER: new Set<Permission>([
    'users:manage',
    'cameras:view',
    'cameras:manage',
    'gateways:view',
    'gateways:manage',
    'events:view',
    'events:manage',
    'notifications:view',
    'storage:view',
    'storage:manage',
    'settings:manage',
    'plan:manage',
  ]),
  ADMIN: new Set<Permission>([
    'users:manage',
    'cameras:view',
    'cameras:manage',
    'gateways:view',
    'gateways:manage',
    'events:view',
    'events:manage',
    'notifications:view',
    'storage:view',
    'storage:manage',
    'settings:manage',
  ]),
  OPERATOR: new Set<Permission>([
    'cameras:view',
    'gateways:view',
    'events:view',
    'events:manage',
    'notifications:view',
  ]),
  VIEWER: new Set<Permission>(['cameras:view', 'gateways:view', 'events:view']),
};

export const requirePermission =
  (permission: Permission): RequestHandler =>
  (request, _response, next) => {
    if (!request.auth) return next(new AuthError(401, 'UNAUTHORIZED', 'Authentication required'));
    if (!permissions[request.auth.role].has(permission))
      return next(new AuthError(403, 'FORBIDDEN', 'Insufficient permission'));
    next();
  };

export const requireRole =
  (...roles: UserRole[]): RequestHandler =>
  (request, _response, next) => {
    if (!request.auth) return next(new AuthError(401, 'UNAUTHORIZED', 'Authentication required'));
    if (!roles.includes(request.auth.role))
      return next(new AuthError(403, 'FORBIDDEN', 'Insufficient permission'));
    next();
  };
