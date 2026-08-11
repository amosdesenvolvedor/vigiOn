import { AuthProvider, useAuth } from './auth/AuthContext';
import { AuthScreen } from './auth/AuthScreen';

function ProtectedArea() {
  const { user, organization, loading, logout } = useAuth();
  if (loading)
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 text-slate-300">
        Validando sessão…
      </main>
    );
  if (!user || !organization) return <AuthScreen />;
  return (
    <main className="min-h-screen bg-slate-950 p-6 text-slate-100">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between border-b border-slate-800 pb-6">
          <div>
            <strong className="text-xl">VigiOn</strong>
            <p className="text-sm text-slate-400">{organization.name}</p>
          </div>
          <button
            onClick={() => void logout()}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm"
          >
            Sair
          </button>
        </header>
        <section className="py-20">
          <p className="text-sm font-semibold uppercase tracking-[.2em] text-emerald-400">
            Sessão protegida
          </p>
          <h1 className="mt-4 text-4xl font-bold">Olá, {user.name}.</h1>
          <p className="mt-4 text-slate-400">
            Sua autenticação está ativa com a função {user.role}. O dashboard será construído em uma
            etapa futura.
          </p>
        </section>
      </div>
    </main>
  );
}

export function App() {
  return (
    <AuthProvider>
      <ProtectedArea />
    </AuthProvider>
  );
}
