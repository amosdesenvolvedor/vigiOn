import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import type { UserRole } from '@prisma/client';
import { requirePermission } from './auth.middleware';

const statuses: Record<
  UserRole,
  { manageUsers: number; manageEvents: number; manageCameras: number; manageGateways: number }
> = {
  OWNER: { manageUsers: 204, manageEvents: 204, manageCameras: 204, manageGateways: 204 },
  ADMIN: { manageUsers: 204, manageEvents: 204, manageCameras: 204, manageGateways: 204 },
  OPERATOR: { manageUsers: 403, manageEvents: 204, manageCameras: 403, manageGateways: 403 },
  VIEWER: { manageUsers: 403, manageEvents: 403, manageCameras: 403, manageGateways: 403 },
};

describe.each(Object.entries(statuses) as [UserRole, (typeof statuses)[UserRole]][])(
  '%s authorization',
  (role, expected) => {
    const app = express();
    app.use((req, _res, next) => {
      req.auth = {
        userId: 'user',
        organizationId: 'org',
        membershipId: 'membership',
        sessionId: 'session',
        role,
      };
      next();
    });
    app.get('/users', requirePermission('users:manage'), (_req, res) => res.status(204).send());
    app.get('/events', requirePermission('events:manage'), (_req, res) => res.status(204).send());
    app.post('/cameras', requirePermission('cameras:manage'), (_req, res) =>
      res.status(204).send(),
    );
    app.post('/gateways', requirePermission('gateways:manage'), (_req, res) =>
      res.status(204).send(),
    );
    app.use(
      (
        error: { status?: number },
        _req: express.Request,
        res: express.Response,
        _next: express.NextFunction,
      ) => res.status(error.status ?? 500).send(),
    );

    it('applies the permission matrix', async () => {
      expect((await request(app).get('/users')).status).toBe(expected.manageUsers);
      expect((await request(app).get('/events')).status).toBe(expected.manageEvents);
      expect((await request(app).post('/cameras')).status).toBe(expected.manageCameras);
      expect((await request(app).post('/gateways')).status).toBe(expected.manageGateways);
    });
  },
);
