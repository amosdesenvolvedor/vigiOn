import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { apiRequest } from '../auth/api';
import { useAuth } from '../auth/AuthContext';
import { StreamPlayer } from './StreamPlayer';
import { MediaPanel } from './MediaPanel';
import { CameraQrScanner, type CameraQrData } from './CameraQrScanner';

type Camera = {
  id: string;
  gatewayId: string | null;
  name: string;
  description: string | null;
  location: string | null;
  administrativeStatus: 'ACTIVE' | 'DISABLED';
  connectionStatus: 'UNKNOWN' | 'CONNECTING' | 'ONLINE' | 'OFFLINE' | 'ERROR';
  connectionType: 'WIFI' | 'ETHERNET' | 'OTHER';
  protocol: 'RTSP' | 'ONVIF' | 'HTTP' | 'HTTPS' | 'OTHER';
  manufacturer: string | null;
  model: string | null;
  identifier: string | null;
  lastSeenAt: string | null;
  motionEnabled: boolean;
  motionSensitivity: 'LOW' | 'MEDIUM' | 'HIGH';
  motionSampleFps: number;
  motionCooldownSeconds: number;
  captureSnapshotOnMotion: boolean;
};

const emptyForm = {
  name: '',
  location: '',
  description: '',
  manufacturer: '',
  model: '',
  identifier: '',
  connectionType: 'OTHER' as Camera['connectionType'],
  protocol: 'RTSP' as Camera['protocol'],
  username: '',
  password: '',
  streamHost: '',
  streamPort: '554',
  streamPath: '',
  streamTransport: 'tcp' as 'tcp' | 'udp',
};

