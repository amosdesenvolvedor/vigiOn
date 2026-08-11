import { createHash, randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { UserRole } from '@prisma/client';
import { env } from '../../config/env';
import type { AuthenticatedUser } from './auth.types';

export const createOpaqueToken = () => randomBytes(48).toString('base64url');
export const hashOpaqueToken = (token: string) => createHash('sha256').update(token).digest('hex');

export function createAccessToken(payload: AuthenticatedUser) {
  return jwt.sign(
    { organizationId: payload.organizationId, role: payload.role, sessionId: payload.sessionId },
    env.JWT_ACCESS_SECRET,
    { algorithm: 'HS256', expiresIn: env.ACCESS_TOKEN_TTL_SECONDS, subject: payload.userId },
  );
}

export function verifyAccessToken(token: string): AuthenticatedUser {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
  if (
    typeof decoded === 'string' ||
    typeof decoded.sub !== 'string' ||
    typeof decoded.organizationId !== 'string' ||
    typeof decoded.sessionId !== 'string' ||
    !['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'].includes(String(decoded.role))
  ) {
    throw new Error('Invalid access token claims');
  }
  return {
    userId: decoded.sub,
    organizationId: decoded.organizationId,
    sessionId: decoded.sessionId,
    role: decoded.role as UserRole,
  };
}
