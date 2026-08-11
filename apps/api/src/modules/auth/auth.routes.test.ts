import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { hashPassword } from './password';

const prisma = new PrismaClient();
const suffix = randomUUID().slice(0, 8);
let organizationId = '';

beforeAll(async () => {
  const organization = await prisma.organization.create({
    data: { name: 'HTTP Security', slug: `http-security-${suffix}` },
  });
  organizationId = organization.id;
  const user = await prisma.user.create({
    data: {
      organizationId,
      name: 'HTTP User',
      email: `http-${suffix}@example.test`,
      normalizedEmail: `http-${suffix}@example.test`,
      passwordHash: await hashPassword('Strong!Password123'),
      role: 'OWNER',
      status: 'ACTIVE',
    },
  });
  await prisma.organizationMembership.create({
    data: { organizationId, userId: user.id, role: 'OWNER', status: 'ACTIVE' },
  });
});

afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { organizationId } });
  await prisma.organizationMembership.deleteMany({ where: { organizationId } });
  await prisma.user.deleteMany({ where: { organizationId } });
  await prisma.organization.delete({ where: { id: organizationId } });
  await prisma.$disconnect();
});

describe('authentication HTTP security', () => {
  it('returns an access token but never password, refresh token, or token hashes', async () => {
    const response = await request(createApp())
      .post('/api/v1/auth/login')
      .send({ email: `http-${suffix}@example.test`, password: 'Strong!Password123' });
    expect(response.status).toBe(200);
    expect(response.body.session.accessToken).toEqual(expect.any(String));
    expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|refreshToken|tokenHash/);
    expect(response.headers['set-cookie']?.[0]).toMatch(/HttpOnly.*SameSite=Strict/);
  });

  it('uses a generic response for unknown recovery emails', async () => {
    const response = await request(createApp())
      .post('/api/v1/auth/forgot-password')
      .send({ email: `unknown-${suffix}@example.test` });
    expect(response.status).toBe(200);
    expect(response.body.message).toMatch(/If the address is registered/);
  });
});
