import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { AuthError } from '../modules/auth/auth.errors';
import { PlanLimitError } from '../modules/billing/plan-limit.error';

export const notFoundHandler: RequestHandler = (_request, response) => {
  response.status(404).json({ error: { code: 'NOT_FOUND', message: 'Resource not found' } });
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof PlanLimitError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        resource: error.resource,
        current: error.current.toString(),
        limit: error.limit.toString(),
        upgradeRequired: error.upgradeRequired,
      },
    });
    return;
  }
  if (error instanceof AuthError) {
    response.status(error.status).json({ error: { code: error.code, message: error.message } });
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request',
        fields: error.flatten().fieldErrors,
      },
    });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    response
      .status(409)
      .json({ error: { code: 'CONFLICT', message: 'Unable to complete request' } });
    return;
  }
  console.error(error);
  response.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
  });
};
