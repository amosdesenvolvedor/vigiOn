import { Router, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { prisma } from '../../lib/prisma';
import { authenticate } from '../auth/auth.middleware';
import { AiSupportService } from './ai-support.service';

export const aiSupportRouter = Router();
const service = new AiSupportService(prisma);
const chatSchema = z.object({ message: z.string().trim().min(1).max(env.AI_MAX_INPUT_CHARS), conversationId: z.string().uuid().optional() }).strict();
const limiter = rateLimit({ windowMs: 60_000, max: 5, standardHeaders: true, legacyHeaders: false, keyGenerator: (request) => `${request.auth?.organizationId}:${request.auth?.userId}` });
const metadata = (request: Request) => ({ requestId: String(request.res?.locals.requestId ?? ''), ...(request.ip ? { ipAddress: request.ip } : {}), ...(request.get('user-agent') ? { userAgent: request.get('user-agent')!.slice(0, 512) } : {}) });

aiSupportRouter.use(authenticate);
aiSupportRouter.get('/status', async (request, response, next) => { try { response.json(await service.status(request.auth!)); } catch (error) { next(error); } });
aiSupportRouter.get('/conversations/:id', async (request, response, next) => { try { response.json({ conversation: await service.history(request.auth!, z.string().uuid().parse(request.params.id)) }); } catch (error) { next(error); } });
aiSupportRouter.post('/chat', limiter, async (request, response, next) => { try { const input = chatSchema.parse(request.body); response.json(await service.chat(request.auth!, { message: input.message, ...(input.conversationId ? { conversationId: input.conversationId } : {}) }, metadata(request))); } catch (error) { next(error); } });
