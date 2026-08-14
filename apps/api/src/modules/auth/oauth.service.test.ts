import type { ExternalIdentityProvider, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import type { TokenSet } from 'openid-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import {
  OAuthService,
  type OidcClientLike,
  type ProviderConfig,
} from './oauth.service';

const enabledConfig = (_provider: ExternalIdentityProvider): ProviderConfig => ({
  enabled: true,
  clientId: 'client-id',
  clientSecret: 'client-secret-for-tests',
  redirectUri: 'https://app.example.test/api/v1/auth/oauth/provider/callback',
  discoveryUrl: 'https://issuer.example.test/.well-known/openid-configuration',
});

const metadata = { ipAddress: '127.0.0.1', userAgent: 'Vitest' };

function harness(claims: Record<string, unknown> = {}) {
  let transaction: Record<string, unknown> | null = null;
  let authorizationParameters: Record<string, unknown> | undefined;
  const callback = vi.fn(async () => ({ claims: () => claims }) as unknown as TokenSet);
  const client = {
    authorizationUrl: vi.fn((parameters: Record<string, unknown>) => {
      authorizationParameters = parameters;
      return `https://issuer.example.test/authorize?state=${parameters.state}`;
    }),
    callbackParams: vi.fn((request: Request) => request.query),
    callback,
  } as unknown as OidcClientLike;
  const prisma = {
    oAuthTransaction: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        transaction = {
          id: 'transaction-id',
          usedAt: null,
          completedAt: null,
          ...data,
        };
        return transaction;
      }),
      findUnique: vi.fn(async ({ where }: { where: { stateHash: string } }) =>
        transaction && transaction.stateHash === where.stateHash ? transaction : null,
      ),
      updateMany: vi.fn(async () => {
        if (!transaction || transaction.usedAt) return { count: 0 };
        transaction.usedAt = new Date();
        return { count: 1 };
      }),
    },
  } as unknown as PrismaClient;
  const auth = {
    loginWithExternalIdentity: vi.fn(async () => ({
      kind: 'ONBOARDING' as const,
      completionToken: 'completion-token',
    })),
  } as unknown as AuthService;
  const service = new OAuthService(prisma, auth, async () => client, enabledConfig);
  return {
    service,
    auth,
    client,
    callback,
    get transaction() {
      return transaction;
    },
    get authorizationParameters() {
      return authorizationParameters;
    },
  };
}

const callbackRequest = (state: string) =>
  ({ query: { state, code: 'authorization-code' } }) as unknown as Request;

describe('OAuth/OIDC protocol security', () => {
  it('keeps disabled providers unavailable without credentials', async () => {
    const h = harness();
    const disabled = new OAuthService(
      {} as PrismaClient,
      {} as AuthService,
      async () => h.client,
      () => ({ ...enabledConfig('GOOGLE'), enabled: false }),
    );
    expect(disabled.providers()).toEqual({ google: false, microsoft: false });
    await expect(disabled.begin('GOOGLE', '/')).rejects.toMatchObject({
      code: 'OAUTH_PROVIDER_DISABLED',
    });
  });

  it('starts authorization with cryptographic state, nonce, and S256 PKCE', async () => {
    const h = harness();
    const url = await h.service.begin('GOOGLE', '/platform');
    expect(url).toContain('state=');
    expect(h.authorizationParameters).toMatchObject({
      response_type: 'code',
      scope: 'openid email profile',
      code_challenge_method: 'S256',
    });
    expect(h.authorizationParameters?.state).toEqual(expect.any(String));
    expect(h.authorizationParameters?.nonce).toEqual(expect.any(String));
    expect(h.authorizationParameters?.code_challenge).toEqual(expect.any(String));
    expect(h.transaction).toMatchObject({ provider: 'GOOGLE', returnTo: '/platform' });
  });

  it('blocks open redirects', async () => {
    const h = harness();
    await h.service.begin('GOOGLE', 'https://attacker.example/path');
    expect(h.transaction).toMatchObject({ returnTo: '/' });
  });

  it.each<ExternalIdentityProvider>(['GOOGLE', 'MICROSOFT'])(
    'accepts a fully validated %s callback and never handles provider tokens itself',
    async (provider) => {
      const h = harness({
        sub: `${provider.toLowerCase()}-subject`,
        email: `${provider.toLowerCase()}@example.test`,
        email_verified: true,
        name: 'Social User',
      });
      const url = await h.service.begin(provider, '/');
      const state = new URL(url).searchParams.get('state')!;
      await expect(h.service.callback(provider, callbackRequest(state), metadata)).resolves.toMatchObject({
        kind: 'ONBOARDING',
      });
      expect(h.callback).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({
          state,
          nonce: expect.any(String),
          code_verifier: expect.any(String),
          response_type: 'code',
        }),
      );
    },
  );

  it('rejects missing, invalid, expired, and reused state', async () => {
    const h = harness({ sub: 'subject', email: 'user@example.test', email_verified: true });
    await expect(
      h.service.callback('GOOGLE', { query: {} } as unknown as Request, metadata),
    ).rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' });
    await expect(
      h.service.callback('GOOGLE', callbackRequest('invalid-state'), metadata),
    ).rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' });
    const url = await h.service.begin('GOOGLE', '/');
    const state = new URL(url).searchParams.get('state')!;
    (h.transaction as { expiresAt: Date }).expiresAt = new Date(Date.now() - 1);
    await expect(h.service.callback('GOOGLE', callbackRequest(state), metadata)).rejects.toMatchObject({
      code: 'OAUTH_STATE_INVALID',
    });

    const second = harness({ sub: 'subject', email: 'user@example.test', email_verified: true });
    const secondState = new URL(await second.service.begin('GOOGLE', '/')).searchParams.get('state')!;
    await second.service.callback('GOOGLE', callbackRequest(secondState), metadata);
    await expect(
      second.service.callback('GOOGLE', callbackRequest(secondState), metadata),
    ).rejects.toMatchObject({ code: 'OAUTH_STATE_INVALID' });
  });

  it.each(['invalid signature', 'invalid issuer', 'invalid audience', 'invalid nonce'])(
    'rejects an ID Token with %s',
    async () => {
      const h = harness();
      h.callback.mockRejectedValueOnce(new Error('OIDC validation failed'));
      const state = new URL(await h.service.begin('GOOGLE', '/')).searchParams.get('state')!;
      await expect(h.service.callback('GOOGLE', callbackRequest(state), metadata)).rejects.toMatchObject({
        code: 'OAUTH_TOKEN_INVALID',
      });
    },
  );

  it('preserves an MFA outcome without issuing a direct privileged session', async () => {
    const h = harness({ sub: 'admin-subject', email: 'admin@example.test', email_verified: true });
    vi.mocked(h.auth.loginWithExternalIdentity).mockResolvedValueOnce({
      kind: 'MFA',
      completionToken: 'mfa-completion-token',
    });
    const state = new URL(await h.service.begin('GOOGLE', '/platform')).searchParams.get('state')!;
    const result = await h.service.callback('GOOGLE', callbackRequest(state), metadata);
    expect(result).toMatchObject({ kind: 'MFA', returnTo: '/platform' });
    expect(result).not.toHaveProperty('tokens');
  });
});

