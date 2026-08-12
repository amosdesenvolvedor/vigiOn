import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../auth/api';
import { StreamPlayer } from '../cameras/StreamPlayer';
import { useRealtime } from '../realtime/useRealtime';
type Camera = {
  id: string;
  name: string;
  location: string | null;
  administrativeStatus: string;
  connectionStatus: string;
  lastSeenAt: string | null;
  gateway: { name: string; status: string } | null;
};
type Gateway = {
  id: string;
  name: string;
  status: string;
  version: string | null;
  lastSeenAt: string | null;
  _count: { cameras: number };
};
type Classification = {
  classification: string;
  riskLevel: string;
  riskFactors: string[];
  explanation: string;
};
type Event = {
  id: string;
  type: string;
  severity: string;
  occurredAt: string;
  camera: { name: string } | null;
  gateway: { name: string } | null;
  classifications: Classification[];
};
type Alert = {
  id: string;
  title: string;
  message: string;
  severity: string;
  status: string;
  createdAt: string;
};
type Data = {
  metrics: Record<string, number>;
  cameras: Camera[];
  gateways: Gateway[];
  events: Event[];
  alerts: Alert[];
  generatedAt: string;
};
const label: Record<string, string> = {
  NORMAL_ACTIVITY: 'Atividade normal',
  OUT_OF_HOURS_ACTIVITY: 'Atividade fora do horário',
  UNUSUAL_ACTIVITY: 'Atividade incomum',
  POSSIBLE_INTRUSION: 'Possível intrusão',
};
export function MonitoringDashboard() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState<Camera | null>(null);
  const load = useCallback(async () => {
    try {
      setError('');
      setData(await apiRequest<Data>('/dashboard/summary'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Central indisponível.');
    } finally {
      setLoading(false);
    }
  }, []);
  const realtime = useRealtime(load);
  const acknowledge = async (id: string) => {
    await apiRequest(`/alerts/${id}/acknowledge`, { method: 'POST' });
    await load();
  };
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);
  if (loading)
    return <section className="p-8 text-slate-400">Carregando central de monitoramento…</section>;
  return (
    <section className="mb-12 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
            Central VigiOn
          </p>
          <h2 className="text-2xl font-bold">Visão operacional</h2>
        </div>
        <span
          aria-label={`Realtime ${realtime}`}
          className="rounded-full border border-slate-700 px-3 py-2 text-xs"
        >
          Realtime: {realtime}
        </span>
      </div>
      {error && (
        <p className="mt-4 rounded bg-rose-950 p-3 text-rose-200">
          {error} Exibindo os últimos dados disponíveis.
        </p>
      )}
      {data && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
            {Object.entries({
              camerasOnline: 'Câmeras online',
              camerasOffline: 'Câmeras offline',
              gatewaysOnline: 'Gateways online',
              gatewaysOffline: 'Gateways offline',
              openAlerts: 'Alertas abertos',
              events24h: 'Eventos 24h',
              highRisk24h: 'Risco alto 24h',
              unreadNotifications: 'Não lidas',
            }).map(([key, title]) => (
              <article key={key} className="rounded-xl border border-slate-800 bg-slate-950 p-3">
                <p className="text-xs text-slate-400">{title}</p>
                <strong className="text-2xl">{data.metrics[key] ?? 0}</strong>
              </article>
            ))}
          </div>
          <div className="mt-8 grid gap-6 xl:grid-cols-3">
            <div className="xl:col-span-2">
              <h3 className="text-lg font-bold">Câmeras</h3>
              {!data.cameras.length && (
                <p className="py-5 text-slate-500">Nenhuma câmera cadastrada.</p>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {data.cameras.map((c) => (
                  <article
                    key={c.id}
                    className="rounded-xl border border-slate-800 bg-slate-950 p-4"
                  >
                    <div className="aspect-video rounded bg-slate-900 p-4 text-center text-slate-500">
                      Live sob demanda
                    </div>
                    <strong className="mt-3 block">{c.name}</strong>
                    <p className="text-sm text-slate-400">
                      {c.location ?? 'Sem local'} · {c.connectionStatus}
                    </p>
                    <p className="text-xs text-slate-500">
                      Administrativo: {c.administrativeStatus}
                      {c.gateway ? ` · Gateway ${c.gateway.status}` : ''}
                    </p>
                    <button
                      disabled={
                        c.connectionStatus !== 'ONLINE' || c.administrativeStatus !== 'ACTIVE'
                      }
                      onClick={() => setLive(c)}
                      className="mt-3 rounded border border-emerald-700 px-3 py-2 text-sm text-emerald-300 disabled:opacity-40"
                    >
                      Abrir ao vivo
                    </button>
                  </article>
                ))}
              </div>
            </div>
            <div>
              <h3 className="text-lg font-bold">Gateways</h3>
              <div className="mt-3 grid gap-2">
                {data.gateways.map((g) => (
                  <article key={g.id} className="rounded border border-slate-800 bg-slate-950 p-3">
                    <strong>{g.name}</strong>
                    <p className="text-sm">
                      {g.status} · {g._count.cameras} câmeras
                    </p>
                    <p className="text-xs text-slate-500">{g.version ?? 'Versão não informada'}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-8 grid gap-6 lg:grid-cols-2">
            <div>
              <h3 className="text-lg font-bold">Eventos recentes</h3>
              <div className="mt-3 grid gap-2">
                {data.events.map((e) => {
                  const c = e.classifications[0];
                  return (
                    <article
                      key={e.id}
                      className="rounded border border-slate-800 bg-slate-950 p-3"
                    >
                      <div className="flex justify-between gap-2">
                        <strong>
                          {c ? (label[c.classification] ?? c.classification) : e.type}
                        </strong>
                        <time className="text-xs text-slate-500">
                          {new Date(e.occurredAt).toLocaleString('pt-BR')}
                        </time>
                      </div>
                      <p className="text-sm text-slate-400">
                        {e.camera?.name ?? e.gateway?.name ?? 'Sistema'}
                        {c ? ` · Risco ${c.riskLevel}` : ''}
                      </p>
                      {c && <p className="mt-1 text-xs text-slate-500">{c.explanation}</p>}
                    </article>
                  );
                })}
              </div>
            </div>
            <div>
              <h3 className="text-lg font-bold">Alertas prioritários</h3>
              <div className="mt-3 grid gap-2">
                {data.alerts.map((a) => (
                  <article key={a.id} className="rounded border border-slate-800 bg-slate-950 p-3">
                    <div className="flex justify-between">
                      <strong>{a.title}</strong>
                      <span className="text-xs">
                        {a.severity} · {a.status}
                      </span>
                    </div>
                    <p className="text-sm text-slate-400">{a.message}</p>
                    {a.status === 'OPEN' && (
                      <button
                        onClick={() => void acknowledge(a.id)}
                        className="mt-2 text-sm text-emerald-300"
                      >
                        Reconhecer alerta
                      </button>
                    )}
                  </article>
                ))}
              </div>
            </div>
          </div>
        </>
      )}
      {live && (
        <StreamPlayer cameraId={live.id} cameraName={live.name} onClose={() => setLive(null)} />
      )}
    </section>
  );
}
