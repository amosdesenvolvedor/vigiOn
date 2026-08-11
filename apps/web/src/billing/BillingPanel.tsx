import { useEffect, useState } from 'react';
import { apiRequest } from '../auth/api';
import { useAuth } from '../auth/AuthContext';

interface Subscription {
  id: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  trial: { state: string; daysRemaining: number | null };
  plan: {
    name: string;
    code: string;
    version: number;
    maxCameras: number;
    maxStorageBytes: string;
    retentionDays: number;
    maxUsers: number;
  };
}
interface Usage {
  cameras: { current: number; limit: number };
  users: { current: number; limit: number };
  storage: { usedBytes: string; reservedBytes: string; limitBytes: string; availableBytes: string };
  retentionDays: number;
}

const percent = (current: number, limit: number) =>
  limit <= 0 ? 100 : Math.min(100, Math.round((current / limit) * 100));
const bytes = (value: string) => `${(Number(value) / 1024 ** 3).toFixed(1)} GB`;

function Meter({
  label,
  current,
  limit,
  display,
}: {
  label: string;
  current: number;
  limit: number;
  display?: string;
}) {
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span>{label}</span>
        <span className="text-slate-400">{display ?? `${current} / ${limit}`}</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded bg-slate-800">
        <div
          className="h-full rounded bg-emerald-400"
          style={{ width: `${percent(current, limit)}%` }}
        />
      </div>
    </div>
  );
}

export function BillingPanel() {
  const { user, organization } = useAuth();
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [features, setFeatures] = useState<string[]>([]);
  const [message, setMessage] = useState('');

  const load = async () => {
    const [subscriptionData, usageData, featureData] = await Promise.all([
      apiRequest<{ subscription: Subscription }>('/subscription'),
      apiRequest<{ usage: Usage }>('/subscription/usage'),
      apiRequest<{ features: string[] }>('/subscription/features'),
    ]);
    setSubscription(subscriptionData.subscription);
    setUsage(usageData.usage);
    setFeatures(featureData.features);
  };

  useEffect(() => {
    void load().catch((error: Error) => setMessage(error.message));
  }, [organization?.id]);
  const action = async (name: 'cancel' | 'reactivate') => {
    try {
      await apiRequest(`/subscription/${name}`, { method: 'POST' });
      setMessage(
        name === 'cancel'
          ? 'Cancelamento agendado para o fim do período.'
          : 'Assinatura reativada.',
      );
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  if (!subscription || !usage) return null;
  const storageCurrent = Number(usage.storage.usedBytes) + Number(usage.storage.reservedBytes);
  const storageLimit = Number(usage.storage.limitBytes);
  return (
    <section className="mb-12 rounded-2xl border border-slate-800 bg-slate-900 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
            Plano e assinatura
          </p>
          <h2 className="mt-2 text-2xl font-bold">{subscription.plan.name}</h2>
          <p className="text-sm text-slate-400">
            {subscription.status} · versão {subscription.plan.version} · retenção de{' '}
            {usage.retentionDays} dias
          </p>
        </div>
        <button
          type="button"
          onClick={() => setMessage('O checkout será disponibilizado na etapa de pagamentos.')}
          className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950"
        >
          Fazer upgrade
        </button>
      </div>
      {subscription.trial.state !== 'NONE' && (
        <p className="mt-4 rounded-lg bg-amber-400/10 p-3 text-sm text-amber-300">
          Trial {subscription.trial.state.toLowerCase()} · {subscription.trial.daysRemaining} dia(s)
          restante(s)
        </p>
      )}
      <div className="mt-7 grid gap-5 md:grid-cols-3">
        <Meter label="Câmeras" current={usage.cameras.current} limit={usage.cameras.limit} />
        <Meter label="Usuários" current={usage.users.current} limit={usage.users.limit} />
        <Meter
          label="Armazenamento"
          current={storageCurrent}
          limit={storageLimit}
          display={`${bytes(String(storageCurrent))} / ${bytes(String(storageLimit))}`}
        />
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        {features.map((feature) => (
          <span
            key={feature}
            className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300"
          >
            {feature}
          </span>
        ))}
      </div>
      {user?.role === 'OWNER' && (
        <div className="mt-6 flex gap-3 border-t border-slate-800 pt-5">
          {subscription.status === 'CANCELED' ? (
            <button onClick={() => void action('reactivate')} className="text-sm text-emerald-300">
              Reativar assinatura
            </button>
          ) : (
            <button onClick={() => void action('cancel')} className="text-sm text-rose-300">
              Cancelar ao fim do período
            </button>
          )}
        </div>
      )}
      {message && <p className="mt-4 text-sm text-amber-300">{message}</p>}
    </section>
  );
}
