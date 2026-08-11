import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TokenDelivery } from '../auth/auth.types';
import { OrganizationService } from './organization.service';

const prisma = new PrismaClient();
const suffix = randomUUID().slice(0, 8);
const organizationIds: string[] = [];
let deliveredToken = '';
const delivery: TokenDelivery = {
  async sendPasswordReset() {},
  async sendEmailVerification() {},
  async sendOrganizationInvitation(_email, _organizationName, token) {
    deliveredToken = token;
  },
};
const service = new OrganizationService(prisma, delivery);
const metadata = { ipAddress: '127.0.0.1', userAgent: 'Vitest' };
const passwordHash = 'test-only-not-a-real-password-hash';
let planId = '';

async function tenant(label: string) {
  const organization = await prisma.organization.create({
    data: {
      name: `Tenant ${label}`,
      slug: `tenant-${label}-${suffix}`,
      settings: { create: {} },
      storageUsage: { create: {} },
      resourceCounter: { create: { memberCount: 1 } },
    },
  });
  organizationIds.push(organization.id);
  const user = await prisma.user.create({
    data: {
      organizationId: organization.id,
      name: `Owner ${label}`,
      email: `owner-${label}-${suffix}@example.test`,
      normalizedEmail: `owner-${label}-${suffix}@example.test`,
      passwordHash,
      role: 'OWNER',
      status: 'ACTIVE',
    },
  });
  const membership = await prisma.organizationMembership.create({
    data: { organizationId: organization.id, userId: user.id, role: 'OWNER', status: 'ACTIVE' },
  });
  await prisma.subscription.create({
    data: {
      organizationId: organization.id,
      planId,
      status: 'ACTIVE',
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 86_400_000),
    },
  });
  return {
    organization,
    user,
    membership,
    context: {
      organizationId: organization.id,
      userId: user.id,
      membershipId: membership.id,
      role: membership.role,
    },
  };
}

beforeAll(async () => {
  await prisma.$connect();
  const plan = await prisma.plan.create({
    data: {
      name: 'Membership Test',
      slug: `membership-${suffix}`,
      code: `MEMBERSHIP_${suffix.toUpperCase()}`,
      maxCameras: 10,
      maxStorageBytes: 1_000_000n,
      retentionDays: 7,
      maxUsers: 100,
      enabledFeatures: ['MULTI_USER'],
    },
  });
  planId = plan.id;
});

afterAll(async () => {
  await prisma.session.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organizationInvitation.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.limitEvent.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.subscriptionHistory.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.subscription.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organizationMembership.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.organizationSettings.deleteMany({
    where: { organizationId: { in: organizationIds } },
  });
  await prisma.storageUsage.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.resourceCounter.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await prisma.plan.delete({ where: { id: planId } });
  await prisma.$disconnect();
});

describe('organization memberships and isolation', () => {
  it('accepts a hashed invitation and enables secure multi-organization membership', async () => {
    const owner = await tenant('invite-a');
    const invited = await tenant('invite-b');
    const invitation = await service.invite(
      owner.context,
      invited.user.email,
      'OPERATOR',
      metadata,
    );
    expect(invitation.tokenHash).not.toBe(deliveredToken);
    expect(deliveredToken.length).toBeGreaterThan(32);

    const membership = await service.accept(
      invited.user.id,
      invited.user.email,
      deliveredToken,
      metadata,
    );
    expect(membership).toMatchObject({
      organizationId: owner.organization.id,
      role: 'OPERATOR',
      status: 'ACTIVE',
    });
    await expect(
      service.accept(invited.user.id, invited.user.email, deliveredToken, metadata),
    ).rejects.toMatchObject({ code: 'INVALID_INVITATION' });
  });

  it('blocks cross-tenant member access and privilege escalation', async () => {
    const tenantA = await tenant('security-a');
    const tenantB = await tenant('security-b');
    await expect(service.getMember(tenantA.context, tenantB.membership.id)).resolves.toBeNull();

    const viewer = await prisma.user.create({
      data: {
        organizationId: tenantA.organization.id,
        name: 'Viewer',
        email: `viewer-${suffix}@example.test`,
        normalizedEmail: `viewer-${suffix}@example.test`,
        passwordHash,
        role: 'VIEWER',
        status: 'ACTIVE',
      },
    });
    const viewerMembership = await prisma.organizationMembership.create({
      data: {
        organizationId: tenantA.organization.id,
        userId: viewer.id,
        role: 'VIEWER',
        status: 'ACTIVE',
      },
    });
    const viewerContext = {
      organizationId: tenantA.organization.id,
      userId: viewer.id,
      membershipId: viewerMembership.id,
      role: viewerMembership.role,
    };
    await expect(
      service.changeRole(viewerContext, viewerMembership.id, 'OWNER', metadata),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      service.changeRole(tenantA.context, tenantB.membership.id, 'VIEWER', metadata),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('protects the last owner and supports suspend/reactivate with audit', async () => {
    const current = await tenant('owner-protection');
    await expect(
      service.changeStatus(current.context, current.membership.id, 'SUSPENDED', metadata),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    const suspended = await service.setOrganizationStatus(current.context, 'SUSPENDED', metadata);
    expect(suspended.status).toBe('SUSPENDED');
    const active = await service.setOrganizationStatus(current.context, 'ACTIVE', metadata);
    expect(active.status).toBe('ACTIVE');
    const actions = await prisma.auditLog.findMany({
      where: { organizationId: current.organization.id },
      select: { action: true },
    });
    expect(actions.map(({ action }) => action)).toEqual(
      expect.arrayContaining(['ORGANIZATION_SUSPENDED', 'ORGANIZATION_REACTIVATED']),
    );
  });

  it('rejects expired and canceled invitations', async () => {
    const owner = await tenant('expiration-a');
    const invited = await tenant('expiration-b');
    const expired = await service.invite(owner.context, invited.user.email, 'VIEWER', metadata);
    await prisma.organizationInvitation.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(0) },
    });
    await expect(
      service.accept(invited.user.id, invited.user.email, deliveredToken, metadata),
    ).rejects.toMatchObject({ code: 'INVALID_INVITATION' });
    const second = await service.invite(
      owner.context,
      `second-${suffix}@example.test`,
      'VIEWER',
      metadata,
    );
    await service.cancel(owner.context, second.id, metadata);
    await expect(
      service.accept(invited.user.id, `second-${suffix}@example.test`, deliveredToken, metadata),
    ).rejects.toMatchObject({ code: 'INVALID_INVITATION' });
  });
});
