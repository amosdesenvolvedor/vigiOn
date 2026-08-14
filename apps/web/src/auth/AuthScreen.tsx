import { useEffect, useState, type ChangeEventHandler, type FormEvent } from 'react';
import { ApiError, apiRequest, apiUrl, setAccessToken } from './api';
import { useAuth } from './AuthContext';
import { BrandName } from '../branding/BrandName';

type View = 'login' | 'register' | 'forgot' | 'reset' | 'oauth-onboarding' | 'oauth-mfa';

const oauthErrorMessages: Record<string, string> = {
  OAUTH_CANCELLED: 'O login social foi cancelado.',
  OAUTH_STATE_INVALID: 'A tentativa de login expirou ou é inválida. Tente novamente.',
  OAUTH_STATE_REUSED: 'Esta tentativa de login já foi utilizada. Tente novamente.',
  OAUTH_TOKEN_INVALID: 'Não foi possível validar sua identidade no provedor.',
  OAUTH_IDENTITY_INCOMPLETE: 'O provedor não forneceu um e-mail válido.',
  OAUTH_EMAIL_UNVERIFIED: 'O provedor não confirmou a verificação do e-mail.',
  OAUTH_LINK_REQUIRED: 'Já existe uma conta com este e-mail. Entre com sua senha antes de vincular o provedor.',
  OAUTH_ACCOUNT_UNAVAILABLE: 'Esta conta não está disponível para acesso.',
  OAUTH_PROVIDER_DISABLED: 'Este provedor de login ainda não está disponível.',
  OAUTH_UNAVAILABLE: 'O login social está temporariamente indisponível.',
};

const validationMessages: Record<string, string> = {
  'Password must contain at least 8 characters': 'A senha deve ter pelo menos 8 caracteres.',
  'Password must include a lowercase letter': 'Inclua pelo menos uma letra minúscula.',
  'Password must include an uppercase letter': 'Inclua pelo menos uma letra maiúscula.',
  'Password must include a number': 'Inclua pelo menos um número.',
  'Password must include a symbol': 'Inclua pelo menos um símbolo.',
  'Passwords do not match': 'As senhas não coincidem.',
  'Invalid email': 'Informe um e-mail válido.',
};

function friendlyError(reason: unknown) {
  if (!(reason instanceof ApiError))
    return reason instanceof Error ? reason.message : 'Erro inesperado';
  if (reason.code !== 'VALIDATION_ERROR' || !reason.fields) return reason.message;
  const messages = Object.entries(reason.fields).flatMap(([field, errors]) =>
    (errors ?? []).map(
      (message) =>
        validationMessages[message] ??
        (field === 'name'
          ? 'Informe seu nome completo.'
          : field === 'organizationName'
            ? 'Informe o nome da organização.'
            : field === 'email'
              ? 'Informe um e-mail válido.'
              : `Verifique o campo ${field}.`),
    ),
  );
  return messages.length > 0
    ? [...new Set(messages)].join(' ')
    : 'Verifique os dados informados e tente novamente.';
}

