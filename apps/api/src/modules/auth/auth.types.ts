import type { UserRole } from '@prisma/client';

export interface AuthenticatedUser {
  userId: string;
  organizationId: string;
  role: UserRole;
  sessionId: string;
}

export interface RequestMetadata {
  ipAddress?: string;
  userAgent?: string;
}

export interface TokenDelivery {
  sendPasswordReset(email: string, token: string): Promise<void>;
  sendEmailVerification(email: string, token: string): Promise<void>;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}
