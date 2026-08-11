import { useCallback, useEffect, useState } from 'react';
import { apiRequest, apiUrl } from '../auth/api';

interface Asset {
  id: string;
  cameraId: string | null;
  type: 'SNAPSHOT' | 'RECORDING';
  status: string;
  fileName: string;
  mimeType: string;
  sizeBytes: string;
  createdAt: string;
  errorCode: string | null;
}

export function MediaPanel({ cameraId, canManage }: { cameraId?: string; canManage: boolean }) {
  const [items, setItems] = useState<Asset[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const query = cameraId ? `?cameraId=${cameraId}` : '';
    setItems((await apiRequest<{ items: Asset[] }>(`/media-assets${query}`)).items);
  }, [cameraId]);
  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);
  useEffect(() => {
    const timer = window.setInterval(() => void load().catch(() => undefined), 5000);
    return () => window.clearInterval(timer);
  }, [load]);
  const request = async (kind: 'snapshots' | 'recordings') => {
    if (!cameraId) return;
    setBusy(true);
    setMessage(kind === 'snapshots' ? 'Capturando imagem...' : 'Iniciando gravação...');
    try {
      await apiRequest(`/cameras/${cameraId}/${kind}`, {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: '{}',
      });
      setMessage(kind === 'snapshots' ? 'Snapshot solicitado.' : 'Gravação iniciada.');
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const access = async (asset: Asset) => {
    try {
      const { url } = await apiRequest<{ url: string }>(`/media-assets/${asset.id}/access`, {
        method: 'POST',
        body: '{}',
      });
      window.open(`${apiUrl}${url}`, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const remove = async (asset: Asset) => {
    if (!window.confirm(`Excluir ${asset.fileName}?`)) return;
    try {
      await apiRequest(`/media-assets/${asset.id}`, { method: 'DELETE' });
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const stop = async (asset: Asset) => {
    try {
      await apiRequest(`/recordings/${asset.id}/stop`, { method: 'POST', body: '{}' });
      setMessage('Encerramento solicitado.');
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  return (
    <div className="mt-5 rounded-xl border border-slate-800 bg-slate-950 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className="font-semibold">Capturas e gravações</h4>
        {canManage && cameraId && (
          <div className="flex gap-2">
            <button
              disabled={busy}
              onClick={() => void request('snapshots')}
              className="rounded bg-cyan-700 px-3 py-2 text-sm disabled:opacity-50"
            >
              Capturar snapshot
            </button>
            <button
              disabled={busy}
              onClick={() => void request('recordings')}
              className="rounded bg-rose-700 px-3 py-2 text-sm disabled:opacity-50"
            >
              Iniciar gravação
            </button>
          </div>
        )}
      </div>
      {message && <p className="mt-2 text-sm text-amber-300">{message}</p>}
      <div className="mt-3 grid gap-2">
        {items.length === 0 && <p className="text-sm text-slate-500">Nenhum arquivo persistido.</p>}
        {items.map((asset) => (
          <div
            key={asset.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-slate-900 p-3 text-sm"
          >
            <div>
              <p>
                {asset.type === 'SNAPSHOT' ? 'Imagem' : 'Gravação'} · {asset.status}
              </p>
              <p className="text-xs text-slate-500">
                {new Date(asset.createdAt).toLocaleString('pt-BR')} ·{' '}
                {Number(asset.sizeBytes).toLocaleString('pt-BR')} bytes
              </p>
            </div>
            <div className="flex gap-3">
              {asset.status === 'AVAILABLE' && (
                <button onClick={() => void access(asset)} className="text-cyan-300">
                  Abrir
                </button>
              )}
              {asset.type === 'RECORDING' &&
                ['CAPTURING', 'UPLOADING'].includes(asset.status) &&
                canManage && (
                  <button onClick={() => void stop(asset)} className="text-amber-300">
                    Parar
                  </button>
                )}
              {canManage && (
                <button onClick={() => void remove(asset)} className="text-rose-300">
                  Excluir
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