describe('external identity account-takeover prevention', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('never links an unbound Microsoft identity to an existing matching email', async () => {
    const prisma = {
      externalIdentity: { findUnique: vi.fn(async () => null) },
      user: { findUnique: vi.fn(async () => ({ id: 'existing-user' })) },
    } as unknown as PrismaClient;
    const auth = new AuthService(prisma, {
      async sendPasswordReset() {},
      async sendEmailVerification() {},
      async sendOrganizationInvitation() {},
    });
    await expect(
      auth.loginWithExternalIdentity(
        'transaction-id',
        {
          provider: 'MICROSOFT',
          subject: 'new-microsoft-subject',
          email: 'existing@example.test',
          emailVerified: true,
          displayName: 'Existing User',
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: 'OAUTH_LINK_REQUIRED' });
  });

  it('links a verified Google identity to a verified account and preserves MFA', async () => {
    const createIdentity = vi.fn(async () => ({ id: 'external-id' }));
    const updateTransaction = vi.fn(async () => ({}));
    const prisma = {
      externalIdentity: { findUnique: vi.fn(async () => null), create: createIdentity },
      user: {
        findUnique: vi.fn(async () => ({
          id: 'existing-user',
          emailVerifiedAt: new Date(),
          status: 'ACTIVE',
          deletedAt: null,
          memberships: [{ id: 'membership-id', organizationId: 'organization-id', role: 'OWNER' }],
        })),
      },
      mfaCredential: { findUnique: vi.fn(async () => ({ enabledAt: new Date() })) },
      oAuthTransaction: { update: updateTransaction },
    } as unknown as PrismaClient;
    const auth = new AuthService(prisma, {
      async sendPasswordReset() {},
      async sendEmailVerification() {},
      async sendOrganizationInvitation() {},
    });
    await expect(
      auth.loginWithExternalIdentity(
        'transaction-id',
        {
          provider: 'GOOGLE',
          subject: 'google-subject',
          email: 'existing@example.test',
          emailVerified: true,
          displayName: 'Existing User',
        },
        metadata,
      ),
    ).resolves.toMatchObject({ kind: 'MFA', completionToken: expect.any(String) });
    expect(createIdentity).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: 'existing-user', provider: 'GOOGLE' }),
    });
    expect(updateTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ completionPurpose: 'MFA' }) }),
    );
  });

  it('requires a verified provider email before onboarding a new account', async () => {
    const prisma = {
      externalIdentity: { findUnique: vi.fn(async () => null) },
      user: { findUnique: vi.fn(async () => null) },
    } as unknown as PrismaClient;
    const auth = new AuthService(prisma, {
      async sendPasswordReset() {},
      async sendEmailVerification() {},
      async sendOrganizationInvitation() {},
    });
    await expect(
      auth.loginWithExternalIdentity(
        'transaction-id',
        {
          provider: 'MICROSOFT',
          subject: 'microsoft-subject',
          email: 'new@example.test',
          emailVerified: false,
          displayName: 'New User',
        },
        metadata,
      ),
    ).rejects.toMatchObject({ code: 'OAUTH_EMAIL_UNVERIFIED' });
  });
});
