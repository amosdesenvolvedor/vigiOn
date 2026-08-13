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
interface Plan {
  id: string;
  name: string;
  code: string;
  priceCents: number | null;
  currency: string;
  maxCameras: number;
  maxUsers: number;
  maxStorageBytes: string;
  retentionDays: number;
}
interface BillingHistory {
  payments: Array<{
    id: string;
    status: string;
    amountCents: number;
    currency: string;
    paymentMethod: string;
    createdAt: string;
  }>;
  invoices: Array<{
    id: string;
    status: string;
    amountCents: number;
    currency: string;
    createdAt: string;
  }>;
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
  const [plans, setPlans] = useState<Plan[]>([]);
  const [history, setHistory] = useState<BillingHistory>({ payments: [], invoices: [] });
  const [billingEnabled, setBillingEnabled] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const [subscriptionData, usageData, featureData, planData, billingConfig, billingHistory] =
      await Promise.all([
        apiRequest<{ subscription: Subscription }>('/subscription'),
        apiRequest<{ usage: Usage }>('/subscription/usage'),
        apiRequest<{ features: string[] }>('/subscription/features'),
        apiRequest<{ plans: Plan[] }>('/plans'),
        apiRequest<{ enabled: boolean }>('/billing/configuration'),
        apiRequest<BillingHistory>('/billing/history?page=1&limit=10'),
      ]);
    setSubscription(subscriptionData.subscription);
    setUsage(usageData.usage);
    setFeatures(featureData.features);
    setPlans(planData.plans);
    setBillingEnabled(billingConfig.enabled);
    setHistory(billingHistory);
  };
  const checkout = async (planId: string) => {
    if (!window.confirm('Confirma a abertura do checkout para este plano?')) return;
    setBusy(true);
    setMessage('Criando checkout seguro…');
    try {
      const result = await apiRequest<{ checkout: { url: string | null } }>('/billing/checkout', {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ plan: plans.find((plan) => plan.id === planId)?.code }),
      });
      if (!result.checkout.url) throw new Error('Checkout indisponível');
      window.location.assign(result.checkout.url);
    } catch (error) {
      setMessage((error as Error).message);
      setBusy(false);
    }
  };

  useEffect(() => {
    void load().catch((error: Error) => setMessage(error.message));
  }, [organization?.id]);
  useEffect(() => {
    if (window.location.pathname !== '/billing/success') return;
    setMessage('Pagamento recebido. Estamos confirmando sua assinatura com o Stripe…');
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      void load().then(() => {
        if (attempts >= 6) window.clearInterval(timer);
      });
    }, 3_000);
    return () => window.clearInterval(timer);
  }, [organization?.id]);
  const action = async (name: 'cancel' | 'reactivate') => {
    try {
      if (name === 'reactivate') {
        const portal = await apiRequest<{ url: string }>('/billing/portal', { method: 'POST' });
        window.location.assign(portal.url);
        return;
      }
      await apiRequest('/billing/cancel', { method: 'POST' });
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
        <span
          className={`rounded-lg px-3 py-2 text-sm ${billingEnabled ? 'bg-emerald-500/10 text-emerald-300' : 'bg-amber-500/10 text-amber-300'}`}
        >
          {billingEnabled ? 'Pagamentos disponíveis' : 'Pagamentos ainda não habilitados'}
        </span>
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
      <div className="mt-8 border-t border-slate-800 pt-6">
        <h3 className="font-semibold">Planos disponíveis</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {plans.map((plan) => (
            <article key={plan.id} className="rounded-lg border border-slate-800 p-4">
              <div className="flex justify-between gap-3">
                <strong>{plan.name}</strong>
                <span>
                  {plan.priceCents == null
                    ? 'Preço não configurado'
                    : plan.priceCents === 0
                      ? 'Grátis'
                      : new Intl.NumberFormat('pt-BR', {
                          style: 'currency',
                          currency: plan.currency,
                        }).format(plan.priceCents / 100)}
                </span>
              </div>
              <p className="mt-2 text-xs text-slate-400">
                {plan.maxCameras} câmeras · {plan.maxUsers} usuários · {plan.retentionDays} dias
              </p>
              {user?.role === 'OWNER' &&
                plan.code !== 'FREE' &&
                plan.code !== subscription.plan.code && (
                  <button
                    disabled={!billingEnabled || !plan.priceCents || busy}
                    onClick={() => void checkout(plan.id)}
                    className="mt-4 min-h-11 rounded bg-emerald-600 px-4 text-sm disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Escolher plano
                  </button>
                )}
            </article>
          ))}
        </div>
      </div>
      <div className="mt-8 border-t border-slate-800 pt-6">
        <h3 className="font-semibold">Histórico financeiro</h3>
        {!history.payments.length && !history.invoices.length ? (
          <p className="mt-3 text-sm text-slate-400">Nenhum pagamento ou fatura registrado.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {history.payments.map((payment) => (
              <div
                key={payment.id}
                className="flex flex-wrap justify-between rounded border border-slate-800 p-3 text-sm"
              >
                <span>
                  {new Date(payment.createdAt).toLocaleDateString('pt-BR')} ·{' '}
                  {payment.paymentMethod}
                </span>
                <span>
                  {new Intl.NumberFormat('pt-BR', {
                    style: 'currency',
                    currency: payment.currency,
                  }).format(payment.amountCents / 100)}{' '}
                  · {payment.status}
                </span>
              </div>
            ))}
          </div>
        )}
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
