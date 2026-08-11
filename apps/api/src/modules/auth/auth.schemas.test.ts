import { describe, expect, it } from 'vitest';
import { registerSchema } from './auth.schemas';

describe('registration validation', () => {
  const valid = {
    name: 'Test Owner',
    email: 'owner@example.test',
    password: 'Strong!Password123',
    passwordConfirmation: 'Strong!Password123',
    organizationName: 'Test Organization',
    timezone: 'America/Sao_Paulo',
  };

  it('accepts valid registration data', () =>
    expect(registerSchema.safeParse(valid).success).toBe(true));
  it('rejects an invalid email', () =>
    expect(registerSchema.safeParse({ ...valid, email: 'invalid' }).success).toBe(false));
  it('rejects a weak password', () =>
    expect(
      registerSchema.safeParse({ ...valid, password: 'weak', passwordConfirmation: 'weak' })
        .success,
    ).toBe(false));
});
