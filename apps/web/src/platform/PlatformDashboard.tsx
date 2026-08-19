import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../auth/api';
import { BrandName } from '../branding/BrandName';

type Section =
  | 'organizations'
  | 'users'
  | 'plans'
  | 'subscriptions'
  | 'payments'
  | 'invoices'
  | 'cameras'
  | 'catalog'
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
  ['payments', 'Pagamentos'],
  ['invoices', 'Faturas'],
  ['cameras', 'Câmeras'],
  ['catalog', 'Catálogo técnico'],
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

const fieldLabels: Record<string, string> = {
  id: 'Identificador',
  name: 'Nome',
  email: 'E-mail',
  slug: 'Endereço interno',
  status: 'Status',
  role: 'Função',
  platformRole: 'Acesso global',
  timezone: 'Fuso horário',
  createdAt: 'Criado em',
  updatedAt: 'Atualizado em',
  lastLoginAt: 'Último acesso',
  lastSeenAt: 'Última comunicação',
  currentPeriodStart: 'Início do período',
  currentPeriodEnd: 'Fim do período',
  trialEndsAt: 'Fim do trial',
  cancelAtPeriodEnd: 'Cancela ao fim do período',
  amountCents: 'Valor',
  currency: 'Moeda',
  provider: 'Provedor',
  billingProvider: 'Provedor',
  paymentMethod: 'Forma de pagamento',
  plan: 'Plano',
  subscriptions: 'Assinatura',
  storageUsage: 'Armazenamento',
  _count: 'Recursos',
  users: 'Usuários',
  cameras: 'Câmeras',
  gateways: 'Gateways',
  fileCount: 'Arquivos',
  usedBytes: 'Espaço utilizado',
  reservedBytes: 'Espaço reservado',
  maxCameras: 'Limite de câmeras',
  maxUsers: 'Limite de usuários',
  maxStorageBytes: 'Limite de armazenamento',
  retentionDays: 'Retenção',
  enabledFeatures: 'Recursos habilitados',
  organization: 'Organização',
  type: 'Tipo',
  action: 'Ação',
  severity: 'Severidade',
  riskLevel: 'Nível de risco',
  eventType: 'Tipo do evento',
};
const statusLabels: Record<string, string> = {
  ACTIVE: 'Ativa',
  TRIALING: 'Em avaliação',
  CANCELED: 'Cancelada',
  PAST_DUE: 'Pagamento pendente',
  PAID: 'Pago',
  PENDING: 'Pendente',
  FAILED: 'Falhou',
  OPEN: 'Aberta',
  CLOSED: 'Fechada',
  HEALTHY: 'Saudável',
  RUNNING: 'Executando',
  SUSPENDED: 'Suspensa',
  ONLINE: 'Online',
  OFFLINE: 'Offline',
  ENABLED: 'Habilitado',
  DISABLED: 'Desabilitado',
  PROCESSED: 'Processado',
};
const featureLabels: Record<string, string> = {
  LIVE_VIEW: 'Visualização ao vivo',
  CLOUD_STORAGE: 'Armazenamento em nuvem',
  RECORDING: 'Gravação',
  MOTION_DETECTION: 'Detecção de movimento',
  PERSON_DETECTION: 'Detecção de pessoas',
  SMART_ALERTS: 'Alertas inteligentes',
  MULTI_USER: 'Múltiplos usuários',
  ADVANCED_EVENTS: 'Eventos avançados',
};
const label = (key: string) => fieldLabels[key] ?? key.replace(/([a-z])([A-Z])/g, '$1 $2');
const bytes = (value: unknown) => {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return String(value ?? '—');
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = amount;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ${units[unit]}`;
};
const isDate = (key: string, value: unknown) =>
  (key.endsWith('At') || key.endsWith('Date') || key.includes('Period')) &&
  typeof value === 'string' &&
  !Number.isNaN(Date.parse(value));
const isByteField = (key: string) => /bytes/i.test(key);
const isStatusField = (key: string) => /status|state/i.test(key);

function FriendlyValue({ field, value }: { field: string; value: unknown }) {
  if (value === null || value === undefined || value === '')
    return <span className="text-slate-500">Não informado</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Sim' : 'Não'}</span>;
  if (isDate(field, value)) return <span>{new Date(value as string).toLocaleString('pt-BR')}</span>;
  if (isByteField(field)) return <span>{bytes(value)}</span>;
  if (field === 'amountCents' && typeof value === 'number')
    return (
      <span>{(value / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
    );
  if (isStatusField(field) && typeof value === 'string')
    return (
      <span
        className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ${['ACTIVE', 'PAID', 'HEALTHY', 'ONLINE', 'PROCESSED'].includes(value) ? 'bg-emerald-950 text-emerald-300' : ['FAILED', 'PAST_DUE', 'OFFLINE', 'SUSPENDED'].includes(value) ? 'bg-rose-950 text-rose-300' : 'bg-slate-800 text-slate-300'}`}
      >
        {statusLabels[value] ?? value}
      </span>
    );
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-slate-500">Nenhum</span>;
    if (value.every((entry) => typeof entry === 'string'))
      return (
        <div className="flex flex-wrap gap-1">
          {value.map((entry) => (
            <span key={entry as string} className="rounded bg-slate-800 px-2 py-1 text-xs">
              {featureLabels[entry as string] ?? (entry as string)}
            </span>
          ))}
        </div>
      );
    return (
      <div className="grid gap-2">
        {value.map((entry, index) => (
          <div key={index} className="rounded border border-slate-800 p-2">
            <FriendlyObject value={entry as Record<string, unknown>} compact />
          </div>
        ))}
      </div>
    );
  }
  if (typeof value === 'object')
    return <FriendlyObject value={value as Record<string, unknown>} compact />;
  return <span className="break-words">{statusLabels[String(value)] ?? String(value)}</span>;
}

