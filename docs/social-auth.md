# Autenticação social (Google e Microsoft)

## Estado e arquitetura

O VigiOn usa OpenID Connect sobre OAuth 2.0 no backend. O login por senha, JWT de acesso,
refresh token HttpOnly, sessões, memberships, autorização multi-tenant e MFA continuam sendo os
mesmos. Tokens Google/Microsoft são usados apenas durante o callback e não são persistidos.

Os provedores começam desativados. Sem credenciais, a API inicia normalmente, informa os
provedores como indisponíveis e a interface não exibe os botões sociais.

Fluxo:

1. O frontend consulta `GET /api/v1/auth/oauth/providers`.
2. `GET /api/v1/auth/oauth/:provider` cria uma transação curta, state aleatório, nonce e PKCE S256.
3. O provedor retorna a `GET /api/v1/auth/oauth/:provider/callback`.
4. `openid-client` valida assinatura, issuer, audience, expiração, nonce, state e PKCE.
5. Uma identidade já vinculada reutiliza a sessão VigiOn existente.
6. Um usuário novo informa nome e organização antes da criação da conta e do plano Free.
7. Uma conta com MFA conclui o desafio TOTP antes de receber uma sessão verificada.

## Redirect URIs

Cadastre exatamente os callbacks públicos no console de cada provedor:

```text
https://vigion.cloud/api/v1/auth/oauth/google/callback
https://vigion.cloud/api/v1/auth/oauth/microsoft/callback
```

Em desenvolvimento, use os endereços HTTPS/HTTP correspondentes ao ambiente e mantenha as
variáveis de redirect idênticas aos valores cadastrados no provedor.

## Google

Crie uma aplicação OAuth Web no Google Cloud/Google Identity, configure a tela de consentimento e
o callback. Depois configure no backend:

```text
GOOGLE_AUTH_ENABLED=true
GOOGLE_CLIENT_ID=<configuração operacional>
GOOGLE_CLIENT_SECRET=<secret no servidor>
GOOGLE_REDIRECT_URI=https://vigion.cloud/api/v1/auth/oauth/google/callback
```

O onboarding de usuário novo exige `email_verified=true` validado no ID Token.

## Microsoft / Entra ID

Registre uma aplicação Web na Microsoft Identity Platform. `common` permite iniciar fluxos para
contas pessoais e corporativas quando o registro do aplicativo também permitir esses tipos.

```text
MICROSOFT_AUTH_ENABLED=true
MICROSOFT_CLIENT_ID=<configuração operacional>
MICROSOFT_CLIENT_SECRET=<secret no servidor>
MICROSOFT_TENANT_ID=common
MICROSOFT_REDIRECT_URI=https://vigion.cloud/api/v1/auth/oauth/microsoft/callback
```

Para onboarding, o VigiOn exige uma indicação verificável do provedor (`email_verified` ou
`xms_edov`). `preferred_username` sozinho nunca é tratado como prova de propriedade do e-mail.

## Identidades, linking e account takeover

`ExternalIdentity` usa a chave única `(provider, providerSubject)`. O e-mail não substitui `sub`.
Uma identidade já vinculada preserva usuário, senha local, organizações, roles, planos e
preferências.

Política conservadora: se o e-mail retornado já pertence a uma conta local, mas o `sub` ainda não
está vinculado, o login é bloqueado com `OAUTH_LINK_REQUIRED`. Não há associação automática por
e-mail. Um futuro fluxo de linking deve exigir primeiro uma sessão local autenticada e confirmação
do provedor.

## MFA e autorização

OAuth altera somente autenticação. OWNER, ADMIN, OPERATOR, VIEWER, PLATFORM_ADMIN, memberships e
isolamento por organização não são alterados. Qualquer conta com MFA, inclusive PLATFORM_ADMIN,
recebe primeiro um desafio TOTP; a sessão só é criada com `mfaVerifiedAt` após validação. O
middleware de `/platform` continua revalidando role, MFA cadastrado e MFA da sessão.

## Segurança operacional

- State é aleatório, armazenado somente como hash, expira em 10 minutos e é consumido uma vez.
- PKCE usa S256; nonce é validado no ID Token.
- Redirect pós-login aceita somente `/`, `/monitoring` e `/platform`.
- Authorization codes, client secrets, ID/access/refresh tokens externos e cookies não são logados.
- Início e callback possuem rate limit.
- Client secrets existem apenas no backend.
- Transações expiradas são removidas no início de novos fluxos.

## Ativação e troubleshooting

1. Cadastre os redirect URIs nos provedores.
2. Adicione Client ID e Client Secret somente ao `.env` de produção.
3. Mude apenas a flag do provedor desejado para `true`.
4. Recrie a API e confirme `GET /api/v1/auth/oauth/providers`.
5. Teste login, onboarding, cancelamento, conta existente e MFA em dispositivo controlado.

Erros comuns: `OAUTH_PROVIDER_DISABLED` (flag desligada), `OAUTH_PROVIDER_MISCONFIGURED`
(configuração incompleta), `OAUTH_STATE_INVALID` (fluxo expirado), `OAUTH_TOKEN_INVALID`
(callback/token rejeitado) e `OAUTH_LINK_REQUIRED` (conta local existente sem vínculo).
