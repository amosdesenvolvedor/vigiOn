import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../auth/api';
import { useAuth } from '../auth/AuthContext';

type Status = 'ONLINE' | 'OFFLINE' | 'CONNECTING' | 'DISABLED' | 'UNKNOWN';
type Gateway = {
  id: string;
  name: string;
  deviceId: string;
  status: Status;
  version: string | null;
  protocolVersion: string;
  lastSeenAt: string | null;
  lastUptime: number | null;
  _count: { cameras: number; commands: number };
  cameras?: Array<{ id: string; name: string; connectionStatus: string; protocol: string }>;
  commands?: Array<{ commandId: string; type: string; status: string; createdAt: string }>;
};
type Camera = { id: string; name: string; gatewayId: string | null };
const labels: Record<Status, string> = {
  ONLINE: 'Online',
  OFFLINE: 'Offline',
  CONNECTING: 'Conectando',
  DISABLED: 'Desativado',
  UNKNOWN: 'Aguardando conexão',
};
const colors: Record<Status, string> = {
  ONLINE: 'text-emerald-400',
  OFFLINE: 'text-rose-400',
  CONNECTING: 'text-amber-300',
  DISABLED: 'text-slate-500',
  UNKNOWN: 'text-slate-400',
};

export function GatewayPanel() {
  const { user, organization } = useAuth();
  const [items, setItems] = useState<Gateway[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [selected, setSelected] = useState<Gateway | null>(null);
  const [pairing, setPairing] = useState<{ pairingCode: string; expiresAt: string } | null>(null);
  const [cameraId, setCameraId] = useState('');
  const [message, setMessage] = useState('');
  const canManage = user?.role === 'OWNER' || user?.role === 'ADMIN';
  const load = useCallback(async () => {
    const [{ gateways }, cameraData] = await Promise.all([
      apiRequest<{ gateways: Gateway[] }>('/gateways'),
      apiRequest<{ items: Camera[] }>('/cameras?limit=100&sortBy=name&sortOrder=asc'),
    ]);
    setItems(gateways);
    setCameras(cameraData.items);
  }, []);
  useEffect(() => {
    void load().catch((error: Error) => setMessage(error.message));
  }, [organization?.id, load]);
  const details = async (gateway: Gateway) => {
    const data = await apiRequest<{ gateway: Gateway }>(`/gateways/${gateway.id}`);
    setSelected(data.gateway);
  };
  const generate = async () => {
    setPairing(await apiRequest('/gateways/pairing-codes', { method: 'POST', body: '{}' }));
  };
  const associate = async () => {
    if (!selected || !cameraId) return;
    await apiRequest(`/gateways/${selected.id}/cameras`, {
      method: 'POST',
      body: JSON.stringify({ cameraId }),
    });
    setMessage('Câmera associada ao gateway.');
    await load();
    await details(selected);
    setCameraId('');
  };
  const dissociate = async (id: string) => {
    if (!selected) return;
    await apiRequest(`/gateways/${selected.id}/cameras/${id}`, { method: 'DELETE' });
    await load();
    await details(selected);
  };
  const test = async (id: string) => {
    if (!selected) return;
    await apiRequest(`/gateways/${selected.id}/cameras/${id}/test`, { method: 'POST' });
    setMessage('Teste enviado ao agente. O resultado aparecerá nos eventos recentes.');
    await details(selected);
  };
  const disable = async (gateway: Gateway) => {
    await apiRequest(`/gateways/${gateway.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: gateway.status === 'DISABLED' ? 'UNKNOWN' : 'DISABLED' }),
    });
    await load();
  };
  const remove = async (gateway: Gateway) => {
    if (!window.confirm(`Excluir ${gateway.name}? As câmeras serão desassociadas.`)) return;
    await apiRequest(`/gateways/${gateway.id}`, { method: 'DELETE' });
    if (selected?.id === gateway.id) setSelected(null);
    await load();
  };
  const available = cameras.filter(
    (camera) => !camera.gatewayId || camera.gatewayId === selected?.id,
  );
  return (
    <section className="mb-12 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-cyan-400">Gateways</p>
          <h2 className="mt-1 text-2xl font-bold">Agentes locais</h2>
          <p className="text-sm text-slate-400">
            {organization?.name} · comunicação segura de saída
          </p>
        </div>
        {canManage && (
          <button
            onClick={() => void generate()}
            className="rounded-lg bg-cyan-400 px-4 py-2 font-semibold text-slate-950"
          >
            + Adicionar gateway
          </button>
        )}
      </div>
      {message && <p className="mt-4 text-sm text-amber-300">{message}</p>}
      {pairing && (
        <div className="mt-5 rounded-xl border border-cyan-700 bg-cyan-950/30 p-4">
          <p className="text-sm text-cyan-200">Código temporário de uso único</p>
          <code className="mt-2 block text-xl font-bold tracking-wider">{pairing.pairingCode}</code>
          <p className="mt-2 text-xs text-slate-400">
            Expira em {new Date(pairing.expiresAt).toLocaleString('pt-BR')}. O segredo permanente
            será entregue somente ao agente.
          </p>
        </div>
      )}
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {items.map((gateway) => (
          <article key={gateway.id} className="rounded-xl border border-slate-700 bg-slate-950 p-4">
            <div className="flex justify-between gap-3">
              <div>
                <h3 className="font-semibold">{gateway.name}</h3>
                <p className={`text-sm ${colors[gateway.status]}`}>{labels[gateway.status]}</p>
              </div>
              <span className="text-xs text-slate-500">
                v{gateway.version ?? '—'} · protocolo {gateway.protocolVersion}
              </span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-2 text-xs text-slate-400">
              <div>
                <dt>Última comunicação</dt>
                <dd className="text-slate-200">
                  {gateway.lastSeenAt
                    ? new Date(gateway.lastSeenAt).toLocaleString('pt-BR')
                    : 'Nunca'}
                </dd>
              </div>
              <div>
                <dt>Câmeras</dt>
                <dd className="text-slate-200">{gateway._count.cameras}</dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => void details(gateway)}
                className="rounded border border-slate-700 px-3 py-1 text-xs"
              >
                Detalhes
              </button>
              {canManage && (
                <>
                  <button
                    onClick={() => void disable(gateway)}
                    className="rounded border border-slate-700 px-3 py-1 text-xs"
                  >
                    {gateway.status === 'DISABLED' ? 'Reabilitar' : 'Desativar'}
                  </button>
                  <button
                    onClick={() => void remove(gateway)}
                    className="rounded border border-rose-900 px-3 py-1 text-xs text-rose-300"
                  >
                    Excluir
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      {!items.length && (
        <p className="mt-6 rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-400">
          Nenhum gateway registrado. Gere um código para iniciar a instalação local.
        </p>
      )}
      {selected && (
        <div className="mt-6 rounded-xl border border-slate-700 bg-slate-950 p-5">
          <div className="flex justify-between">
            <div>
              <h3 className="text-lg font-semibold">{selected.name}</h3>
              <p className="text-xs text-slate-500">Device ID: {selected.deviceId}</p>
            </div>
            <button onClick={() => setSelected(null)} className="text-sm text-slate-400">
              Fechar
            </button>
          </div>
          <h4 className="mt-5 text-sm font-semibold">Câmeras vinculadas</h4>
          {canManage && (
            <div className="mt-2 flex gap-2">
              <select
                value={cameraId}
                onChange={(event) => setCameraId(event.target.value)}
                className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 p-2 text-sm"
              >
                <option value="">Selecione uma câmera</option>
                {available.map((camera) => (
                  <option key={camera.id} value={camera.id}>
                    {camera.name}
                  </option>
                ))}
              </select>
              <button
                onClick={() => void associate()}
                className="rounded bg-cyan-400 px-3 text-sm font-semibold text-slate-950"
              >
                Associar
              </button>
            </div>
          )}
          <div className="mt-3 space-y-2">
            {selected.cameras?.map((camera) => (
              <div
                key={camera.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded bg-slate-900 p-3 text-sm"
              >
                <span>
                  {camera.name} · {camera.protocol} · {camera.connectionStatus}
                </span>
                {canManage && (
                  <span className="flex gap-2">
                    <button onClick={() => void test(camera.id)} className="text-cyan-300">
                      Testar
                    </button>
                    <button onClick={() => void dissociate(camera.id)} className="text-rose-300">
                      Desassociar
                    </button>
                  </span>
                )}
              </div>
            ))}
          </div>
          <h4 className="mt-5 text-sm font-semibold">Eventos recentes</h4>
          <div className="mt-2 space-y-1 text-xs text-slate-400">
            {selected.commands?.map((command) => (
              <p key={command.commandId}>
                {command.type} · {command.status} ·{' '}
                {new Date(command.createdAt).toLocaleString('pt-BR')}
              </p>
            ))}
            {!selected.commands?.length && <p>Nenhum comando registrado.</p>}
          </div>
        </div>
      )}
    </section>
  );
}
