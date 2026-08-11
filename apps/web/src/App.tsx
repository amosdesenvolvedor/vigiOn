import { useEffect, useState } from 'react';
import type { HealthResponse } from '@vigioni/shared';

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000/api/v1';

export function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiUrl}/health`, { signal: controller.signal })
      .then(async (response) => {
        const data = (await response.json()) as HealthResponse;
        setHealth(data);
      })
      .catch(() => setHealth(null));
    return () => controller.abort();
  }, []);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-400 font-bold text-slate-950">
              V
            </span>
            <span className="text-xl font-semibold tracking-tight">VigiOn</span>
          </div>
          <span className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300">
            Fundação 01/18
          </span>
        </header>

        <section className="flex flex-1 items-center py-16">
          <div className="max-w-3xl">
            <p className="mb-4 text-sm font-semibold uppercase tracking-[0.22em] text-emerald-400">
              Monitoramento em nuvem
            </p>
            <h1 className="text-5xl font-bold leading-tight tracking-tight sm:text-7xl">
              Segurança conectada, preparada para crescer.
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-slate-400">
              A base técnica do VigiOn está pronta. Câmeras, eventos e notificações serão
              adicionados de forma incremental nas próximas etapas.
            </p>
            <div className="mt-10 inline-flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm">
              <span
                className={`h-2.5 w-2.5 rounded-full ${health?.database === 'connected' ? 'bg-emerald-400' : 'bg-amber-400'}`}
              />
              {health
                ? `API disponível · banco ${health.database === 'connected' ? 'conectado' : 'indisponível'}`
                : 'Aguardando API local'}
            </div>
          </div>
        </section>

        <footer className="border-t border-slate-900 pt-6 text-sm text-slate-500">
          VigiOn · Plataforma SaaS multi-tenant
        </footer>
      </div>
    </main>
  );
}
