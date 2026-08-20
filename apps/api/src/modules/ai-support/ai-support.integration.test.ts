import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AiTools } from './ai-tools';
import { AiQuotaService } from './quota.service';

const prisma = new PrismaClient();
const suffix = randomUUID().slice(0, 8);
const organizationIds: string[] = [];
async function tenant(label: string) {
  const organization = await prisma.organization.create({ data: { name: `AI ${label}`, slug: `ai-${label}-${suffix}` } });
  organizationIds.push(organization.id);
  const user = await prisma.user.create({ data: { organizationId: organization.id, name: label, email: `${label}-${suffix}@test.local`, normalizedEmail: `${label}-${suffix}@test.local`, passwordHash: 'test', status: 'ACTIVE', role: 'OWNER' } });
  const membership = await prisma.organizationMembership.create({ data: { organizationId: organization.id, userId: user.id, role: 'OWNER', status: 'ACTIVE' } });
  return { organization, user, auth: { organizationId: organization.id, userId: user.id, membershipId: membership.id, sessionId: randomUUID(), role: 'OWNER' as const } };
}
beforeAll(() => prisma.$connect());
afterAll(async () => {
  await prisma.aiUsageDay.deleteMany({ where: { OR: [{ organizationId: { in: organizationIds } }, { scopeKey: 'global' }] } });
  await prisma.camera.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.user.deleteMany({ where: { organizationId: { in: organizationIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  await prisma.$disconnect();
});

describe('AI Support tenant, RBAC and quota', () => {
  it('never reads a camera from another tenant', async () => {
    const tenantA = await tenant('tenant-a'); const tenantB = await tenant('tenant-b');
    const camera = await prisma.camera.create({ data: { organizationId: tenantB.organization.id, name: 'Câmera secreta', connectionType: 'WIFI', protocol: 'RTSP' } });
    await expect(new AiTools(prisma, tenantA.auth).execute('get_camera_status', { id: camera.id })).rejects.toMatchObject({ status: 404 });
  });
  it('does not advertise or execute platform tools for a tenant owner', async () => {
    const current = await tenant('rbac'); const tools = new AiTools(prisma, current.auth);
    expect((await tools.definitions()).map(({ function: item }) => item.name)).not.toContain('get_platform_health');
    await expect(tools.execute('get_platform_health', {})).rejects.toMatchObject({ status: 403 });
  });
  it('enforces the configured daily user quota atomically', async () => {
    const current = await tenant('quota'); const quota = new AiQuotaService(prisma);
    for (let index = 0; index < 10; index++) await quota.consume(current.user.id, current.organization.id);
    await expect(quota.consume(current.user.id, current.organization.id)).rejects.toMatchObject({ status: 429, code: 'AI_QUOTA_EXCEEDED' });
  });
});
