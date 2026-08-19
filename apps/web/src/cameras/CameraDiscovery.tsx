import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../auth/api';
import { realtimeInvalidationEvent } from '../realtime/useRealtime';

type Gateway = {
  id: string;
  name: string;
  status: 'ONLINE' | 'OFFLINE' | 'CONNECTING' | 'DISABLED' | 'UNKNOWN';
};
type Candidate = {
  id: string;
  networkAddress: string;
  manufacturer: string | null;
  model: string | null;
  hardwareInfo: string | null;
  confidence: string;
  authenticationRequired: boolean;
  alreadyRegistered: boolean;
};
type Discovery = { id: string; status: string; candidates: Candidate[] };
type Verification = {
  id: string;
  status: string;
  result: string | null;
  credentialsConfigured: boolean;
  detectedIdentity?: { manufacturer?: string; model?: string } | null;
  detectedCapabilities?: { onvif?: boolean; rtsp?: boolean; ptz?: boolean; events?: boolean } | null;
  errorCode?: string | null;
};

export function CameraDiscovery({
  manufacturer,
  model,
  variant,
  onConfirm,
  onClose,
}: {
  manufacturer?: string;
  model?: string;
  variant?: string;
  onConfirm: (candidate: Candidate) => void;
  onClose: () => void;
}) {
  const [gateways, setGateways] = useState<Gateway[]>([]);
  const [gatewayId, setGatewayId] = useState('');
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [verification, setVerification] = useState<Verification | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState<Candidate | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [cameraName, setCameraName] = useState('');
  const [cameraLocation, setCameraLocation] = useState('');
  const [created, setCreated] = useState(false);
  const discoveryId = discovery?.id;
  const discoveryStatus = discovery?.status;
  const verificationId = verification?.id;
  const verificationStatus = verification?.status;
  useEffect(() => {
    void apiRequest<{ gateways: Gateway[] }>('/gateways')
      .then(({ gateways: items }) => {
        setGateways(items);
        setGatewayId(items.find((item) => item.status === 'ONLINE')?.id ?? items[0]?.id ?? '');
      })
      .catch((reason: Error) => setError(reason.message));
  }, []);
  const refresh = useCallback(async () => {
    if (!discoveryId) return;
    const result = await apiRequest<{ discovery: Discovery }>(
      `/camera-onboarding/discovery/${discoveryId}`,
    );
    setDiscovery(result.discovery);
  }, [discoveryId]);
  useEffect(() => {
    if (
      !discoveryId ||
      !discoveryStatus ||
      ['COMPLETED', 'CANCELED', 'FAILED', 'EXPIRED'].includes(discoveryStatus)
    )
      return;
    const timer = setInterval(() => void refresh().catch(() => undefined), 2500);
    const realtime = () => void refresh().catch(() => undefined);
    window.addEventListener(realtimeInvalidationEvent, realtime);
    return () => {
      clearInterval(timer);
      window.removeEventListener(realtimeInvalidationEvent, realtime);
    };
  }, [discoveryId, discoveryStatus, refresh]);
  useEffect(() => {
    if (!verificationId || !verificationStatus || ['COMPLETED', 'FAILED', 'CANCELED', 'EXPIRED'].includes(verificationStatus)) return;
    const refreshVerification = async () => {
      const result = await apiRequest<{ verification: Verification }>(
        `/camera-onboarding/verification/${verificationId}`,
      );
      setVerification(result.verification);
    };
    const timer = setInterval(() => void refreshVerification().catch(() => undefined), 2000);
    const realtime = () => void refreshVerification().catch(() => undefined);
    window.addEventListener(realtimeInvalidationEvent, realtime);
    return () => { clearInterval(timer); window.removeEventListener(realtimeInvalidationEvent, realtime); };
  }, [verificationId, verificationStatus]);
  const start = async () => {
    const gateway = gateways.find((item) => item.id === gatewayId);
    if (!gateway || gateway.status !== 'ONLINE') {
      setError(
        'O Gateway desta rede está offline. Ligue ou reconecte o Gateway para procurar a câmera.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest<{ discovery: Discovery }>('/camera-onboarding/discovery', {
        method: 'POST',
        body: JSON.stringify({
          gatewayId,
          ...(manufacturer ? { expectedManufacturer: manufacturer } : {}),
          ...(model ? { expectedModel: model } : {}),
          ...(variant ? { expectedVariant: variant } : {}),
        }),
      });
      setDiscovery(result.discovery);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    if (verification) {
      await apiRequest(`/camera-onboarding/verification/${verification.id}/cancel`, {
        method: 'POST', body: '{}',
      }).catch(() => undefined);
    }
    if (!discovery) return onClose();
    await apiRequest(`/camera-onboarding/discovery/${discovery.id}/cancel`, {
      method: 'POST',
      body: '{}',
    }).catch(() => undefined);
    onClose();
  };
  const confirm = async (candidate: Candidate) => {
    if (!discovery || candidate.alreadyRegistered) return;
    setBusy(true);
    try {
      await apiRequest(`/camera-onboarding/discovery/${discovery.id}/confirm`, {
        method: 'POST',
        body: JSON.stringify({ candidateId: candidate.id }),
      });
      const result = await apiRequest<{ verification: Verification }>('/camera-onboarding/verification', {
        method: 'POST',
        body: JSON.stringify({ discoverySessionId: discovery.id, candidateId: candidate.id }),
      });
      setSelectedCandidate(candidate);
      setVerification(result.verification);
    } catch (reason) {
      setError((reason as Error).message);
      setBusy(false);
    }
  };
  const authenticate = async () => {
    if (!verification) return;
    setBusy(true); setError('');
    try {
      const result = await apiRequest<{ verification: Verification }>(
        `/camera-onboarding/verification/${verification.id}/credentials`,
        { method: 'POST', body: JSON.stringify({ username, password }) },
      );
      setPassword('');
      setVerification(result.verification);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  };
  const complete = async () => {
    if (!verification || !selectedCandidate) return;
    setBusy(true); setError('');
    try {
      await apiRequest('/camera-onboarding/complete', {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({ verificationSessionId: verification.id, name: cameraName,
          ...(cameraLocation.trim() ? { location: cameraLocation } : {}) }),
      });
      setCreated(true);
    } catch (reason) {
      const current = reason as Error & { code?: string };
      setError(current.code === 'PLAN_LIMIT_REACHED'
        ? 'Seu plano atingiu o limite de câmeras. Consulte a área de assinatura para fazer upgrade.'
        : current.code === 'CAMERA_ALREADY_REGISTERED'
          ? 'Esta câmera já está cadastrada nesta organização.' : current.message);
    } finally { setBusy(false); }
  };
  const terminalNoResults =
    discovery &&
    ['COMPLETED', 'FAILED', 'EXPIRED'].includes(discovery.status) &&
    !discovery.candidates.length;
  return (
    <div
      className="fixed inset-0 z-[65] overflow-y-auto bg-slate-950/95 p-4"
      role="dialog"
      aria-modal="true"
    >
      <section className="mx-auto my-8 max-w-lg rounded-2xl border border-emerald-500/30 bg-slate-900 p-5">
        <div className="flex justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold">Procurar câmera na rede</h3>
            <p className="mt-1 text-sm text-slate-400">
              {manufacturer} {model}
            </p>
          </div>
          <button type="button" onClick={() => void cancel()}>
            Fechar
          </button>
        </div>
        {!discovery && !verification && (
          <>
            <label className="mt-5 block text-sm">
              Gateway desta rede
              <select
                value={gatewayId}
                onChange={(event) => setGatewayId(event.target.value)}
                className="mt-2 w-full rounded-lg border border-slate-700 bg-slate-950 p-3"
              >
                <option value="">Selecione</option>
                {gateways.map((gateway) => (
                  <option key={gateway.id} value={gateway.id}>
                    {gateway.name} · {gateway.status}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={busy || !gatewayId}
              onClick={() => void start()}
              className="mt-4 w-full rounded-lg bg-emerald-500 p-3 font-semibold text-slate-950 disabled:opacity-50"
            >
              {busy ? 'Iniciando…' : 'Procurar câmera na rede'}
            </button>
          </>
        )}
        {discovery && !verification && (
          <div className="mt-5">
            <p className="text-sm text-slate-300">
              {['DISPATCHED', 'SCANNING', 'RESULTS_AVAILABLE'].includes(discovery.status)
                ? 'Procurando sua câmera… Mantenha a câmera ligada e na mesma rede do Gateway.'
                : `Busca finalizada: ${discovery.status}`}
            </p>
            {discovery.candidates.length > 1 && (
              <p className="mt-3 text-sm text-amber-300">
                Encontramos mais de uma câmera possível. Selecione a correta.
              </p>
            )}
            {discovery.candidates.map((candidate) => (
              <button
                key={candidate.id}
                type="button"
                disabled={busy || candidate.alreadyRegistered}
                onClick={() => void confirm(candidate)}
                className="mt-3 w-full rounded-lg border border-emerald-500/40 p-3 text-left disabled:opacity-50"
              >
                <strong>
                  {candidate.manufacturer ?? manufacturer} {candidate.model ?? model}
                </strong>
                <span className="block text-sm text-slate-300">{candidate.networkAddress}</span>
                <span className="block text-xs text-slate-500">
                  Confiança {candidate.confidence}
                  {candidate.authenticationRequired ? ' · autenticação necessária' : ''}
                  {candidate.alreadyRegistered ? ' · já cadastrada' : ''}
                </span>
              </button>
            ))}
            {terminalNoResults && (
              <p className="mt-4 rounded-lg bg-slate-950 p-3 text-sm text-slate-300">
                O Gateway não localizou a câmera. Verifique se ambos estão na mesma rede local e se
                a comunicação entre dispositivos está permitida. Isso não confirma
                incompatibilidade.
              </p>
            )}
            {!['COMPLETED', 'CANCELED', 'FAILED', 'EXPIRED'].includes(discovery.status) && (
              <button
                type="button"
                onClick={() => void cancel()}
                className="mt-4 w-full rounded-lg border border-slate-600 p-3 text-sm"
              >
                Cancelar busca
              </button>
            )}
          </div>
        )}
        {verification && selectedCandidate && (
          <div className="mt-5">
            <h4 className="font-semibold">Verificar acesso à câmera</h4>
            <p className="mt-1 text-sm text-slate-400">
              Use as credenciais configuradas no aplicativo ou painel da câmera. Elas serão usadas
              apenas nesta verificação e não serão salvas como cadastro.
            </p>
            {['WAITING_FOR_CREDENTIALS', 'FAILED'].includes(verification.status) && (
              <div className="mt-4 space-y-3">
                <label className="block text-sm">Usuário
                  <input autoComplete="username" value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
                </label>
                <label className="block text-sm">Senha
                  <input type="password" autoComplete="current-password" value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
                </label>
                {verification.status === 'FAILED' && (
                  <p className="rounded-lg bg-amber-950/40 p-3 text-sm text-amber-200">
                    {verification.result === 'AUTHENTICATION_FAILED'
                      ? 'Usuário ou senha não foram aceitos pela câmera. Confira os dados e tente novamente.'
                      : `A verificação não foi concluída (${verification.result ?? verification.errorCode ?? 'erro de rede'}).`}
                  </p>
                )}
                <button type="button" disabled={busy || !username || !password}
                  onClick={() => void authenticate()}
                  className="w-full rounded-lg bg-emerald-500 p-3 font-semibold text-slate-950 disabled:opacity-50">
                  {busy ? 'Enviando com segurança…' : 'Verificar câmera'}
                </button>
              </div>
            )}
            {['DISPATCHED', 'AUTHENTICATING', 'VERIFYING_ONVIF', 'VERIFYING_MEDIA', 'VERIFYING_RTSP'].includes(verification.status) && (
              <p className="mt-4 rounded-lg bg-slate-950 p-3 text-sm text-slate-200">
                Verificando identidade, recursos ONVIF e acesso RTSP…
              </p>
            )}
            {verification.status === 'COMPLETED' && (
              <div className="mt-4 rounded-lg border border-emerald-500/40 p-3 text-sm">
                <strong>{created ? 'Câmera adicionada com sucesso.' : 'Tudo pronto para adicionar sua câmera.'}</strong>
                <p className="mt-1 text-slate-300">
                  {verification.detectedIdentity?.manufacturer} {verification.detectedIdentity?.model}
                </p>
                <p className="text-xs text-slate-400">
                  ONVIF {verification.detectedCapabilities?.onvif ? 'confirmado' : 'parcial'} · RTSP {verification.detectedCapabilities?.rtsp ? 'confirmado' : 'não confirmado'}
                </p>
                {!created ? (
                  <div className="mt-4 space-y-3">
                    <label className="block">Nome da câmera *
                      <input required minLength={2} maxLength={160} value={cameraName}
                        onChange={(event) => setCameraName(event.target.value)}
                        placeholder="Entrada principal"
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
                    </label>
                    <label className="block">Local
                      <input maxLength={255} value={cameraLocation}
                        onChange={(event) => setCameraLocation(event.target.value)} placeholder="Recepção"
                        className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 p-3" />
                    </label>
                    <button type="button" disabled={busy || cameraName.trim().length < 2}
                      onClick={() => void complete()}
                      className="w-full rounded-lg bg-emerald-500 p-3 font-semibold text-slate-950 disabled:opacity-50">
                      {busy ? 'Adicionando…' : 'Adicionar câmera'}
                    </button>
                  </div>
                ) : (
                  <div>
                    <p className="mt-3 text-slate-300">
                      O Vigion agora aguardará a comunicação do Gateway para confirmar o estado da câmera.
                    </p>
                    <button type="button" onClick={() => onConfirm(selectedCandidate)}
                      className="mt-3 w-full rounded-lg bg-emerald-500 p-3 font-semibold text-slate-950">
                      Concluir
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-rose-950/50 p-3 text-sm text-rose-200">
            {error}
          </p>
        )}
        <p className="mt-4 text-xs text-slate-500">
          A busca não testa senhas. A etapa de verificação usa somente a credencial informada,
          não baixa vídeo e não cria a câmera automaticamente.
        </p>
      </section>
    </div>
  );
}
