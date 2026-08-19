import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAccessToken } from '../auth/tokens';
import { errorHandler } from '../../middleware/error-handler';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  membership: vi.fn(),
  variants: vi.fn(),
  log: vi.fn(),
  cameraCreate: vi.fn(),
}));
vi.mock('../../lib/prisma', () => ({
  prisma: {
    session: { findFirst: mocks.session },
    organizationMembership: { findFirst: mocks.membership },
    cameraCatalogVariant: { findMany: mocks.variants },
    camera: { create: mocks.cameraCreate },
  },
}));
vi.mock('../../lib/logger', () => ({
  logger: { info: mocks.log, warn: vi.fn(), error: vi.fn() },
}));

import { cameraOnboardingRouter } from './qr-analysis.routes';

const auth = {
  userId: 'user-a',
  organizationId: 'organization-a',
  membershipId: 'membership-a',
  sessionId: 'session-a',
  role: 'OWNER' as const,
};
const token = createAccessToken(auth);
const app = express();
app.use(express.json());
app.use('/api/v1/camera-onboarding', cameraOnboardingRouter);
app.use(errorHandler);

beforeEach(() => {
  mocks.session.mockResolvedValue({ id: auth.sessionId });
  mocks.membership.mockResolvedValue({ id: auth.membershipId, role: auth.role });
  mocks.variants.mockResolvedValue([]);
  mocks.cameraCreate.mockClear();
  mocks.log.mockClear();
});

describe('QR onboarding API boundary', () => {
  it('requires authentication', async () => {
    expect(
      (await request(app).post('/api/v1/camera-onboarding/qr/analyze').send({ payload: 'text' }))
        .status,
    ).toBe(401);
  });

  it('analyzes in the authenticated tenant context without logging payload or creating a camera', async () => {
    const secret = 'token=do-not-log-this-value';
    const response = await request(app)
      .post('/api/v1/camera-onboarding/qr/analyze')
      .set('authorization', `Bearer ${token}`)
      .send({ payload: secret });
    expect(response.status).toBe(200);
    expect(response.body.analysis.requiresUserConfirmation).toBe(true);
    expect(mocks.cameraCreate).not.toHaveBeenCalled();
    const logs = JSON.stringify(mocks.log.mock.calls);
    expect(logs).toContain(auth.organizationId);
    expect(logs).not.toContain(secret);
    expect(logs).not.toContain('do-not-log-this-value');
  });

  it('rate limits repeated authenticated analysis', async () => {
    let status = 200;
    for (let index = 0; index < 31 && status !== 429; index += 1) {
      status = (
        await request(app)
          .post('/api/v1/camera-onboarding/qr/analyze')
          .set('authorization', `Bearer ${token}`)
          .send({ payload: `unknown-${index}` })
      ).status;
    }
    expect(status).toBe(429);
  });
});