export function CameraPanel() {
  const { user, organization } = useAuth();
  const [items, setItems] = useState<Camera[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [protocol, setProtocol] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [showForm, setShowForm] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showQrScanner, setShowQrScanner] = useState(false);
  const [editing, setEditing] = useState<Camera | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [message, setMessage] = useState('');
  const [viewing, setViewing] = useState<Camera | null>(null);
  const [mediaCamera, setMediaCamera] = useState<Camera | null>(null);
  const [motionCamera, setMotionCamera] = useState<Camera | null>(null);
  const canManage = user?.role === 'OWNER' || user?.role === 'ADMIN';

  const load = useCallback(async () => {
    const params = new URLSearchParams({ limit: '50', sortBy: 'name', sortOrder: 'asc' });
    if (search) params.set('search', search);
    if (protocol) params.set('protocol', protocol);
    const data = await apiRequest<{ items: Camera[]; pagination: { total: number } }>(
      `/cameras?${params}`,
    );
    setItems(data.items);
    setTotal(data.pagination.total);
  }, [search, protocol]);
  useEffect(() => {
    void load().catch((error: Error) => setMessage(error.message));
  }, [organization?.id, load]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm);
    setShowForm(true);
  };
  const openEdit = (camera: Camera) => {
    setEditing(camera);
    setForm({
      ...emptyForm,
      name: camera.name,
      location: camera.location ?? '',
      description: camera.description ?? '',
      manufacturer: camera.manufacturer ?? '',
      model: camera.model ?? '',
      identifier: camera.identifier ?? '',
      connectionType: camera.connectionType,
      protocol: camera.protocol,
    });
    setShowForm(true);
  };
  const applyQrData = useCallback((data: CameraQrData) => {
    setForm((current) => ({
      ...current,
      ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined && value !== '')),
    }));
    setShowQrScanner(false);
    setMessage('QR Code lido. Confira os dados antes de cadastrar a câmera.');
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const base = {
      name: form.name,
      location: form.location,
      description: form.description,
      manufacturer: form.manufacturer,
      model: form.model,
      identifier: form.identifier,
      connectionType: form.connectionType,
      protocol: form.protocol,
    };
    try {
      if (editing) {
        await apiRequest(`/cameras/${editing.id}`, { method: 'PATCH', body: JSON.stringify(base) });
        if (form.username && form.password)
          await apiRequest(`/cameras/${editing.id}/credentials`, {
            method: 'PATCH',
            body: JSON.stringify({
              username: form.username,
              password: form.password,
              ...(form.streamHost && form.streamPath
                ? {
                    stream: {
                      host: form.streamHost,
                      port: Number(form.streamPort),
                      path: form.streamPath,
                      transport: form.streamTransport,
                    },
                  }
                : {}),
            }),
          });
      } else {
        await apiRequest('/cameras', {
          method: 'POST',
          body: JSON.stringify({
            ...base,
            ...(form.username && form.password
              ? {
                  credentials: {
                    username: form.username,
                    password: form.password,
                    ...(form.streamHost && form.streamPath
                      ? {
                          stream: {
                            host: form.streamHost,
                            port: Number(form.streamPort),
                            path: form.streamPath,
                            transport: form.streamTransport,
                          },
                        }
                      : {}),
                  },
                }
              : {}),
          }),
        });
      }
      setShowForm(false);
      setMessage(editing ? 'Câmera atualizada.' : 'Câmera cadastrada. Aguardando conexão real.');
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };
  const setStatus = async (camera: Camera) => {
    const status = camera.administrativeStatus === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    await apiRequest(`/cameras/${camera.id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
    await load();
  };
  const remove = async (camera: Camera) => {
    if (!window.confirm(`Excluir ${camera.name}? Os dados históricos serão preservados.`)) return;
    await apiRequest(`/cameras/${camera.id}`, { method: 'DELETE' });
    await load();
  };
  const saveMotion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!motionCamera) return;
    const data = new FormData(event.currentTarget);
    try {
      await apiRequest(`/cameras/${motionCamera.id}/motion`, {
        method: 'PATCH',
        body: JSON.stringify({
          enabled: data.get('enabled') === 'on',
          sensitivity: data.get('sensitivity'),
          sampleFps: Number(data.get('sampleFps')),
          cooldownSeconds: Number(data.get('cooldownSeconds')),
          captureSnapshot: data.get('captureSnapshot') === 'on',
        }),
      });
      setMotionCamera(null);
      setMessage('Configuração de movimento atualizada.');
      await load();
    } catch (error) {
      setMessage((error as Error).message);
    }
  };

  return (
    <section className="mb-12 rounded-2xl border border-slate-800 bg-slate-900 p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Câmeras</p>
          <h2 className="mt-1 text-2xl font-bold">Dispositivos cadastrados</h2>
          <p className="text-sm text-slate-400">{total} câmera(s) · live view e mídia persistida</p>
        </div>
        {canManage && (
          <button
            onClick={openCreate}
            className="rounded-lg bg-emerald-500 px-4 py-2 font-semibold text-slate-950"
          >
            + Adicionar câmera
          </button>
        )}
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Pesquisar nome, local ou fabricante"
          className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm"
        />
        <select
          value={protocol}
          onChange={(event) => setProtocol(event.target.value)}
          className="rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm"
        >
          <option value="">Todos protocolos</option>
          {['RTSP', 'ONVIF', 'HTTP', 'HTTPS', 'OTHER'].map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <button
          onClick={() => setView(view === 'grid' ? 'list' : 'grid')}
          className="rounded-lg border border-slate-700 px-3 text-sm"
        >
          {view === 'grid' ? 'Lista' : 'Grid'}
        </button>
      </div>
      {message && <p className="mt-4 text-sm text-amber-300">{message}</p>}

      <div
        className={
          view === 'grid' ? 'mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3' : 'mt-6 grid gap-3'
        }
      >
        {items.map((camera) => (
          <article key={camera.id} className="rounded-xl border border-slate-800 bg-slate-950 p-5">
            <div className="flex justify-between gap-3">
              <div>
                <h3 className="font-semibold">{camera.name}</h3>
                <p className="text-sm text-slate-500">{camera.location || 'Local não informado'}</p>
              </div>
              <span
                className={
                  camera.administrativeStatus === 'ACTIVE'
                    ? 'text-xs text-emerald-400'
                    : 'text-xs text-slate-500'
                }
              >
                {camera.administrativeStatus}
              </span>
            </div>
            <div className="mt-5 rounded-lg bg-slate-900 p-4 text-center text-sm text-slate-400">
              <p className="font-medium text-slate-300">Aguardando conexão</p>
              <p className="mt-1">Conectividade: {camera.connectionStatus}</p>
              <p>
                Última comunicação:{' '}
                {camera.lastSeenAt ? new Date(camera.lastSeenAt).toLocaleString('pt-BR') : 'nunca'}
              </p>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              {camera.protocol} · {camera.connectionType}
              {camera.manufacturer ? ` · ${camera.manufacturer} ${camera.model ?? ''}` : ''}
            </p>
            <div className="mt-4 flex flex-wrap gap-3 text-sm">
              <button
                disabled={!camera.gatewayId || camera.administrativeStatus !== 'ACTIVE'}
                onClick={() => setViewing(camera)}
                className="text-cyan-300 disabled:text-slate-600"
              >
                Visualizar
              </button>
              <button onClick={() => setMediaCamera(camera)} className="text-violet-300">
                Arquivos
              </button>
              {canManage && (
                <>
                  <button onClick={() => openEdit(camera)} className="text-emerald-300">
                    Configurar
                  </button>
                  <button onClick={() => setMotionCamera(camera)} className="text-cyan-300">
                    Movimento
                  </button>
                  <button onClick={() => void setStatus(camera)} className="text-amber-300">
                    {camera.administrativeStatus === 'ACTIVE' ? 'Desativar' : 'Ativar'}
                  </button>
                  <button onClick={() => void remove(camera)} className="text-rose-300">
                    Excluir
                  </button>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      {!items.length && (
        <p className="py-12 text-center text-slate-500">Nenhuma câmera encontrada.</p>
      )}

      {showForm && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/90 p-4">
          <form
            onSubmit={submit}
            className="mx-auto my-6 max-w-2xl rounded-2xl border border-slate-700 bg-slate-900 p-6"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-xl font-bold">
                {editing ? 'Configurar câmera' : 'Adicionar câmera'}
              </h2>
              <div className="flex items-center gap-3">
                {!editing && (
                  <button
                    type="button"
                    onClick={() => setShowQrScanner(true)}
                    className="rounded-lg border border-emerald-500/60 px-3 py-2 text-sm font-semibold text-emerald-300"
                  >
                    Escanear QR Code
                  </button>
                )}
                <button type="button" onClick={() => setShowForm(false)}>
                  Fechar
                </button>
              </div>
            </div>
            <div className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2 text-sm">
                Nome *
                <input
                  required
                  minLength={2}
                  maxLength={160}
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-3"
                />
              </label>
              <label className="text-sm">
                Localização
                <input
                  maxLength={255}
                  value={form.location}
                  onChange={(event) => setForm({ ...form, location: event.target.value })}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-3"
                />
              </label>
              <label className="text-sm">
                Identificador
                <input
                  maxLength={191}
                  value={form.identifier}
                  onChange={(event) => setForm({ ...form, identifier: event.target.value })}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-3"
                />
              </label>
              <label className="sm:col-span-2 text-sm">
                Descrição
                <textarea
                  maxLength={4000}
                  value={form.description}
                  onChange={(event) => setForm({ ...form, description: event.target.value })}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-3"
                />
              </label>
              <label className="text-sm">
                Fabricante
                <input
                  value={form.manufacturer}
                  onChange={(event) => setForm({ ...form, manufacturer: event.target.value })}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-3"
                />
              </label>
              <label className="text-sm">
                Modelo
                <input
                  value={form.model}
                  onChange={(event) => setForm({ ...form, model: event.target.value })}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-3"
                />
              </label>
              <label className="text-sm">
                Conexão
                <select
                  value={form.connectionType}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      connectionType: event.target.value as Camera['connectionType'],
                    })
                  }
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-3"
                >
                  {['WIFI', 'ETHERNET', 'OTHER'].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Protocolo
                <select
                  value={form.protocol}
                  onChange={(event) =>
                    setForm({ ...form, protocol: event.target.value as Camera['protocol'] })
                  }
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-3"
                >
                  {['RTSP', 'ONVIF', 'HTTP', 'HTTPS', 'OTHER'].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Usuário da câmera
                <input
                  autoComplete="off"
                  value={form.username}
                  onChange={(event) => setForm({ ...form, username: event.target.value })}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-3"
                />
              </label>
              <label className="text-sm">
                Senha da câmera
                <div className="mt-1 flex">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={form.password}
                    onChange={(event) => setForm({ ...form, password: event.target.value })}
                    className="min-w-0 flex-1 rounded-l border border-slate-700 bg-slate-950 p-3"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="rounded-r border border-l-0 border-slate-700 px-3"
                  >
                    {showPassword ? 'Ocultar' : 'Mostrar'}
                  </button>
                </div>
              </label>
              <label className="text-sm">
                Host RTSP
                <input
                  value={form.streamHost}
                  onChange={(event) => setForm({ ...form, streamHost: event.target.value })}
                  placeholder="192.168.1.20"
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-3"
                />
              </label>
              <label className="text-sm">
                Porta RTSP
                <input
                  type="number"
                  min="1"
                  max="65535"
                  value={form.streamPort}
                  onChange={(event) => setForm({ ...form, streamPort: event.target.value })}
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-3"
                />
              </label>
              <label className="text-sm">
                Caminho RTSP
                <input
                  value={form.streamPath}
                  onChange={(event) => setForm({ ...form, streamPath: event.target.value })}
                  placeholder="/Streaming/Channels/101"
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-3"
                />
              </label>
              <label className="text-sm">
                Transporte
                <select
                  value={form.streamTransport}
                  onChange={(event) =>
                    setForm({ ...form, streamTransport: event.target.value as 'tcp' | 'udp' })
                  }
                  className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-3"
                >
                  <option value="tcp">TCP</option>
                  <option value="udp">UDP</option>
                </select>
              </label>
            </div>
            <p className="mt-4 text-xs text-slate-500">
              As credenciais são criptografadas. A senha armazenada nunca será exibida novamente.
            </p>
            <button className="mt-6 w-full rounded-lg bg-emerald-500 p-3 font-semibold text-slate-950">
              {editing ? 'Salvar alterações' : 'Cadastrar câmera'}
            </button>
          </form>
        </div>
      )}
      {showQrScanner && (
        <CameraQrScanner onRead={applyQrData} onClose={() => setShowQrScanner(false)} />
      )}
      {viewing && (
        <StreamPlayer
          cameraId={viewing.id}
          cameraName={viewing.name}
          onClose={() => setViewing(null)}
        />
      )}
      {motionCamera && (
        <div className="fixed inset-0 z-50 bg-slate-950/90 p-4">
          <form
            onSubmit={saveMotion}
            className="mx-auto my-12 max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6"
          >
            <div className="flex justify-between">
              <h2 className="text-xl font-bold">Detecção de movimento</h2>
              <button type="button" onClick={() => setMotionCamera(null)}>
                Fechar
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-400">{motionCamera.name}</p>
            <label className="mt-6 flex gap-3 text-sm">
              <input name="enabled" type="checkbox" defaultChecked={motionCamera.motionEnabled} />
              Ativar detecção independente da visualização
            </label>
            <label className="mt-5 block text-sm">
              Sensibilidade
              <select
                name="sensitivity"
                defaultValue={motionCamera.motionSensitivity}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-3"
              >
                <option value="LOW">Baixa</option>
                <option value="MEDIUM">Média</option>
                <option value="HIGH">Alta</option>
              </select>
            </label>
            <label className="mt-4 block text-sm">
              Amostras por segundo
              <input
                name="sampleFps"
                type="number"
                min="1"
                max="5"
                defaultValue={motionCamera.motionSampleFps}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-3"
              />
            </label>
            <label className="mt-4 block text-sm">
              Tempo para encerrar o movimento (segundos)
              <input
                name="cooldownSeconds"
                type="number"
                min="3"
                max="300"
                defaultValue={motionCamera.motionCooldownSeconds}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-950 p-3"
              />
            </label>
            <label className="mt-5 flex gap-3 text-sm">
              <input
                name="captureSnapshot"
                type="checkbox"
                defaultChecked={motionCamera.captureSnapshotOnMotion}
              />
              Capturar snapshot representativo
            </label>
            <p className="mt-2 text-xs text-amber-300">
              O snapshot automático será usado quando o gateway oferecer suporte ao vínculo de mídia
              do evento.
            </p>
            <button className="mt-6 w-full rounded-lg bg-emerald-500 p-3 font-semibold text-slate-950">
              Salvar monitoramento
            </button>
          </form>
        </div>
      )}
      {mediaCamera && (
        <div className="fixed inset-0 z-40 overflow-y-auto bg-slate-950/95 p-4">
          <div className="mx-auto my-8 max-w-5xl rounded-2xl border border-slate-700 bg-slate-900 p-5">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-violet-400">Mídia persistida</p>
                <h2 className="text-xl font-bold">{mediaCamera.name}</h2>
              </div>
              <button
                onClick={() => setMediaCamera(null)}
                className="rounded border border-slate-700 px-4 py-2 text-sm"
              >
                Fechar
              </button>
            </div>
            <MediaPanel cameraId={mediaCamera.id} canManage={canManage} />
          </div>
        </div>
      )}
    </section>
  );
}
