import express from 'express';
import request from 'supertest';
import type { UserRole } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const findFirst = vi.hoisted(() => vi.fn());
vi.mock('../../lib/prisma', () => ({ prisma: { user: { findFirst } } }));

import { requirePlatformAdmin } from './platform.middleware';

const appFor = (authenticated: boolean, role: UserRole = 'OWNER') => {
  const app = express();
  if (authenticated)
    app.use((req, _res, next) => {
      req.auth = {
        userId: 'user-id',
        organizationId: 'organization-id',
        membershipId: 'membership-id',
        sessionId: 'session-id',
        role,
      };
      next();
    });
  app.get('/platform', requirePlatformAdmin, (_req, res) => res.status(200).json({ ok: true }));
  app.use(
    (
      error: { status?: number; code?: string },
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => res.status(error.status ?? 500).json({ code: error.code }),
  );
  return app;
};

describe('platform authorization', () => {
  beforeEach(() => findFirst.mockReset());

  it('rejects anonymous requests', async () => {
    const response = await request(appFor(false)).get('/platform');
    expect(response.status).toBe(401);
    expect(findFirst).not.toHaveBeenCalled();
  });

  it.each<UserRole>(['OWNER', 'ADMIN', 'OPERATOR', 'VIEWER'])(
    'rejects tenant role %s without a platform role',
    async (role) => {
      findFirst.mockResolvedValue(null);
      expect((await request(appFor(true, role)).get('/platform')).status).toBe(403);
      expect(findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ platformRole: 'PLATFORM_ADMIN' }),
        }),
      );
    },
  );

  it('allows only an active PLATFORM_ADMIN revalidated from the database', async () => {
    findFirst.mockResolvedValue({ id: 'user-id' });
    expect((await request(appFor(true)).get('/platform')).status).toBe(200);
  });
});