function FriendlyObject({
  value,
  compact = false,
}: {
  value: Record<string, unknown>;
  compact?: boolean;
}) {
  return (
    <dl
      className={`grid gap-x-5 gap-y-3 ${compact ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'}`}
    >
      {Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .map(([key, entry]) => (
          <div
            key={key}
            className={typeof entry === 'object' && entry !== null ? 'sm:col-span-2' : ''}
          >
            <dt className="text-xs font-medium text-slate-500">{label(key)}</dt>
            <dd className="mt-1 text-sm text-slate-200">
              <FriendlyValue field={key} value={entry} />
            </dd>
          </div>
        ))}
    </dl>
  );
}

export function PlatformDashboard({ logout }: { logout(): Promise<void> }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [section, setSection] = useState<Section>('organizations');
  const [data, setData] = useState<PageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [catalogSearch, setCatalogSearch] = useState('');
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
    const endpoint =
      section === 'catalog'
        ? `/camera-catalog/models?page=1&limit=25${catalogSearch ? `&search=${encodeURIComponent(catalogSearch)}` : ''}`
        : `/platform/${section}?page=1&limit=25`;
    void apiRequest<PageData>(endpoint)
      .then(setData)
      .catch((reason: Error) => setError(reason.message))
      .finally(() => setLoading(false));
  }, [section, catalogSearch]);
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
            <p>
              <BrandName cloud className="text-sm" />
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
          {section === 'catalog' && (
            <label className="mt-4 block text-sm text-slate-300">
              Buscar fabricante, marca, família, modelo ou alias
              <input
                value={catalogSearch}
                onChange={(event) => setCatalogSearch(event.target.value)}
                maxLength={160}
                placeholder="Ex.: C520WS"
                className="mt-2 w-full rounded border border-slate-700 bg-slate-950 p-3"
              />
            </label>
          )}
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
              <div className="mt-4">
                <FriendlyObject value={organizationDetail} />
              </div>
            </article>
          )}
          {data?.items && (
            <div className="mt-4 grid gap-3">
              {data.items.map((item, index) => (
                <article
                  key={String(item.id ?? index)}
                  className="overflow-x-auto rounded-lg border border-slate-800 bg-slate-950 p-4"
                >
                  <FriendlyObject
                    value={Object.fromEntries(
                      Object.entries(item)
                        .filter(([key]) => !['metadata', 'message'].includes(key))
                        .slice(0, 12),
                    )}
                  />
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
            <div className="mt-4 rounded bg-slate-950 p-4">
              <FriendlyObject value={data} />
            </div>
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
