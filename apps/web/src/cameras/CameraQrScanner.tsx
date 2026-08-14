import type { IScannerControls } from '@zxing/browser';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';

export type CameraQrData = {
  name?: string;
  location?: string;
  manufacturer?: string;
  model?: string;
  identifier?: string;
  connectionType?: 'WIFI' | 'ETHERNET' | 'OTHER';
  protocol?: 'RTSP' | 'ONVIF' | 'HTTP' | 'HTTPS' | 'OTHER';
  username?: string;
  password?: string;
  streamHost?: string;
  streamPort?: string;
  streamPath?: string;
  streamTransport?: 'tcp' | 'udp';
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function fromRtsp(value: string): CameraQrData | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'rtsp:' && url.protocol !== 'rtsps:') return null;
    return {
      connectionType: 'WIFI',
      protocol: 'RTSP',
      username: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      streamHost: url.hostname,
      streamPort: url.port || '554',
      streamPath: `${url.pathname}${url.search}` || '/',
      streamTransport: 'tcp',
    };
  } catch {
    return null;
  }
}

function wifiField(payload: string, key: string) {
  const match = payload.match(new RegExp(`(?:^|;)${key}:((?:\\\\.|[^;])*)`));
  return match?.[1]?.replace(/\\([\\;,:"])/g, '$1').trim() ?? '';
}

function parseCameraQr(payload: string): CameraQrData {
  const raw = payload.trim();
  if (!raw || raw.length > 8192) throw new Error('QR Code vazio ou maior que o permitido.');

  const directRtsp = fromRtsp(raw);
  if (directRtsp) return directRtsp;

  if (/^WIFI:/i.test(raw)) {
    const ssid = wifiField(raw.slice(5), 'S');
    if (!ssid) throw new Error('O QR de Wi-Fi não contém o nome da rede.');
    return {
      connectionType: 'WIFI',
      identifier: ssid,
    };
  }

  if (raw.startsWith('{')) {
    let value: Record<string, unknown>;
    try {
      value = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      throw new Error('O conteúdo JSON do QR Code é inválido.');
    }
    const stream =
      typeof value.stream === 'object' && value.stream !== null
        ? (value.stream as Record<string, unknown>)
        : {};
    const rtsp = fromRtsp(text(value.rtspUrl) || text(value.rtsp) || text(stream.url));
    const connectionType = text(value.connectionType).toUpperCase();
    const protocol = text(value.protocol).toUpperCase();
    const parsedConnectionType = ['WIFI', 'ETHERNET', 'OTHER'].includes(connectionType)
      ? (connectionType as NonNullable<CameraQrData['connectionType']>)
      : rtsp?.connectionType || 'WIFI';
    const parsedProtocol = ['RTSP', 'ONVIF', 'HTTP', 'HTTPS', 'OTHER'].includes(protocol)
      ? (protocol as NonNullable<CameraQrData['protocol']>)
      : rtsp?.protocol;
    return {
      ...rtsp,
      name: text(value.name),
      location: text(value.location),
      manufacturer: text(value.manufacturer),
      model: text(value.model),
      identifier: text(value.identifier) || text(value.deviceId) || text(value.uid),
      connectionType: parsedConnectionType,
      ...(parsedProtocol ? { protocol: parsedProtocol } : {}),
      username: text(value.username) || text(stream.username) || rtsp?.username || '',
      password: text(value.password) || text(stream.password) || rtsp?.password || '',
      streamHost: text(value.host) || text(stream.host) || rtsp?.streamHost || '',
      streamPort: String(value.port || stream.port || rtsp?.streamPort || ''),
      streamPath: text(value.path) || text(stream.path) || rtsp?.streamPath || '',
      streamTransport:
        text(value.transport).toLowerCase() === 'udp' || text(stream.transport).toLowerCase() === 'udp'
          ? 'udp'
          : 'tcp',
    };
  }

  return { connectionType: 'WIFI', identifier: raw };
}

export function CameraQrScanner({
  onRead,
  onClose,
}: {
  onRead: (data: CameraQrData) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const handledRef = useRef(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(true);

  const accept = useCallback((payload: string) => {
    if (handledRef.current) return;
    try {
      const data = parseCameraQr(payload);
      handledRef.current = true;
      controlsRef.current?.stop();
      onRead(data);
    } catch (reason) {
      setError((reason as Error).message);
    }
  }, [onRead]);

  useEffect(() => {
    let mounted = true;
    void import('@zxing/browser')
      .then(({ BrowserQRCodeReader }) =>
        new BrowserQRCodeReader().decodeFromVideoDevice(undefined, videoRef.current!, (result) => {
          if (result && mounted) accept(result.getText());
        }),
      )
      .then((controls) => {
        if (!mounted) controls.stop();
        else controlsRef.current = controls;
      })
      .catch(() => {
        if (mounted)
          setError('Não foi possível acessar a câmera. Autorize o uso ou envie uma imagem do QR Code.');
      })
      .finally(() => mounted && setStarting(false));
    return () => {
      mounted = false;
      controlsRef.current?.stop();
    };
  }, [accept]);

  const readImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    const url = URL.createObjectURL(file);
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const result = await new BrowserQRCodeReader().decodeFromImageUrl(url);
      accept(result.getText());
    } catch {
      setError('Não encontramos um QR Code legível nessa imagem.');
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] overflow-y-auto bg-slate-950/95 p-4">
      <section className="mx-auto my-8 max-w-lg rounded-2xl border border-emerald-500/30 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold">Adicionar câmera por QR Code</h3>
            <p className="mt-1 text-sm text-slate-400">
              Aponte para o código da câmera, da URL RTSP ou da rede Wi-Fi.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-sm text-slate-300">
            Fechar
          </button>
        </div>
        <div className="relative mt-5 aspect-square overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
          <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
          <div className="pointer-events-none absolute inset-[15%] rounded-2xl border-2 border-emerald-400 shadow-[0_0_0_999px_rgba(2,6,23,0.4)]" />
          {starting && (
            <div className="absolute inset-0 grid place-items-center text-sm text-slate-300">
              Iniciando câmera…
            </div>
          )}
        </div>
        {error && <p className="mt-4 rounded-lg bg-rose-950/50 p-3 text-sm text-rose-200">{error}</p>}
        <label className="mt-4 block cursor-pointer rounded-lg border border-slate-600 p-3 text-center text-sm font-semibold text-emerald-300">
          Ler QR de uma imagem
          <input type="file" accept="image/*" capture="environment" onChange={readImage} className="sr-only" />
        </label>
        <p className="mt-3 text-xs text-slate-500">
          QRs RTSP e VigiOn preenchem a conexão. QR proprietário pode preencher apenas o identificador.
        </p>
      </section>
    </div>
  );
}
