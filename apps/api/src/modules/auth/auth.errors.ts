export class AuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const invalidCredentials = () =>
  new AuthError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
