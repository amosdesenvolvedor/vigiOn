import type { ExternalIdentityProvider, PrismaClient } from '@prisma/client';
import type { Request } from 'express';
import { generators, Issuer, type Client, type TokenSet } from 'openid-client';
import { env } from '../../config/env';
import { logger } from '../../lib/logger';
import { AuthError } from './auth.errors';
import { AuthService } from './auth.service';
import { hashOpaqueToken } from './tokens';
import type { RequestMetadata } from './auth.types';

const transactionTtlMs = 10 * 60_000;
const allowedReturnPaths = new Set(['/', '/monitoring', '/platform']);

export type ProviderConfig = {
  enabled: boolean;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
  redirectUri?: string | undefined;
  discoveryUrl: string;
};

export type OidcClientLike = Pick<Client, 'authorizationUrl' | 'callbackParams' | 'callback'>;
type ClientFactory = (
  provider: ExternalIdentityProvider,
  config: ProviderConfig,
) => Promise<OidcClientLike>;

const providerConfig = (provider: ExternalIdentityProvider): ProviderConfig =>
  provider === 'GOOGLE'
    ? {
        enabled: env.GOOGLE_AUTH_ENABLED,
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        redirectUri: env.GOOGLE_REDIRECT_URI,
        discoveryUrl: 'https://accounts.google.com/.well-known/openid-configuration',
      }
    : {
        enabled: env.MICROSOFT_AUTH_ENABLED,
        clientId: env.MICROSOFT_CLIENT_ID,
        clientSecret: env.MICROSOFT_CLIENT_SECRET,
        redirectUri: env.MICROSOFT_REDIRECT_URI,
        discoveryUrl: `https://login.microsoftonline.com/${encodeURIComponent(env.MICROSOFT_TENANT_ID)}/v2.0/.well-known/openid-configuration`,
      };

const defaultClientFactory: ClientFactory = async (_provider, config) => {
  const issuer = await Issuer.discover(config.discoveryUrl);
  return new issuer.Client({
    client_id: config.clientId!,
    client_secret: config.clientSecret!,
    redirect_uris: [config.redirectUri!],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
  });
};

const safeReturnTo = (value: unknown) =>
  typeof value === 'string' && allowedReturnPaths.has(value) ? value : '/';

export const parseOAuthProvider = (value: string): ExternalIdentityProvider => {
  if (value === 'google') return 'GOOGLE';
  if (value === 'microsoft') return 'MICROSOFT';
  throw new AuthError(404, 'OAUTH_PROVIDER_UNKNOWN', 'OAuth provider is not supported');
};

export class OAuthService {
  private readonly clients = new Map<ExternalIdentityProvider, Promise<OidcClientLike>>();

  constructor(
    private readonly prisma: PrismaClient,
    private readonly auth: AuthService,
    private readonly clientFactory: ClientFactory = defaultClientFactory,
    private readonly configResolver: (provider: ExternalIdentityProvider) => ProviderConfig =
      providerConfig,
  ) {}

  providers() {
    return {
      google: this.configResolver('GOOGLE').enabled,
      microsoft: this.configResolver('MICROSOFT').enabled,
    };
  }

  private configured(provider: ExternalIdentityProvider) {
    const config = this.configResolver(provider);
    if (!config.enabled)
      throw new AuthError(503, 'OAUTH_PROVIDER_DISABLED', 'OAuth provider is disabled');
    if (!config.clientId || !config.clientSecret || !config.redirectUri)
      throw new AuthError(503, 'OAUTH_PROVIDER_MISCONFIGURED', 'OAuth provider is unavailable');
    return config;
  }

  private client(provider: ExternalIdentityProvider, config: ProviderConfig) {
    const existing = this.clients.get(provider);
    if (existing) return existing;
    const created = this.clientFactory(provider, config);
    this.clients.set(provider, created);
    return created;
  }