export function AuthScreen() {
  const query = new URLSearchParams(window.location.search);
  const resetToken = query.get('resetToken') ?? '';
  const verificationToken = query.get('verifyEmail');
  const oauthStep = query.get('oauth');
  const oauthError = query.get('oauthError');
  const [view, setView] = useState<View>(
    oauthStep === 'onboarding'
      ? 'oauth-onboarding'
      : oauthStep === 'mfa'
        ? 'oauth-mfa'
        : resetToken
          ? 'reset'
          : 'login',
  );
  const [error, setError] = useState(
    oauthError ? oauthErrorMessages[oauthError] ?? 'Não foi possível concluir o login social.' : '',
  );
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [loginCredentials, setLoginCredentials] = useState<{ email: string; password: string } | null>(null);
  const [passwordDraft, setPasswordDraft] = useState('');
  const [passwordConfirmationDraft, setPasswordConfirmationDraft] = useState('');
  const [providers, setProviders] = useState({ google: false, microsoft: false });
  const [oauthBusy, setOauthBusy] = useState<'google' | 'microsoft' | null>(null);
  const { login, register } = useAuth();

  const changeView = (nextView: View) => {
    setView(nextView);
    setError('');
    setMessage('');
    setPasswordDraft('');
    setPasswordConfirmationDraft('');
  };

  useEffect(() => {
    if (!verificationToken) return;
    apiRequest('/auth/verify-email', {
      method: 'POST',
      body: JSON.stringify({ token: verificationToken }),
    })
      .then(() => setMessage('E-mail verificado com sucesso.'))
      .catch(() => setError('O link de verificação é inválido ou expirou.'))
      .finally(() => window.history.replaceState({}, '', '/'));
  }, [verificationToken]);

  useEffect(() => {
    apiRequest<{ providers: { google: boolean; microsoft: boolean } }>('/auth/oauth/providers')
      .then(({ providers: available }) => setProviders(available))
      .catch(() => setProviders({ google: false, microsoft: false }));
  }, []);

  const submit =
    (action: (data: FormData) => Promise<void>) => async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError('');
      setMessage('');
      setBusy(true);
      try {
        await action(new FormData(event.currentTarget));
      } catch (reason) {
        setError(friendlyError(reason));
      } finally {
        setBusy(false);
      }
    };

  const fields =
    view === 'register' ? (
      <>
        <Field name="name" label="Seu nome" autoComplete="name" />
        <Field name="organizationName" label="Organização" autoComplete="organization" />
        <Field name="email" label="E-mail" type="email" autoComplete="email" />
        <Field name="password" label="Senha" type="password" autoComplete="new-password" onChange={(event) => setPasswordDraft(event.target.value)} />
        <Field
          name="passwordConfirmation"
          label="Confirme a senha"
          type="password"
          autoComplete="new-password"
          onChange={(event) => setPasswordConfirmationDraft(event.target.value)}
        />
        <PasswordChecklist password={passwordDraft} confirmation={passwordConfirmationDraft} />
      </>
    ) : view === 'login' ? (
      <>
        {!mfaRequired ? <>
          <Field name="email" label="E-mail" type="email" autoComplete="email" />
          <Field name="password" label="Senha" type="password" autoComplete="current-password" />
        </> : <Field name="mfaCode" label="Código do autenticador ou recuperação" autoComplete="one-time-code" />}
      </>
    ) : view === 'forgot' ? (
      <Field name="email" label="E-mail" type="email" autoComplete="email" />
    ) : view === 'reset' ? (
      <>
        <Field name="token" label="Token de recuperação" defaultValue={resetToken} />
        <Field name="password" label="Nova senha" type="password" autoComplete="new-password" onChange={(event) => setPasswordDraft(event.target.value)} />
        <Field
          name="passwordConfirmation"
          label="Confirme a senha"
          type="password"
          autoComplete="new-password"
          onChange={(event) => setPasswordConfirmationDraft(event.target.value)}
        />
        <PasswordChecklist password={passwordDraft} confirmation={passwordConfirmationDraft} />
      </>
    ) : view === 'oauth-onboarding' ? (
      <>
        <Field name="name" label="Seu nome" autoComplete="name" />
        <Field name="organizationName" label="Organização" autoComplete="organization" />
      </>
    ) : (
      <Field name="code" label="Código do autenticador ou recuperação" autoComplete="one-time-code" />
    );

  const action = async (data: FormData) => {
    if (view === 'login') {
      if (mfaRequired && loginCredentials)
        return login(loginCredentials.email, loginCredentials.password, String(data.get('mfaCode')));
      const credentials = { email: String(data.get('email')), password: String(data.get('password')) };
      try { return await login(credentials.email, credentials.password); }
      catch (reason) {
        if (reason instanceof ApiError && reason.code === 'MFA_REQUIRED') {
          setLoginCredentials(credentials); setMfaRequired(true); setMessage('Informe o código de autenticação em duas etapas.'); return;
        }
        throw reason;
      }
    }
    if (view === 'register')
      return register({
        name: String(data.get('name')),
        organizationName: String(data.get('organizationName')),
        email: String(data.get('email')),
        password: String(data.get('password')),
        passwordConfirmation: String(data.get('passwordConfirmation')),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    if (view === 'forgot') {
      await apiRequest('/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: data.get('email') }),
      });
      setMessage('Se o endereço estiver cadastrado, enviaremos instruções para recuperação.');
      return;
    }
    if (view === 'oauth-onboarding') {
      const result = await apiRequest<{ session: { accessToken: string }; returnTo?: string }>(
        '/auth/oauth/complete-onboarding',
        {
          method: 'POST',
          body: JSON.stringify({
            name: data.get('name'),
            organizationName: data.get('organizationName'),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        },
      );
      setAccessToken(result.session.accessToken);
      window.location.replace(result.returnTo ?? '/');
      return;
    }
    if (view === 'oauth-mfa') {
      const result = await apiRequest<{ session: { accessToken: string }; returnTo?: string }>(
        '/auth/oauth/complete-mfa',
        { method: 'POST', body: JSON.stringify({ code: data.get('code') }) },
      );
      setAccessToken(result.session.accessToken);
      window.location.replace(result.returnTo ?? '/platform');
      return;
    }
    await apiRequest('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        token: data.get('token'),
        password: data.get('password'),
        passwordConfirmation: data.get('passwordConfirmation'),
      }),
    });
    setMessage('Senha atualizada. Entre novamente.');
    changeView('login');
  };

  return (
    <main className="grid min-h-screen bg-slate-950 text-slate-100 lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-emerald-400 p-12 text-slate-950 lg:flex">
        <BrandName className="text-2xl" />
        <div>
          <p className="mb-4 text-sm font-semibold uppercase tracking-[.25em]">
            Monitoramento em nuvem
          </p>
          <h1 className="text-6xl font-bold leading-tight">Proteção que permanece conectada.</h1>
        </div>
        <p className="text-sm">Segurança multi-tenant desde a fundação.</p>
      </section>
      <section className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <p className="mb-8 lg:hidden"><BrandName className="text-2xl" /></p>
          <h2 className="text-3xl font-bold">
            {view === 'login'
              ? 'Acesse sua conta'
              : view === 'register'
                ? 'Crie sua organização'
                : view === 'forgot'
                  ? 'Recupere seu acesso'
                  : view === 'reset'
                    ? 'Defina uma nova senha'
                    : view === 'oauth-onboarding'
                      ? 'Complete seu cadastro'
                      : 'Confirme sua autenticação'}
          </h2>
          <p className="mt-2 text-slate-400">Use seus dados com segurança para continuar.</p>
          <form className="mt-8 space-y-4" onSubmit={submit(action)}>
            {fields}
            {error && <p className="rounded-lg bg-red-950 p-3 text-sm text-red-200">{error}</p>}
            {message && (
              <p className="rounded-lg bg-emerald-950 p-3 text-sm text-emerald-200">{message}</p>
            )}
            <button
              disabled={busy}
              className="w-full rounded-xl bg-emerald-400 px-4 py-3 font-semibold text-slate-950 disabled:opacity-50"
            >
              {busy ? 'Aguarde…' : 'Continuar'}
            </button>
          </form>
          {view === 'login' && (providers.google || providers.microsoft) && (
            <section className="mt-6" aria-label="Login social">
              <div className="flex items-center gap-3 text-xs uppercase tracking-widest text-slate-500">
                <span className="h-px flex-1 bg-slate-800" />
                ou
                <span className="h-px flex-1 bg-slate-800" />
              </div>
              <div className="mt-4 grid gap-3">
                {providers.google && (
                  <SocialButton
                    provider="google"
                    label="Continuar com Google"
                    busy={oauthBusy === 'google'}
                    disabled={oauthBusy !== null}
                    onClick={() => {
                      setOauthBusy('google');
                      window.location.assign(`${apiUrl}/auth/oauth/google?returnTo=${encodeURIComponent(window.location.pathname)}`);
                    }}
                  />
                )}
                {providers.microsoft && (
                  <SocialButton
                    provider="microsoft"
                    label="Continuar com Microsoft"
                    busy={oauthBusy === 'microsoft'}
                    disabled={oauthBusy !== null}
                    onClick={() => {
                      setOauthBusy('microsoft');
                      window.location.assign(`${apiUrl}/auth/oauth/microsoft?returnTo=${encodeURIComponent(window.location.pathname)}`);
                    }}
                  />
                )}
              </div>
            </section>
          )}
          <nav className="mt-6 flex flex-wrap gap-4 text-sm text-slate-400">
            {view !== 'login' && <button onClick={() => changeView('login')}>Entrar</button>}
            {view !== 'register' && (
              <button onClick={() => changeView('register')}>Criar conta</button>
            )}
            {view !== 'forgot' && (
              <button
                onClick={() => changeView('forgot')}
                className="font-medium text-emerald-300 underline decoration-emerald-700/70 underline-offset-4 transition hover:text-emerald-200 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
              >
                Esqueci a senha
              </button>
            )}
            {view === 'forgot' && (
              <button onClick={() => changeView('reset')}>Já tenho um token</button>
            )}
            <a href="/suporte" className="hover:text-emerald-300">
              Preciso de suporte
            </a>
            <a href="/privacidade" className="hover:text-emerald-300">
              Privacidade
            </a>
            <a href="/termos" className="hover:text-emerald-300">
              Termos
            </a>
          </nav>
        </div>
      </section>
    </main>
  );
}

