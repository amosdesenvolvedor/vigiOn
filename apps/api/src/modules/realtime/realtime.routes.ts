import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate, requirePermission } from '../auth/auth.middleware';
import { realtimeService } from './realtime.service';
export const realtimeRouter = Router();
realtimeRouter.post(
  '/ticket',
  authenticate,
  requirePermission('events:view'),
  rateLimit({ windowMs: 60_000, max: 20, standardHeaders: true, legacyHeaders: false }),
  async (req, res) => res.json(realtimeService.createTicket(req.auth!)),
);
realtimeRouter.get(
  '/stream',
  rateLimit({ windowMs: 60_000, max: 30, standardHeaders: true, legacyHeaders: false }),
  async (req, res) => {
    const parsed = z.string().min(20).max(100).safeParse(req.query.ticket);
    const ticket = parsed.success ? realtimeService.consume(parsed.data) : null;
    if (!ticket)
      return res.status(401).json({
        error: { code: 'REALTIME_UNAUTHORIZED', message: 'Realtime authentication required' },
      });
    res.set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'x-accel-buffering': 'no',
      connection: 'keep-alive',
    });
    res.flushHeaders();
    if (!realtimeService.connect(ticket, res)) {
      res.end('event: error\ndata: {"code":"CONNECTION_LIMIT"}\n\n');
      return;
    }
    res.write(`event: ready\ndata: {"protocolVersion":1}\n\n`);
  },
);
