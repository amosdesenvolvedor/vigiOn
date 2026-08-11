import { useEffect, useState, type FormEvent } from 'react';
import { apiRequest } from './api';
import { useAuth } from './AuthContext';

type View = 'login' | 'register' | 'forgot' | 'reset';

export function AuthScreen() {
  const query = new URLSearchParams(window.location.search);
  const resetToken = query.get('resetToken') ?? '';
  const verificationToken = query.get('verifyEmail');
  const [view, setView] = useState<View>(resetToken ? 'reset' : 'login');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const { login, register } = useAuth();

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

  const submit =
    (action: (data: FormData) => Promise<void>) => async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError('');
      setMessage('');
      setBusy(true);
      try {
        await action(new FormData(event.currentTarget));
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : 'Erro inesperado');
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
        <Field name="password" label="Senha" type="password" autoComplete="new-password" />
        <Field
          name="passwordConfirmation"
          label="Confirme a senha"
          type="password"
          autoComplete="new-password"
        />
      </>
    ) : view === 'login' ? (
      <>
        <Field name="email" label="E-mail" type="email" autoComplete="email" />
        <Field name="password" label="Senha" type="password" autoComplete="current-password" />
      </>
    ) : view === 'forgot' ? (
      <Field name="email" label="E-mail" type="email" autoComplete="email" />
    ) : (
      <>
        <Field name="token" label="Token de recuperação" defaultValue={resetToken} />
        <Field name="password" label="Nova senha" type="password" autoComplete="new-password" />
        <Field
          name="passwordConfirmation"
          label="Confirme a senha"
          type="password"
          autoComplete="new-password"
        />
      </>
    );

  const action = async (data: FormData) => {
    if (view === 'login') return login(String(data.get('email')), String(data.get('password')));
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
    await apiRequest('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({
        token: data.get('token'),
        password: data.get('password'),
        passwordConfirmation: data.get('passwordConfirmation'),
      }),
    });
    setMessage('Senha atualizada. Entre novamente.');
    setView('login');
  };

  return (
    <main className="grid min-h-screen bg-slate-950 text-slate-100 lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-emerald-400 p-12 text-slate-950 lg:flex">
        <strong className="text-2xl">VigiOn</strong>
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
          <p className="mb-8 text-2xl font-bold lg:hidden">VigiOn</p>
          <h2 className="text-3xl font-bold">
            {view === 'login'
              ? 'Acesse sua conta'
              : view === 'register'
                ? 'Crie sua organização'
                : view === 'forgot'
                  ? 'Recupere seu acesso'
                  : 'Defina uma nova senha'}
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
          <nav className="mt-6 flex flex-wrap gap-4 text-sm text-slate-400">
            {view !== 'login' && <button onClick={() => setView('login')}>Entrar</button>}
            {view !== 'register' && (
              <button onClick={() => setView('register')}>Criar conta</button>
            )}
            {view !== 'forgot' && (
              <button onClick={() => setView('forgot')}>Esqueci a senha</button>
            )}
            {view === 'forgot' && (
              <button onClick={() => setView('reset')}>Já tenho um token</button>
            )}
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
}) {
  return (
    <label className="block text-sm text-slate-300">
      <span className="mb-2 block">{label}</span>
      <input
        required
        {...props}
        className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3 outline-none focus:border-emerald-400"
      />
    </label>
  );
}
