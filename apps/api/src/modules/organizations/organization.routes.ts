import { Router, type Request } from 'express';
import { prisma } from '../../lib/prisma';
import { AuthError } from '../auth/auth.errors';
import { authenticate, requirePermission, requireRole } from '../auth/auth.middleware';
import { createAccessToken } from '../auth/tokens';
import { tokenDelivery } from '../auth/token-delivery';
import type { RequestMetadata } from '../auth/auth.types';
import {
  invitationSchema,
  invitationTokenSchema,
  roleSchema,
  statusSchema,
  updateOrganizationSchema,
} from './organization.schemas';
import { OrganizationService } from './organization.service';

export const organizationRouter = Router();
const service = new OrganizationService(prisma, tokenDelivery);
const publicInvitation = <T extends { tokenHash: string }>(invitation: T) => {
  const { tokenHash, ...safe } = invitation;
  void tokenHash;
  return safe;
};

const metadata = (request: Request): RequestMetadata => ({
  ...(request.ip ? { ipAddress: request.ip } : {}),
  ...(request.get('user-agent') ? { userAgent: request.get('user-agent')!.slice(0, 512) } : {}),
});
const context = (request: Request) => request.auth!;
const id = (request: Request) => {
  const value = request.params.id;
  if (typeof value !== 'string') throw new AuthError(404, 'NOT_FOUND', 'Resource not found');
  return value;
};
const requireActive = async (request: Request) => {
  const organization = await prisma.organization.findFirst({
    where: { id: context(request).organizationId, status: 'ACTIVE', deletedAt: null },
  });
  if (!organization)
    throw new AuthError(403, 'ORGANIZATION_SUSPENDED', 'Organization is not active');
};

organizationRouter.use(authenticate);

organizationRouter.get('/', async (request, response, next) => {
  try {
    response.json({
      organizations: await service.listOrganizations(context(request).userId),
      currentOrganizationId: context(request).organizationId,
    });
  } catch (error) {
    next(error);
  }
});

organizationRouter.get('/current', async (request, response, next) => {
  try {
    await requireActive(request);
    response.json({ organization: await service.getCurrent(context(request)) });
  } catch (error) {
    next(error);
  }
});

organizationRouter.patch(
  '/current',
  requirePermission('settings:manage'),
  async (request, response, next) => {
    try {
      await requireActive(request);
      response.json({
        organization: await service.updateCurrent(
          context(request),
          updateOrganizationSchema.parse(request.body),
          metadata(request),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

organizationRouter.post(
  '/current/suspend',
  requireRole('OWNER'),
  async (request, response, next) => {
    try {
      await requireActive(request);
      response.json({
        organization: await service.setOrganizationStatus(
          context(request),
          'SUSPENDED',
          metadata(request),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

organizationRouter.post(
  '/current/reactivate',
  requireRole('OWNER'),
  async (request, response, next) => {
    try {
      response.json({
        organization: await service.setOrganizationStatus(
          context(request),
          'ACTIVE',
          metadata(request),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

organizationRouter.get('/members', async (request, response, next) => {
  try {
    await requireActive(request);
    response.json({ members: await service.listMembers(context(request)) });
  } catch (error) {
    next(error);
  }
});

organizationRouter.get('/members/:id', async (request, response, next) => {
  try {
    await requireActive(request);
    const member = await service.getMember(context(request), id(request));
    if (!member) throw new AuthError(404, 'NOT_FOUND', 'Resource not found');
    response.json({ member });
  } catch (error) {
    next(error);
  }
});

organizationRouter.patch(
  '/members/:id/role',
  requirePermission('users:manage'),
  async (request, response, next) => {
    try {
      await requireActive(request);
      const { role } = roleSchema.parse(request.body);
      response.json({
        membership: await service.changeRole(
          context(request),
          id(request),
          role,
          metadata(request),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

organizationRouter.patch(
  '/members/:id/status',
  requirePermission('users:manage'),
  async (request, response, next) => {
    try {
      await requireActive(request);
      const { status } = statusSchema.parse(request.body);
      response.json({
        membership: await service.changeStatus(
          context(request),
          id(request),
          status,
          metadata(request),
        ),
      });
    } catch (error) {
      next(error);
    }
  },
);

organizationRouter.delete(
  '/members/:id',
  requirePermission('users:manage'),
  async (request, response, next) => {
    try {
      await requireActive(request);
      await service.remove(context(request), id(request), metadata(request));
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

organizationRouter.post(
  '/invitations',
  requirePermission('users:manage'),
  async (request, response, next) => {
    try {
      await requireActive(request);
      const input = invitationSchema.parse(request.body);
      const invitation = await service.invite(
        context(request),
        input.email,
        input.role,
        metadata(request),
      );
      response.status(201).json({ invitation: publicInvitation(invitation) });
    } catch (error) {
      next(error);
    }
  },
);

organizationRouter.post(
  '/invitations/:id/resend',
  requirePermission('users:manage'),
  async (request, response, next) => {
    try {
      await requireActive(request);
      const invitation = await service.resend(context(request), id(request), metadata(request));
      response.json({ invitation: publicInvitation(invitation) });
    } catch (error) {
      next(error);
    }
  },
);

organizationRouter.delete(
  '/invitations/:id',
  requirePermission('users:manage'),
  async (request, response, next) => {
    try {
      await requireActive(request);
      await service.cancel(context(request), id(request), metadata(request));
      response.status(204).send();
    } catch (error) {
      next(error);
    }
  },
);

organizationRouter.post('/invitations/accept', async (request, response, next) => {
  try {
    const { token } = invitationTokenSchema.parse(request.body);
    const user = await prisma.user.findUnique({ where: { id: context(request).userId } });
    if (!user) throw new AuthError(401, 'UNAUTHORIZED', 'Authentication required');
    response.json({
      membership: await service.accept(user.id, user.email, token, metadata(request)),
    });
  } catch (error) {
    next(error);
  }
});

organizationRouter.post('/:id/switch', async (request, response, next) => {
  try {
    const membership = await prisma.organizationMembership.findFirst({
      where: {
        userId: context(request).userId,
        organizationId: id(request),
        status: 'ACTIVE',
        organization: { status: 'ACTIVE', deletedAt: null },
      },
    });
    if (!membership) throw new AuthError(404, 'NOT_FOUND', 'Resource not found');
    await prisma.session.update({
      where: { id: context(request).sessionId },
      data: { organizationId: membership.organizationId },
    });
    const accessToken = createAccessToken({
      userId: context(request).userId,
      organizationId: membership.organizationId,
      membershipId: membership.id,
      role: membership.role,
      sessionId: context(request).sessionId,
    });
    response.json({ session: { accessToken }, organizationId: membership.organizationId });
  } catch (error) {
    next(error);
  }
});
