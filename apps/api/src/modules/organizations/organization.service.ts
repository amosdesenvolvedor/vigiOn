import type { Prisma, PrismaClient, UserRole } from '@prisma/client';
import { AuthError } from '../auth/auth.errors';
import { createOpaqueToken, hashOpaqueToken } from '../auth/tokens';
import type { RequestMetadata, TokenDelivery } from '../auth/auth.types';
import type { TenantContext } from '../tenancy/tenant-context';
import { EntitlementService } from '../billing/entitlement.service';

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const notFound = () => new AuthError(404, 'NOT_FOUND', 'Resource not found');
const forbidden = () => new AuthError(403, 'FORBIDDEN', 'Insufficient permission');

export class OrganizationService {
  private readonly entitlements: EntitlementService;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly delivery: TokenDelivery,
  ) {
    this.entitlements = new EntitlementService(prisma);
  }

  listOrganizations(userId: string) {
    return this.prisma.organizationMembership.findMany({
      where: { userId, status: 'ACTIVE', organization: { deletedAt: null } },
      select: {
        id: true,
        role: true,
        status: true,
        organization: {
          select: { id: true, name: true, slug: true, status: true, timezone: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  getCurrent(context: TenantContext) {
    return this.prisma.organization.findFirst({
      where: { id: context.organizationId, deletedAt: null },
      include: { settings: true },
    });
  }

  async updateCurrent(
    context: TenantContext,
    input: {
      name?: string | undefined;
      timezone?: string | undefined;
      tradeName?: string | null | undefined;
      contactEmail?: string | null | undefined;
      contactPhone?: string | null | undefined;
      country?: string | undefined;
      language?: string | undefined;
      monitoringPreferences?: Record<string, unknown> | undefined;
      notificationPreferences?: Record<string, unknown> | undefined;
    },
    metadata: RequestMetadata,
  ) {
    const { name, timezone, ...settings } = input;
    const organizationData: Prisma.OrganizationUpdateInput = {};
    if (name !== undefined) organizationData.name = name;
    if (timezone !== undefined) organizationData.timezone = timezone;
    const settingsData = settings as Prisma.OrganizationSettingsUncheckedUpdateInput;
    await this.prisma.$transaction(async (tx) => {
      const organization = await tx.organization.update({
        where: { id: context.organizationId },
        data: organizationData,
      });
      await tx.organizationSettings.upsert({
        where: { organizationId: context.organizationId },
        create: {
          ...(settings as Prisma.OrganizationSettingsUncheckedCreateInput),
          organizationId: context.organizationId,
        },
        update: settingsData,
      });
      await this.audit(
        tx,
        context,
        'ORGANIZATION_UPDATED',
        'Organization',
        organization.id,
        metadata,
      );
    });
    return this.getCurrent(context);
  }

  async setOrganizationStatus(
    context: TenantContext,
    status: 'ACTIVE' | 'SUSPENDED',
    metadata: RequestMetadata,
  ) {
    if (context.role !== 'OWNER') throw forbidden();
    const organization = await this.prisma.organization.update({
      where: { id: context.organizationId },
      data: { status },
    });
    await this.prisma.auditLog.create({
      data: {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: status === 'ACTIVE' ? 'ORGANIZATION_REACTIVATED' : 'ORGANIZATION_SUSPENDED',
        entityType: 'Organization',
        entityId: organization.id,
        ...metadata,
      },
    });
    return organization;
  }

  listMembers(context: TenantContext) {
    return this.prisma.organizationMembership.findMany({
      where: { organizationId: context.organizationId, status: { not: 'REMOVED' } },
      select: {
        id: true,
        role: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        user: { select: { id: true, name: true, email: true, emailVerifiedAt: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  getMember(context: TenantContext, id: string) {
    return this.prisma.organizationMembership.findFirst({
      where: { id, organizationId: context.organizationId, status: { not: 'REMOVED' } },
      select: {
        id: true,
        role: true,
        status: true,
        user: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async invite(context: TenantContext, email: string, role: UserRole, metadata: RequestMetadata) {
    this.assertCanAssign(context, role);
    const normalizedEmail = normalizeEmail(email);
    const expired = await this.prisma.organizationInvitation.updateMany({
      where: {
        organizationId: context.organizationId,
        normalizedEmail,
        status: 'PENDING',
        expiresAt: { lte: new Date() },
      },
      data: { status: 'EXPIRED' },
    });
    for (let index = 0; index < expired.count; index += 1)
      await this.entitlements.releaseMember(context.organizationId);
    const duplicate = await this.prisma.organizationInvitation.findFirst({
      where: {
        organizationId: context.organizationId,
        normalizedEmail,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
    });
    if (duplicate)
      throw new AuthError(409, 'INVITATION_EXISTS', 'An active invitation already exists');
    const organization = await this.prisma.organization.findUnique({
      where: { id: context.organizationId },
    });
    if (!organization) throw notFound();
    const existingUser = await this.prisma.user.findUnique({ where: { normalizedEmail } });
    if (existingUser) {
      const membership = await this.prisma.organizationMembership.findUnique({
        where: {
          userId_organizationId: {
            userId: existingUser.id,
            organizationId: context.organizationId,
          },
        },
      });
      if (membership && membership.status !== 'REMOVED')
        throw new AuthError(409, 'MEMBER_EXISTS', 'User is already a member');
    }
    await this.entitlements.reserveMember(context.organizationId);
    const token = createOpaqueToken();
    let invitation;
    try {
      invitation = await this.prisma.organizationInvitation.create({
        data: {
          organizationId: context.organizationId,
          email: email.trim(),
          normalizedEmail,
          role,
          status: 'PENDING',
          tokenHash: hashOpaqueToken(token),
          expiresAt: new Date(Date.now() + 72 * 3_600_000),
          invitedById: context.userId,
        },
      });
    } catch (error) {
      await this.entitlements.releaseMember(context.organizationId);
      throw error;
    }
    await this.prisma.auditLog.create({
      data: {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action: 'MEMBER_INVITED',
        entityType: 'OrganizationInvitation',
        entityId: invitation.id,
        metadata: { role },
        ...metadata,
      },
    });
    await this.deliver(() =>
      this.delivery.sendOrganizationInvitation(email, organization.name, token),
    );
    return invitation;
  }

  async resend(context: TenantContext, id: string, metadata: RequestMetadata) {
    if (!['OWNER', 'ADMIN'].includes(context.role ?? '')) throw forbidden();
    const invitation = await this.prisma.organizationInvitation.findFirst({
      where: { id, organizationId: context.organizationId, status: 'PENDING' },
      include: { organization: true },
    });
    if (!invitation) throw notFound();
    const token = createOpaqueToken();
    const updated = await this.prisma.organizationInvitation.update({
      where: { id },
      data: { tokenHash: hashOpaqueToken(token), expiresAt: new Date(Date.now() + 72 * 3_600_000) },
    });
    await this.audit(
      this.prisma,
      context,
      'INVITATION_RESENT',
      'OrganizationInvitation',
      id,
      metadata,
    );
    await this.deliver(() =>
      this.delivery.sendOrganizationInvitation(
        invitation.email,
        invitation.organization.name,
        token,
      ),
    );
    return updated;
  }

  async cancel(context: TenantContext, id: string, metadata: RequestMetadata) {
    if (!['OWNER', 'ADMIN'].includes(context.role ?? '')) throw forbidden();
    const result = await this.prisma.organizationInvitation.updateMany({
      where: { id, organizationId: context.organizationId, status: 'PENDING' },
      data: { status: 'CANCELED', canceledAt: new Date() },
    });
    if (!result.count) throw notFound();
    await this.entitlements.releaseMember(context.organizationId);
    await this.audit(
      this.prisma,
      context,
      'INVITATION_CANCELED',
      'OrganizationInvitation',
      id,
      metadata,
    );
  }

  async accept(userId: string, email: string, token: string, metadata: RequestMetadata) {
    const invitation = await this.prisma.organizationInvitation.findUnique({
      where: { tokenHash: hashOpaqueToken(token) },
    });
    if (
      !invitation ||
      invitation.status !== 'PENDING' ||
      invitation.expiresAt <= new Date() ||
      invitation.normalizedEmail !== normalizeEmail(email)
    )
      throw new AuthError(400, 'INVALID_INVITATION', 'Invalid or expired invitation');
    return this.prisma.$transaction(async (tx) => {
      const membership = await tx.organizationMembership.upsert({
        where: { userId_organizationId: { userId, organizationId: invitation.organizationId } },
        create: {
          userId,
          organizationId: invitation.organizationId,
          role: invitation.role,
          status: 'ACTIVE',
        },
        update: { role: invitation.role, status: 'ACTIVE' },
      });
      await tx.organizationInvitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED', acceptedAt: new Date() },
      });
      await tx.auditLog.create({
        data: {
          organizationId: invitation.organizationId,
          actorUserId: userId,
          action: 'INVITATION_ACCEPTED',
          entityType: 'OrganizationMembership',
          entityId: membership.id,
          ...metadata,
        },
      });
      return membership;
    });
  }

  async changeRole(context: TenantContext, id: string, role: UserRole, metadata: RequestMetadata) {
    this.assertCanAssign(context, role);
    const target = await this.getTarget(context, id);
    this.assertCanManage(context, target.role, target.userId);
    if (target.role === 'OWNER' && role !== 'OWNER')
      await this.assertAnotherOwner(context.organizationId, target.id);
    const updated = await this.prisma.organizationMembership.update({
      where: { id: target.id },
      data: { role },
    });
    await this.audit(
      this.prisma,
      context,
      'MEMBER_ROLE_CHANGED',
      'OrganizationMembership',
      id,
      metadata,
      { from: target.role, to: role },
    );
    return updated;
  }

  async changeStatus(
    context: TenantContext,
    id: string,
    status: 'ACTIVE' | 'SUSPENDED',
    metadata: RequestMetadata,
  ) {
    const target = await this.getTarget(context, id);
    this.assertCanManage(context, target.role, target.userId);
    if (target.role === 'OWNER' && status === 'SUSPENDED')
      await this.assertAnotherOwner(context.organizationId, target.id);
    const updated = await this.prisma.organizationMembership.update({
      where: { id: target.id },
      data: { status },
    });
    await this.audit(
      this.prisma,
      context,
      status === 'SUSPENDED' ? 'MEMBER_SUSPENDED' : 'MEMBER_REACTIVATED',
      'OrganizationMembership',
      id,
      metadata,
    );
    return updated;
  }

  async remove(context: TenantContext, id: string, metadata: RequestMetadata) {
    const target = await this.getTarget(context, id);
    this.assertCanManage(context, target.role, target.userId);
    if (target.role === 'OWNER') await this.assertAnotherOwner(context.organizationId, target.id);
    await this.prisma.organizationMembership.update({ where: { id }, data: { status: 'REMOVED' } });
    await this.entitlements.releaseMember(context.organizationId);
    await this.prisma.session.updateMany({
      where: { userId: target.userId, organizationId: context.organizationId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await this.audit(
      this.prisma,
      context,
      'MEMBER_REMOVED',
      'OrganizationMembership',
      id,
      metadata,
    );
  }

  private assertCanAssign(context: TenantContext, role: UserRole) {
    if (context.role === 'OWNER') return;
    if (context.role === 'ADMIN' && ['OPERATOR', 'VIEWER'].includes(role)) return;
    throw forbidden();
  }

  private assertCanManage(context: TenantContext, targetRole: UserRole, targetUserId: string) {
    if (targetUserId === context.userId) throw forbidden();
    if (context.role === 'OWNER') return;
    if (context.role === 'ADMIN' && ['OPERATOR', 'VIEWER'].includes(targetRole)) return;
    throw forbidden();
  }

  private async getTarget(context: TenantContext, id: string) {
    const target = await this.prisma.organizationMembership.findFirst({
      where: { id, organizationId: context.organizationId, status: { not: 'REMOVED' } },
    });
    if (!target) throw notFound();
    return target;
  }

  private async assertAnotherOwner(organizationId: string, excludedId: string) {
    const count = await this.prisma.organizationMembership.count({
      where: { organizationId, id: { not: excludedId }, role: 'OWNER', status: 'ACTIVE' },
    });
    if (!count) throw new AuthError(409, 'LAST_OWNER', 'Organization must retain an active owner');
  }

  private audit(
    client: PrismaClient | Prisma.TransactionClient,
    context: TenantContext,
    action: string,
    entityType: string,
    entityId: string,
    request: RequestMetadata,
    details?: Record<string, unknown>,
  ) {
    return client.auditLog.create({
      data: {
        organizationId: context.organizationId,
        actorUserId: context.userId,
        action,
        entityType,
        entityId,
        ...(details ? { metadata: details as Prisma.InputJsonValue } : {}),
        ...request,
      },
    });
  }

  private async deliver(send: () => Promise<void>) {
    try {
      await send();
    } catch {
      console.error('Organization invitation delivery failed');
    }
  }
}
