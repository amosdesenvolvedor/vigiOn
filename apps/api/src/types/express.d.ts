import type { AuthenticatedUser } from '../modules/auth/auth.types';

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedUser;
    }
  }
}

export {};
