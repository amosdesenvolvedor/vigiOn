import type { RequestHandler } from 'express';
import { prisma } from '../../lib/prisma';
import { AuthError } from '../auth/auth.errors';
import { verifyGatewaySecret } from './gateway.secret';

export const authenticateGateway: RequestHandler = async (request, _response, next) => {
  try {
    const [scheme, credential] = request.headers.authorization?.split(' ') ?? [];
    const separator = credential?.indexOf('.') ?? -1;
    if (scheme !== 'Gateway' || !credential || separator < 1)
      throw new AuthError(401, 'GATEWAY_UNAUTHORIZED', 'Gateway authentication required');
    const gatewayId = credential.slice(0, separator);
    const secret = credential.slice(separator + 1);
    const gateway = await prisma.gateway.findFirst({ where: { id: gatewayId, deletedAt: null } });
    if (
      !gateway ||
      gateway.status === 'DISABLED' ||
      !verifyGatewaySecret(secret, gateway.secretHash)
    ) {
      console.warn(JSON.stringify({ event: 'gateway.auth_failed', gatewayId }));
      throw new AuthError(401, 'GATEWAY_UNAUTHORIZED', 'Invalid gateway credential');
    }
    request.gatewayAuth = {
      gatewayId: gateway.id,
      organizationId: gateway.organizationId,
      deviceId: gateway.deviceId,
    };
    next();
  } catch (error) {
    next(
      error instanceof AuthError
        ? error
        : new AuthError(401, 'GATEWAY_UNAUTHORIZED', 'Invalid gateway credential'),
    );
  }
};