  async begin(provider: ExternalIdentityProvider, returnTo: unknown) {
    const config = this.configured(provider);
    const client = await this.client(provider, config);
    const state = generators.state();
    const nonce = generators.nonce();
    const pkceVerifier = generators.codeVerifier();
    const codeChallenge = generators.codeChallenge(pkceVerifier);
    await this.prisma.oAuthTransaction.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    await this.prisma.oAuthTransaction.create({
      data: {
        provider,
        stateHash: hashOpaqueToken(state),
        pkceVerifier,
        nonce,
        returnTo: safeReturnTo(returnTo),
        expiresAt: new Date(Date.now() + transactionTtlMs),
      },
    });
    logger.info('oauth.login.started', { provider });
    return client.authorizationUrl({
      scope: 'openid email profile',
      response_type: 'code',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
  }

  async callback(
    provider: ExternalIdentityProvider,
    request: Request,
    metadata: RequestMetadata,
  ) {
    const config = this.configured(provider);
    const client = await this.client(provider, config);
    const params = client.callbackParams(request);
    if (params.error)
      throw new AuthError(400, 'OAUTH_CANCELLED', 'OAuth login was cancelled');
    if (!params.state)
      throw new AuthError(400, 'OAUTH_STATE_INVALID', 'OAuth state is missing or invalid');
    const transaction = await this.prisma.oAuthTransaction.findUnique({
      where: { stateHash: hashOpaqueToken(params.state) },
    });
    if (
      !transaction ||
      transaction.provider !== provider ||
      transaction.usedAt ||
      transaction.expiresAt <= new Date()
    )
      throw new AuthError(400, 'OAUTH_STATE_INVALID', 'OAuth state is invalid or expired');
    const consumed = await this.prisma.oAuthTransaction.updateMany({
      where: { id: transaction.id, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1)
      throw new AuthError(400, 'OAUTH_STATE_REUSED', 'OAuth state was already used');

    let tokenSet: TokenSet;
    try {
      tokenSet = await client.callback(config.redirectUri!, params, {
        state: params.state,
        nonce: transaction.nonce,
        code_verifier: transaction.pkceVerifier,
        response_type: 'code',
      });
    } catch (error) {
      logger.warn('oauth.login.failed', {
        provider,
        reason: error instanceof Error ? error.name : 'OIDC_VALIDATION_FAILED',
      });
      throw new AuthError(400, 'OAUTH_TOKEN_INVALID', 'OAuth identity could not be validated');
    }
    const claims = tokenSet.claims();
    const subject = typeof claims.sub === 'string' ? claims.sub : '';
    const claimedEmail =
      typeof claims.email === 'string'
        ? claims.email
        : provider === 'MICROSOFT' && typeof claims.preferred_username === 'string'
          ? claims.preferred_username
          : '';
    if (!subject || !claimedEmail || !claimedEmail.includes('@'))
      throw new AuthError(400, 'OAUTH_IDENTITY_INCOMPLETE', 'Provider did not return an email');
    const microsoftDomainVerified =
      provider === 'MICROSOFT' && (claims as Record<string, unknown>).xms_edov === true;
    const emailVerified = claims.email_verified === true || microsoftDomainVerified;
    const displayName =
      typeof claims.name === 'string' && claims.name.trim()
        ? claims.name.trim().slice(0, 160)
        : (claimedEmail.split('@')[0] ?? claimedEmail).slice(0, 160);
    const result = await this.auth.loginWithExternalIdentity(
      transaction.id,
      {
        provider,
        subject,
        email: claimedEmail,
        emailVerified,
        displayName,
      },
      metadata,
    );
    logger.info('oauth.login.succeeded', { provider, outcome: result.kind });
    return { ...result, returnTo: transaction.returnTo };
  }

  async completeOnboarding(
    completionToken: string | undefined,
    input: { name: string; organizationName: string; timezone: string },
    metadata: RequestMetadata,
  ) {
    if (!completionToken)
      throw new AuthError(400, 'OAUTH_TRANSACTION_INVALID', 'OAuth transaction is missing');
    return this.auth.completeExternalOnboarding(completionToken, input, metadata);
  }

  async completeMfa(
    completionToken: string | undefined,
    code: string,
    metadata: RequestMetadata,
  ) {
    if (!completionToken)
      throw new AuthError(400, 'OAUTH_TRANSACTION_INVALID', 'OAuth transaction is missing');
    return this.auth.completeExternalMfa(completionToken, code, metadata);
  }
}
