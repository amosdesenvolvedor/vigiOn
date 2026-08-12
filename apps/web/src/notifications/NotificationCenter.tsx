import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../auth/api';
import { realtimeInvalidationEvent } from '../realtime/useRealtime';

type Notification = {
  id: string;
  title: string;
  message: string;
  readAt: string | null;
  createdAt: string;
  alert: { id: string; status: string; severity: string; eventId: string };
};
type Alert = {
  id: string;
  title: string;
  message: string;
  severity: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  createdAt: string;
  event: { camera: { name: string } | null; gateway: { name: string } | null };
};
type Preference = {
  eventType: string;
  channel: 'IN_APP' | 'EMAIL';
  enabled: boolean;
  minimumSeverity: string;
};
const eventLabels: Record<string, string> = {
  MOTION: 'Movimento',
  CAMERA_OFFLINE: 'Câmera offline',
  CAMERA_ONLINE: 'Câmera online',
  GATEWAY_OFFLINE: 'Gateway offline',
  GATEWAY_ONLINE: 'Gateway online',
};

export function NotificationCenter() {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [preferences, setPreferences] = useState<Preference[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [n, a, p, c] = await Promise.all([
        apiRequest<{ items: Notification[] }>('/notifications?limit=20'),
        apiRequest<{ items: Alert[] }>('/alerts?limit=20'),
        apiRequest<{ items: Preference[] }>('/notification-preferences'),
        apiRequest<{ unreadCount: number }>('/notifications/unread-count'),
      ]);
      setNotifications(n.items);
      setAlerts(a.items);
      setPreferences(p.items);
      setUnread(c.unreadCount);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Não foi possível carregar notificações.',
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 30000);
    const refresh = () => void load();
    window.addEventListener(realtimeInvalidationEvent, refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener(realtimeInvalidationEvent, refresh);
    };
  }, [load]);
  const read = async (item: Notification) => {
    if (!item.readAt) await apiRequest(`/notifications/${item.id}/read`, { method: 'POST' });
    await load();
  };
  const acknowledge = async (id: string) => {
    await apiRequest(`/alerts/${id}/acknowledge`, { method: 'POST' });
    await load();
  };
  const updatePreference = async (pref: Preference, enabled: boolean) => {
    await apiRequest('/notification-preferences', {
      method: 'PUT',
      body: JSON.stringify({ ...pref, enabled }),
    });
    await load();
  };
  return (
    <section className="mb-12 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
            Central de notificações
          </p>
          <h2 className="mt-1 text-2xl font-bold">Alertas e entregas</h2>
        </div>
        <button
          aria-label={`${unread} notificações não lidas`}
          className="rounded-full border border-slate-700 px-4 py-2"
        >
          🔔 <span className="font-bold">{unread}</span>
        </button>
      </div>
      {loading && <p className="py-8 text-slate-400">Carregando notificações…</p>}
      {error && <p className="mt-4 rounded bg-rose-950 p-3 text-rose-200">{error}</p>}
      {!loading && !notifications.length && (
        <p className="py-8 text-slate-500">Nenhuma notificação.</p>
      )}
      <div className="mt-5 grid gap-3">
        {notifications.map((item) => (
          <button
            key={item.id}
            onClick={() => void read(item)}
            className={`rounded-xl border p-4 text-left ${item.readAt ? 'border-slate-800 bg-slate-950' : 'border-emerald-700 bg-emerald-950/30'}`}
          >
            <div className="flex justify-between gap-3">
              <strong>{item.title}</strong>
              <span className="text-xs text-slate-500">
                {new Date(item.createdAt).toLocaleString('pt-BR')}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-300">{item.message}</p>
            <p className="mt-1 text-xs text-slate-500">
              {item.readAt ? 'Lida' : 'Não lida'} · {item.alert.severity}
            </p>
          </button>
        ))}
      </div>
      <h3 className="mt-8 text-lg font-bold">Alertas</h3>
      {!loading && !alerts.length && <p className="py-5 text-slate-500">Nenhum alerta aberto.</p>}
      <div className="mt-3 grid gap-3">
        {alerts.map((alert) => (
          <article key={alert.id} className="rounded-xl border border-slate-800 bg-slate-950 p-4">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <strong>{alert.title}</strong>
                <p className="text-sm text-slate-400">{alert.message}</p>
              </div>
              <span className="text-sm">
                {alert.severity} · {alert.status}
              </span>
            </div>
            {alert.status === 'OPEN' && (
              <button
                onClick={() => void acknowledge(alert.id)}
                className="mt-3 text-sm text-emerald-300"
              >
                Reconhecer alerta
              </button>
            )}
          </article>
        ))}
      </div>
      <details className="mt-8">
        <summary className="cursor-pointer font-bold">Preferências</summary>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {preferences.map((pref) => (
            <label
              key={`${pref.eventType}:${pref.channel}`}
              className="flex items-center justify-between rounded border border-slate-800 bg-slate-950 p-3 text-sm"
            >
              <span>
                {eventLabels[pref.eventType]} ·{' '}
                {pref.channel === 'IN_APP' ? 'No aplicativo' : 'E-mail'}
              </span>
              <input
                type="checkbox"
                checked={pref.enabled}
                onChange={(e) => void updatePreference(pref, e.target.checked)}
              />
            </label>
          ))}
        </div>
        <p className="mt-3 text-xs text-slate-500">
          E-mails são enviados somente para endereços verificados.
        </p>
      </details>
    </section>
  );
}
