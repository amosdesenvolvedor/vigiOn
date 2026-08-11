import type { TokenDelivery } from './auth.types';

// A real provider will implement this interface in a later integration step.
// Tokens are deliberately not logged or returned by HTTP endpoints.
export const tokenDelivery: TokenDelivery = {
  async sendPasswordReset() {},
  async sendEmailVerification() {},
};
