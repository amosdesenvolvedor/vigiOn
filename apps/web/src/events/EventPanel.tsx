import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../auth/api';

type EventItem = {
  id: string;
  type: 'MOTION' | 'CAMERA_OFFLINE' | 'CAMERA_ONLINE' | 'GATEWAY_OFFLINE' | 'GATEWAY_ONLINE';
  severity: 'INFO' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  status: string;
  occurredAt: string;
  endedAt: string | null;
  metadata: { motionScore?: number } | null;
  camera: { id: string; name: string; location: string | null } | null;
  gateway: { id: string; name: string } | null;
  storageFiles: Array<{ id: string; type: string; mimeType: string }>;
  classifications: Array<{
    classification: string;
    riskScore: string;
    riskLevel: string;
    riskFactors: string[];
    explanation: string;
  }>;
};
const labels: Record<EventItem['type'], string> = {
  MOTION: 'Movimento detectado',
  CAMERA_OFFLINE: 'Câmera offline',
  CAMERA_ONLINE: 'Câmera online',
  GATEWAY_OFFLINE: 'Gateway offline',
  GATEWAY_ONLINE: 'Gateway online',
};

export function EventPanel() {
  const [items, setItems] = useState<EventItem[]>([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(0);
  const [type, setType] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<EventItem | null>(null);
  const [snapshotUrl, setSnapshotUrl] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const query = new URLSearchParams({ page: String(page), limit: '10' });
      if (type) query.set('type', type);
      const data = await apiRequest<{ items: EventItem[]; pagination: { pages: number } }>(
        `/events?${query}`,
      );
      setItems(data.items);
      setPages(data.pagination.pages);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os eventos.');
    } finally {
      setLoading(false);
    }
  }, [page, type]);
  useEffect(() => {
    void load();
  }, [load]);

  const open = async (event: EventItem) => {
    setSelected(event);
    setSnapshotUrl('');
    const asset = event.storageFiles[0];
    if (!asset) return;
    try {
      const access = await apiRequest<{ url: string }>(`/media-assets/${asset.id}/access`, {
        method: 'POST',
      });
      setSnapshotUrl(access.url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Mídia indisponível.');
    }
  };

  return (
    <section className="mb-12 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Eventos</p>
          <h2 className="mt-1 text-2xl font-bold">Timeline operacional</h2>
        </div>
        <select
          value={type}
          onChange={(event) => {
            setType(event.target.value);
            setPage(1);
          }}
          className="rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm"
        >
          <option value="">Todos os tipos</option>
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {loading && <p className="py-10 text-center text-slate-400">Carregando eventos…</p>}
      {error && <p className="mt-5 rounded-lg bg-rose-950 p-3 text-sm text-rose-200">{error}</p>}
      {!loading && !error && !items.length && (
        <p className="py-10 text-center text-slate-500">Nenhum evento registrado.</p>
      )}
      <div className="mt-6 grid gap-3">
        {items.map((event) => (
          <button
            key={event.id}
            onClick={() => void open(event)}
            className="rounded-xl border border-slate-800 bg-slate-950 p-4 text-left hover:border-slate-600"
          >
            <div className="flex flex-wrap justify-between gap-2">
              <div>
                <strong>{labels[event.type]}</strong>
                <p className="text-sm text-slate-400">
                  {event.camera?.name ?? event.gateway?.name ?? 'Sistema'}
                </p>
              </div>
              <div className="text-right text-sm">
                <p>{new Date(event.occurredAt).toLocaleString('pt-BR')}</p>
                <p className="text-slate-500">
                  {event.severity} · {event.status}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
      {pages > 1 && (
        <div className="mt-5 flex justify-center gap-3">
          <button
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            className="rounded border border-slate-700 px-3 py-2 disabled:opacity-40"
          >
            Anterior
          </button>
          <span className="p-2 text-sm">
            {page} / {pages}
          </span>
          <button
            disabled={page >= pages}
            onClick={() => setPage(page + 1)}
            className="rounded border border-slate-700 px-3 py-2 disabled:opacity-40"
          >
            Próxima
          </button>
        </div>
      )}
      {selected && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/90 p-4">
          <div className="mx-auto my-12 max-w-xl rounded-2xl border border-slate-700 bg-slate-900 p-6">
            <div className="flex justify-between">
              <h3 className="text-xl font-bold">{labels[selected.type]}</h3>
              <button onClick={() => setSelected(null)}>Fechar</button>
            </div>
            <dl className="mt-6 grid gap-3 text-sm">
              <div>
                <dt className="text-slate-500">Câmera / Gateway</dt>
                <dd>{selected.camera?.name ?? selected.gateway?.name ?? 'Sistema'}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Início</dt>
                <dd>{new Date(selected.occurredAt).toLocaleString('pt-BR')}</dd>
              </div>
              {selected.endedAt && (
                <div>
                  <dt className="text-slate-500">Fim</dt>
                  <dd>{new Date(selected.endedAt).toLocaleString('pt-BR')}</dd>
                </div>
              )}
              {selected.metadata?.motionScore !== undefined && (
                <div>
                  <dt className="text-slate-500">Alteração visual</dt>
                  <dd>{Math.round(selected.metadata.motionScore * 100)}%</dd>
                </div>
              )}
            </dl>
            {selected.classifications[0] && (
              <div className="mt-6 rounded-lg border border-amber-800 bg-amber-950/30 p-4">
                <p className="font-semibold">
                  Classificação: {selected.classifications[0].classification}
                </p>
                <p className="mt-1">Nível de risco: {selected.classifications[0].riskLevel}</p>
                <p className="mt-2 text-sm text-slate-300">
                  {selected.classifications[0].explanation}
                </p>
                <ul className="mt-2 list-disc pl-5 text-xs text-slate-400">
                  {selected.classifications[0].riskFactors.map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </div>
            )}
            {snapshotUrl && (
              <img src={snapshotUrl} alt="Snapshot do evento" className="mt-6 w-full rounded-lg" />
            )}
          </div>
        </div>
      )}
    </section>
  );
}
