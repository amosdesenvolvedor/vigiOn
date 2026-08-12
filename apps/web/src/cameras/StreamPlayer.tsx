import type HlsType from 'hls.js';
import { useEffect, useRef, useState } from 'react';
import { apiRequest, apiUrl } from '../auth/api';

type SessionStatus =
  | 'REQUESTED'
  | 'STARTING'
  | 'ACTIVE'
  | 'STOPPING'
  | 'ENDED'
  | 'FAILED'
  | 'EXPIRED';
interface Session {
  id: string;
  status: SessionStatus;
  errorCode: string | null;
  expiresAt: string;
  cameraName: string;
}

export function StreamPlayer({
  cameraId,
  cameraName,
  onClose,
}: {
  cameraId: string;
  cameraName: string;
  onClose(): void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const sessionId = useRef<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [token, setToken] = useState('');
  const [playbackUrl, setPlaybackUrl] = useState('');
  const [state, setState] = useState<
    'connecting' | 'playing' | 'reconnecting' | 'failed' | 'ended'
  >('connecting');
  const [message, setMessage] = useState('Conectando à câmera...');

  useEffect(() => {
    let canceled = false;
    apiRequest<{ session: Session; playbackToken: string; playbackUrl: string }>(
      `/cameras/${cameraId}/stream-sessions`,
      {
        method: 'POST',
        headers: { 'idempotency-key': crypto.randomUUID() },
        body: '{}',
      },
    )
      .then((result) => {
        if (!canceled) {
          sessionId.current = result.session.id;
          setSession(result.session);
          setToken(result.playbackToken);
          setPlaybackUrl(result.playbackUrl);
        }
      })
      .catch((error: Error) => {
        if (!canceled) {
          setState('failed');
          setMessage(error.message);
        }
      });
    return () => {
      canceled = true;
    };
  }, [cameraId]);

  useEffect(
    () => () => {
      if (sessionId.current)
        void apiRequest(`/stream-sessions/${sessionId.current}`, { method: 'DELETE' }).catch(
          () => undefined,
        );
    },
    [],
  );

  useEffect(() => {
    let backgroundTimer: number | undefined;
    const visibilityChanged = () => {
      if (document.hidden) {
        backgroundTimer = window.setTimeout(() => {
          const id = sessionId.current;
          sessionId.current = null;
          if (id)
            void apiRequest(`/stream-sessions/${id}`, { method: 'DELETE' }).catch(() => undefined);
          onClose();
        }, 60_000);
      } else if (backgroundTimer) {
        window.clearTimeout(backgroundTimer);
        backgroundTimer = undefined;
      }
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged);
      if (backgroundTimer) window.clearTimeout(backgroundTimer);
    };
  }, [onClose]);

  useEffect(() => {
    if (!session || ['ACTIVE', 'FAILED', 'ENDED', 'EXPIRED'].includes(session.status)) return;
    const timer = window.setInterval(() => {
      void apiRequest<{ session: Session }>(`/stream-sessions/${session.id}`)
        .then(({ session: current }) => {
          setSession(current);
          if (current.status === 'FAILED') {
            setState('failed');
            setMessage(errorMessage(current.errorCode));
          }
          if (current.status === 'EXPIRED') {
            setState('ended');
            setMessage('Sessão expirada');
          }
        })
        .catch((error: Error) => {
          setState('failed');
          setMessage(error.message);
        });
    }, 1500);
    return () => window.clearInterval(timer);
  }, [session]);

  useEffect(() => {
    if (session?.status !== 'ACTIVE' || !video.current || !token || !playbackUrl) return;
    let disposed = false;
    let player: HlsType | null = null;
    void import('hls.js').then(({ default: Hls }) => {
      if (disposed) return;
      if (!Hls.isSupported()) {
        setState('failed');
        setMessage('Este navegador não suporta o player HLS seguro.');
        return;
      }
      const hls = new Hls({
        lowLatencyMode: true,
        backBufferLength: 0,
        maxBufferLength: 10,
        xhrSetup: (xhr) => xhr.setRequestHeader('Authorization', `Stream ${token}`),
      });
      player = hls;
      let retries = 0;
      hls.loadSource(`${apiUrl}${playbackUrl}`);
      hls.attachMedia(video.current!);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        retries = 0;
        setState('playing');
        setMessage('Ao vivo');
        void video.current?.play();
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        retries += 1;
        if (retries <= 3 && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          setState('reconnecting');
          setMessage(`Reconectando (${retries}/3)...`);
          window.setTimeout(() => hls.startLoad(), 1000 * retries);
        } else {
          setState('failed');
          setMessage('Não foi possível reproduzir o stream.');
          hls.destroy();
        }
      });
    });
    return () => {
      disposed = true;
      player?.destroy();
    };
  }, [session?.status, playbackUrl, token]);

  const stop = async () => {
    if (sessionId.current) {
      const id = sessionId.current;
      sessionId.current = null;
      await apiRequest(`/stream-sessions/${id}`, { method: 'DELETE' }).catch(() => undefined);
    }
    setState('ended');
    onClose();
  };
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/95 p-4">
      <div className="mx-auto my-8 max-w-5xl rounded-2xl border border-slate-700 bg-slate-900 p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-emerald-400">
              Visualização ao vivo
            </p>
            <h2 className="text-xl font-bold">{cameraName}</h2>
          </div>
          <button
            onClick={() => void stop()}
            className="rounded border border-slate-700 px-4 py-2 text-sm"
          >
            Encerrar
          </button>
        </div>
        <div className="relative mt-5 aspect-video overflow-hidden rounded-xl bg-black">
          <video ref={video} controls muted playsInline className="h-full w-full" />
          {state !== 'playing' && (
            <div className="absolute inset-0 grid place-items-center bg-black/75 text-center">
              <div>
                <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-slate-700 border-t-emerald-400" />
                <p className={state === 'failed' ? 'text-rose-300' : 'text-slate-200'}>{message}</p>
              </div>
            </div>
          )}
        </div>
        {video.current?.requestFullscreen && (
          <button
            className="mt-3 min-h-11 rounded border border-slate-700 px-4 text-sm"
            onClick={() => void video.current?.requestFullscreen()}
          >
            Tela cheia
          </button>
        )}
        <p className="mt-3 text-sm text-slate-400">{message} · Sessão temporária e revogável</p>
      </div>
    </div>
  );
}

const errorMessage = (code: string | null) =>
  ({
    STREAM_TIMEOUT: 'Tempo limite ao conectar à câmera.',
    UNSUPPORTED_CODEC: 'Codec não suportado pelo navegador.',
    STREAM_START_FAILED: 'Não foi possível conectar à câmera.',
  })[code ?? ''] ?? 'Não foi possível iniciar o stream.';