function Field({
  label,
  ...props
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  defaultValue?: string;
  onChange?: ChangeEventHandler<HTMLInputElement>;
}) {
  const isPassword = props.type === 'password';
  const [passwordVisible, setPasswordVisible] = useState(false);
  const inputId = `auth-${props.name}`;

  return (
    <div className="text-sm text-slate-300">
      <label htmlFor={inputId} className="mb-2 block">
        {label}
      </label>
      <div className="relative">
        <input
          required
          {...props}
          id={inputId}
          type={isPassword && passwordVisible ? 'text' : props.type}
          className={`w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-emerald-400 ${isPassword ? 'pr-24' : ''}`}
        />
        {isPassword && (
          <button
            type="button"
            aria-label={passwordVisible ? `Ocultar ${label.toLowerCase()}` : `Mostrar ${label.toLowerCase()}`}
            aria-pressed={passwordVisible}
            onClick={() => setPasswordVisible((visible) => !visible)}
            className="absolute inset-y-0 right-0 rounded-r-xl px-4 font-medium text-emerald-300 hover:text-emerald-200 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-400"
          >
            {passwordVisible ? 'Ocultar' : 'Mostrar'}
          </button>
        )}
      </div>
    </div>
  );
}

function PasswordChecklist({ password, confirmation }: { password: string; confirmation: string }) {
  const requirements = [
    ['Pelo menos 8 caracteres', password.length >= 8],
    ['Uma letra minúscula', /[a-z]/.test(password)],
    ['Uma letra maiúscula', /[A-Z]/.test(password)],
    ['Um número', /[0-9]/.test(password)],
    ['Um símbolo', /[^A-Za-z0-9]/.test(password)],
    ['As senhas coincidem', confirmation.length > 0 && password === confirmation],
  ] as const;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4" aria-live="polite">
      <p className="text-sm font-medium text-slate-200">Sua senha precisa ter:</p>
      <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
        {requirements.map(([label, valid]) => (
          <li key={label} className={valid ? 'text-emerald-300' : 'text-slate-400'}>
            <span aria-hidden="true">{valid ? '✓' : '○'}</span> {label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SocialButton({
  provider,
  label,
  busy,
  disabled,
  onClick,
}: {
  provider: 'google' | 'microsoft';
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex min-h-12 items-center justify-center gap-3 rounded-xl border border-slate-700 bg-slate-900 px-4 font-medium text-slate-100 transition hover:border-slate-500 hover:bg-slate-800 disabled:cursor-wait disabled:opacity-60"
    >
      {provider === 'google' ? (
        <span aria-hidden="true" className="grid size-7 place-items-center rounded bg-white">
          <svg viewBox="0 0 24 24" className="size-[18px]" focusable="false">
            <path
              fill="#4285F4"
              d="M21.6 12.23c0-.71-.06-1.4-.18-2.07H12v3.92h5.38a4.6 4.6 0 0 1-2 3.02v2.54h3.24c1.9-1.75 2.98-4.32 2.98-7.41Z"
            />
            <path
              fill="#34A853"
              d="M12 22c2.7 0 4.98-.9 6.63-2.36l-3.25-2.54c-.9.6-2.05.96-3.38.96-2.61 0-4.82-1.76-5.61-4.13H3.04v2.62A10 10 0 0 0 12 22Z"
            />
            <path
              fill="#FBBC05"
              d="M6.39 13.93A6.02 6.02 0 0 1 6.08 12c0-.67.12-1.32.31-1.93V7.45H3.04A10 10 0 0 0 2 12c0 1.64.39 3.19 1.04 4.55l3.35-2.62Z"
            />
            <path
              fill="#EA4335"
              d="M12 5.94c1.47 0 2.79.5 3.83 1.5l2.87-2.88A9.63 9.63 0 0 0 12 2a10 10 0 0 0-8.96 5.45l3.35 2.62C7.18 7.7 9.39 5.94 12 5.94Z"
            />
          </svg>
        </span>
      ) : (
        <span
          aria-hidden="true"
          className="grid size-6 place-items-center rounded bg-blue-600 text-sm font-bold text-white"
        >
          M
        </span>
      )}
      {busy ? 'Redirecionando…' : label}
    </button>
  );
}
