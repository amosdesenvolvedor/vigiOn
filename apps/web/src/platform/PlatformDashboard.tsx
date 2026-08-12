import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../auth/api';

type Section =
  | 'organizations'
  | 'users'
  | 'plans'
  | 'subscriptions'
  | 'cameras'
  | 'gateways'
  | 'storage'
  | 'events'
  | 'alerts'
  | 'notifications'
  | 'audit'
  | 'health';
type Summary = Record<string, number | string | Record<string, number>>;
type PageData = {
  items?: Array<Record<string, unknown>>;
  pagination?: { page: number; pages: number; total: number };
  totals?: Record<string, string>;
  [key: string]: unknown;
};
const sections: Array<[Section, string]> = [
  ['organizations', 'Organizações'],
  ['users', 'Usuários'],
  ['plans', 'Planos'],
  ['subscriptions', 'Assinaturas'],
  ['cameras', 'Câmeras'],
  ['gateways', 'Gateways'],
  ['storage', 'Storage'],
  ['events', 'Eventos'],
  ['alerts', 'Alertas'],
  ['notifications', 'Notificações'],
  ['audit', 'Auditoria'],
  ['health', 'Sistema'],
];
const summaryLabels: Record<string, string> = {
  organizationsTotal: 'Organizações',
  organizationsActive: 'Organizações ativas',
  usersTotal: 'Usuários',
  camerasTotal: 'Câmeras',
  camerasOnline: 'Câmeras online',
  camerasOffline: 'Câmeras offline',
  gatewaysTotal: 'Gateways',
  gatewaysOffline: 'Gateways offline',
  openAlerts: 'Alertas abertos',
  eventsLast24h: 'Eventos 24h',
  highRiskEventsLast24h: 'Risco alto 24h',
  storageUsedBytes: 'Storage usado (bytes)',
};

export function PlatformDashboard({ logout }: { logout(): Promise<void> }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [section, setSection] = useState<Section>('organizations');
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [organizationDetail, setOrganizationDetail] = useState<Record<string, unknown> | null>(
    null,
  );
  const loadSummary = useCallback(
    async () => setSummary(await apiRequest<Summary>('/platform/summary')),
    [],
  );
  useEffect(() => {
    void loadSummary().catch((reason: Error) => setError(reason.message));
  }, [loadSummary]);
  useEffect(() => {
    setLoading(true);
    setError('');
    setData(null);
    setOrganizationDetail(null);
    void apiRequest<PageData>(`/platform/${section}?page=1&limit=25`)
      .then(setData)
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [section]);
  const openOrganization = async (id: string) => {
    setLoading(true);
    setError('');
    try {
      const response = await apiRequest<{ organization: Record<string, unknown> }>(
        `/platform/organizations/${id}`,
      );
      setOrganizationDetail(response.organization);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="min-h-screen bg-slate-950 p-4 text-slate-100 sm:p-6">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-emerald-900 pb-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.2em] text-emerald-400">
              Vigion Cloud
            </p>
            <h1 className="text-3xl font-bold">Administração da plataforma</h1>
            <p className="text-sm text-slate-400">
              Metadados operacionais globais · sem acesso automático à mídia
            </p>
          </div>
          <div className="flex gap-2">
            <a
              href="/monitoring"
              className="min-h-11 rounded border border-slate-700 px-4 py-3 text-sm"
            >
              Dashboard do cliente
            </a>
            <button
              onClick={() => void logout()}
              className="min-h-11 rounded border border-slate-700 px-4 text-sm"
            >
              Sair
            </button>
          </div>
        </header>
        {summary && (
          <section
            aria-label="Resumo global"
            className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6"
          >
            {Object.entries(summaryLabels).map(([key, label]) => (
              <article key={key} className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <p className="text-xs text-slate-400">{label}</p>
                <strong className="text-2xl">{String(summary[key] ?? 0)}</strong>
              </article>
            ))}
          </section>
        )}
        <nav aria-label="Seções administrativas" className="mt-8 flex gap-2 overflow-x-auto pb-2">
          {sections.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setSection(value)}
              className={`min-h-11 whitespace-nowrap rounded-lg px-4 text-sm ${section === value ? 'bg-emerald-700' : 'border border-slate-700'}`}
            >
              {label}
            </button>
          ))}
        </nav>
        <section className="mt-4 overflow-hidden rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="text-xl font-bold">
            {sections.find(([value]) => value === section)?.[1]}
          </h2>
          {loading && <p className="py-10 text-slate-400">Carregando dados administrativos…</p>}
          {error && <p className="mt-4 rounded bg-rose-950 p-3 text-rose-200">{error}</p>}
          {!loading && data?.items && !data.items.length && (
            <p className="py-10 text-slate-400">Nenhum registro encontrado.</p>
          )}
          {organizationDetail && (
            <article className="mt-4 rounded-lg border border-emerald-800 bg-slate-950 p-4">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-bold">Detalhe da organização</h3>
                <button
                  className="min-h-11 rounded border border-slate-700 px-3"
                  onClick={() => setOrganizationDetail(null)}
                >
                  Fechar
                </button>
              </div>
              <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-sm text-slate-300">
                {JSON.stringify(organizationDetail, null, 2)}
              </pre>
            </article>
          )}
          {data?.items && (
            <div className="mt-4 grid gap-3">
              {data.items.map((item, index) => (
                <article
                  key={String(item.id ?? index)}
                  className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-4"
                >
                  <dl className="grid min-w-[36rem] grid-cols-2 gap-x-5 gap-y-2 text-sm md:grid-cols-4">
                    {Object.entries(item)
                      .filter(([key]) => !['metadata', 'message'].includes(key))
                      .slice(0, 12)
                      .map(([key, value]) => (
                        <div key={key}>
                          <dt className="text-xs text-slate-500">{key}</dt>
                          <dd className="break-words">
                            {typeof value === 'object'
                              ? JSON.stringify(value)
                              : String(value ?? '—')}
                          </dd>
                        </div>
                      ))}
                  </dl>
                  {section === 'organizations' && typeof item.id === 'string' && (
                    <button
                      className="mt-4 min-h-11 rounded border border-emerald-700 px-3 text-sm text-emerald-300"
                      onClick={() => void openOrganization(item.id as string)}
                    >
                      Ver detalhes e entitlements
                    </button>
                  )}
                </article>
              ))}
            </div>
          )}
          {data && !data.items && (
            <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded bg-slate-950 p-4 text-sm text-slate-300">
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
          {data?.pagination && (
            <p className="mt-4 text-xs text-slate-500">
              {data.pagination.total} registros · página {data.pagination.page} de{' '}
              {Math.max(1, data.pagination.pages)}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
