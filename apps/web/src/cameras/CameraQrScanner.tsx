import type { IScannerControls } from '@zxing/browser';
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { apiRequest } from '../auth/api';
import { classifyCameraFailure, isAcceptedQrImage, type ScanFailure } from './qrScannerSupport';

export type CameraQrData = { manufacturer?: string; model?: string; identifier?: string };
type CatalogMatch = {
  modelId: string;
  variantId: string;
  manufacturer: string;
  brand: string;
  model: string;
  hardwareVersion: string | null;
  confidence: string;
};
type Analysis = {
  type: string;
  recognized: boolean;
  manufacturerCandidate: { value: string; confidence: string } | null;
  modelCandidate: { value: string; confidence: string } | null;
  identifiers: Array<{ type: string; value: string; confidence: string }>;
  catalogMatches: CatalogMatch[];
  confidence: string;
  requiresUserConfirmation: boolean;
  warnings: string[];
  nextAction: string;
};

const failureMessage: Record<ScanFailure, string> = {
  PERMISSION_DENIED:
    'A permissão da câmera foi negada. Você pode enviar uma imagem ou colar o conteúdo.',
  CAMERA_NOT_AVAILABLE: 'Nenhuma câmera está disponível neste dispositivo.',
  CAMERA_IN_USE: 'A câmera está sendo usada por outro aplicativo.',
  UNSUPPORTED_BROWSER: 'Este navegador não oferece acesso compatível à câmera.',
  NO_QR_DETECTED: 'Não encontramos um QR Code legível.',
  INVALID_IMAGE: 'A imagem selecionada é inválida ou não contém um QR Code legível.',
};

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
  const [cameraActive, setCameraActive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [manual, setManual] = useState('');
  const [error, setError] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const telemetry = useCallback((event: string, reason?: ScanFailure) => {
    void apiRequest('/camera-onboarding/qr/telemetry', {
      method: 'POST',
      body: JSON.stringify({ event, ...(reason ? { reason } : {}) }),
    }).catch(() => undefined);
  }, []);
  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    const stream = videoRef.current?.srcObject;
    if (stream instanceof MediaStream) stream.getTracks().forEach((track) => track.stop());
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
    setStarting(false);
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  const analyze = useCallback(
    async (payload: string) => {
      if (handledRef.current || analyzing) return;
      const value = payload.trim();
      if (!value) {
        setError('Informe o conteúdo do QR Code.');
        return;
      }
      handledRef.current = true;
      setAnalyzing(true);
      setError('');
      stopCamera();
      try {
        const result = await apiRequest<{ analysis: Analysis }>('/camera-onboarding/qr/analyze', {
          method: 'POST',
          body: JSON.stringify({ payload: value }),
        });
        setAnalysis(result.analysis);
      } catch (reason) {
        handledRef.current = false;
        setError((reason as Error).message || 'Não foi possível analisar o QR Code.');
        telemetry('qr_scan_failed');
      } finally {
        setAnalyzing(false);
      }
    },
    [analyzing, stopCamera, telemetry],
  );

  const startCamera = async () => {
    const mediaDevices = (navigator as Navigator & { mediaDevices?: MediaDevices }).mediaDevices;
    if (!mediaDevices?.getUserMedia) {
      setError(failureMessage.UNSUPPORTED_BROWSER);
      telemetry('qr_scan_failed', 'UNSUPPORTED_BROWSER');
      return;
    }
    setStarting(true);
    setError('');
    telemetry('qr_scan_started');
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const controls = await new BrowserQRCodeReader().decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } }, audio: false },
        videoRef.current!,
        (result) => {
          if (result) void analyze(result.getText());
        },
      );
      controlsRef.current = controls;
      setCameraActive(true);
    } catch (reason) {
      const failure = classifyCameraFailure(reason, Boolean(mediaDevices));
      setError(failureMessage[failure]);
      telemetry('qr_scan_failed', failure);
      stopCamera();
    } finally {
      setStarting(false);
    }
  };

  const readImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!isAcceptedQrImage(file)) {
      setError(failureMessage.INVALID_IMAGE);
      telemetry('qr_scan_failed', 'INVALID_IMAGE');
      return;
    }
    stopCamera();
    setError('');
    const url = URL.createObjectURL(file);
    try {
      const { BrowserQRCodeReader } = await import('@zxing/browser');
      const result = await new BrowserQRCodeReader().decodeFromImageUrl(url);
      await analyze(result.getText());
    } catch {
      setError(failureMessage.NO_QR_DETECTED);
      telemetry('qr_scan_failed', 'NO_QR_DETECTED');
    } finally {
      URL.revokeObjectURL(url);
      event.target.value = '';
    }
  };

  const confirm = (match?: CatalogMatch) => {
    const selected = match ?? analysis?.catalogMatches[0];
    onRead({
      ...(selected?.manufacturer || analysis?.manufacturerCandidate?.value
        ? { manufacturer: selected?.manufacturer ?? analysis!.manufacturerCandidate!.value }
        : {}),
      ...(selected?.model || analysis?.modelCandidate?.value
        ? { model: selected?.model ?? analysis!.modelCandidate!.value }
        : {}),
      ...(analysis?.identifiers.length === 1 ? { identifier: analysis.identifiers[0]!.value } : {}),
    });
  };

  return (
    <div
      className="fixed inset-0 z-[60] overflow-y-auto bg-slate-950/95 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-title"
    >
      <section className="mx-auto my-5 max-w-lg rounded-2xl border border-emerald-500/30 bg-slate-900 p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="qr-title" className="text-lg font-bold">
              Identificar câmera por QR Code
            </h3>
            <p className="mt-1 text-sm text-slate-400">
              A câmera só será ligada quando você tocar em “Usar câmera”. A leitura ocorre neste
              dispositivo.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="text-sm text-slate-300"
          >
            Fechar
          </button>
        </div>

        {!analysis && (
          <>
            <div className="relative mt-5 aspect-video overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
              <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
              {!cameraActive && (
                <div className="absolute inset-0 grid place-items-center px-5 text-center text-sm text-slate-400">
                  A câmera está desligada.
                </div>
              )}
              {cameraActive && (
                <div className="pointer-events-none absolute inset-[15%] rounded-2xl border-2 border-emerald-400" />
              )}
            </div>
            <button
              type="button"
              disabled={starting || cameraActive}
              onClick={() => void startCamera()}
              className="mt-4 w-full rounded-lg bg-emerald-500 p-3 font-semibold text-slate-950 disabled:opacity-60"
            >
              {starting ? 'Solicitando permissão…' : cameraActive ? 'Câmera em uso' : 'Usar câmera'}
            </button>
            {cameraActive && (
              <button
                type="button"
                onClick={stopCamera}
                className="mt-2 w-full rounded-lg border border-slate-600 p-3 text-sm"
              >
                Desligar câmera
              </button>
            )}
            <label className="mt-3 block cursor-pointer rounded-lg border border-slate-600 p-3 text-center text-sm font-semibold text-emerald-300">
              Ler QR de uma imagem
              <input type="file" accept="image/*" onChange={readImage} className="sr-only" />
            </label>
            <div className="my-4 flex items-center gap-3 text-xs text-slate-500">
              <span className="h-px flex-1 bg-slate-700" />
              OU
              <span className="h-px flex-1 bg-slate-700" />
            </div>
            <label className="block text-sm">
              Colar conteúdo manualmente
              <textarea
                value={manual}
                maxLength={8192}
                onChange={(event) => setManual(event.target.value)}
                className="mt-2 min-h-24 w-full rounded-lg border border-slate-700 bg-slate-950 p-3"
                placeholder="Conteúdo decodificado do QR"
              />
            </label>
            <button
              type="button"
              disabled={analyzing || !manual.trim()}
              onClick={() => void analyze(manual)}
              className="mt-3 w-full rounded-lg border border-emerald-500/60 p-3 font-semibold text-emerald-300 disabled:opacity-50"
            >
              {analyzing ? 'Analisando…' : 'Analisar conteúdo'}
            </button>
          </>
        )}

        {error && (
          <p role="alert" className="mt-4 rounded-lg bg-rose-950/50 p-3 text-sm text-rose-200">
            {error}
          </p>
        )}
        {analysis && (
          <div className="mt-5 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
            <h4 className="font-bold">
              {analysis.type === 'VIGION'
                ? 'QR Code VigiOn reconhecido'
                : analysis.catalogMatches.length > 1
                  ? 'Encontramos mais de uma variante possível'
                  : analysis.recognized
                    ? 'Encontramos uma possível câmera'
                    : analysis.manufacturerCandidate
                      ? 'Fabricante identificado'
                      : 'QR Code não identificado automaticamente'}
            </h4>
            <p className="mt-2 text-sm text-slate-400">
              Tipo: {analysis.type} · confiança: {analysis.confidence}
            </p>
            {analysis.catalogMatches.map((match) => (
              <button
                key={match.variantId}
                type="button"
                onClick={() => confirm(match)}
                className="mt-3 block w-full rounded-lg border border-emerald-500/40 p-3 text-left text-sm"
              >
                <strong>
                  {match.brand} {match.model}
                </strong>
                {match.hardwareVersion ? ` · ${match.hardwareVersion}` : ''}
                <span className="block text-xs text-slate-400">Confirmar esta identificação</span>
              </button>
            ))}
            {!analysis.catalogMatches.length && analysis.manufacturerCandidate && (
              <p className="mt-3 text-sm">
                Fabricante possível: {analysis.manufacturerCandidate.value}. Precisamos confirmar o
                modelo.
              </p>
            )}
            {analysis.warnings.map((warning) => (
              <p key={warning} className="mt-3 text-xs text-amber-300">
                {warning}
              </p>
            ))}
            {!analysis.catalogMatches.length && (
              <button
                type="button"
                onClick={() => confirm()}
                className="mt-4 w-full rounded-lg border border-slate-600 p-3 text-sm"
              >
                Continuar com seleção manual
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                handledRef.current = false;
                setAnalysis(null);
                setManual('');
              }}
              className="mt-2 w-full p-2 text-sm text-slate-400"
            >
              Ler outro QR
            </button>
          </div>
        )}
        <p className="mt-4 text-xs text-slate-500">
          Nenhum QR cria, conecta ou configura uma câmera automaticamente.
        </p>
      </section>
    </div>
  );
}
