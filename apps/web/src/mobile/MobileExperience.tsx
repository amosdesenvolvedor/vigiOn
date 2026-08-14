import { useEffect, useState } from 'react';
import { BrandName } from '../branding/BrandName';
import { apiRequest } from '../auth/api';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const toBytes = (value: string) => {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (character) => character.charCodeAt(0));
};

export function MobileExperience() {
  const [online, setOnline] = useState(navigator.onLine);
  const [install, setInstall] = useState<InstallPromptEvent | null>(null);
  const [update, setUpdate] = useState<ServiceWorker | null>(null);
  const [pushState, setPushState] = useState<
    'loading' | 'unsupported' | 'unavailable' | 'prompt' | 'enabled' | 'denied'
  >('loading');

  useEffect(() => {
    const connected = () => {
      setOnline(true);
      window.dispatchEvent(new Event('vigion:network-recovered'));
    };
    const disconnected = () => setOnline(false);
    const installable = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallPromptEvent);
    };
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    window.addEventListener('beforeinstallprompt', installable);
    if (
      !('serviceWorker' in navigator) ||
      !('PushManager' in window) ||
      !('Notification' in window)
    ) {
      setPushState('unsupported');
    } else {
      void navigator.serviceWorker.ready.then(async (registration) => {
        setPushState(
          (await registration.pushManager.getSubscription())
            ? 'enabled'
            : Notification.permission === 'denied'
              ? 'denied'
              : 'prompt',
        );
      });
      navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
      void navigator.serviceWorker.getRegistration().then((registration) => {
        if (registration?.waiting) setUpdate(registration.waiting);
        registration?.addEventListener('updatefound', () => {
          registration.installing?.addEventListener('statechange', () => {
            if (registration.waiting && navigator.serviceWorker.controller)
              setUpdate(registration.waiting);
          });
        });
      });
    }
    return () => {
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', disconnected);
      window.removeEventListener('beforeinstallprompt', installable);
    };
  }, []);

  const enablePush = async () => {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted')
      return setPushState(permission === 'denied' ? 'denied' : 'prompt');
    const configuration = await apiRequest<{ available: boolean; publicKey: string | null }>(
      '/push/configuration',
    );
    if (!configuration.available || !configuration.publicKey) return setPushState('unavailable');
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: toBytes(configuration.publicKey),
    });
    await apiRequest('/push/subscriptions', {
      method: 'POST',
      body: JSON.stringify(subscription.toJSON()),
    });
    setPushState('enabled');
  };

  const disablePush = async () => {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await apiRequest('/push/subscriptions', {
        method: 'DELETE',
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
      await subscription.unsubscribe();
    }
    setPushState('prompt');
  };

  return (
    <>
      {!online && (
        <div
          role="status"
          className="sticky top-0 z-50 bg-amber-900 px-4 py-3 text-center text-sm text-amber-100"
        >
          Você está offline neste dispositivo. Os dados serão atualizados quando a conexão retornar.
        </div>
      )}
      <section
        id="mobile-app"
        className="mb-6 flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm"
      >
        <strong className="mr-auto">Aplicativo <BrandName /></strong>
        {install && (
          <button
            className="min-h-11 rounded-lg border border-emerald-700 px-4"
            onClick={() => void install.prompt().then(() => setInstall(null))}
          >
            Instalar aplicativo
          </button>
        )}
        {pushState === 'prompt' && (
          <button
            className="min-h-11 rounded-lg bg-emerald-700 px-4 font-semibold"
            onClick={() => void enablePush()}
          >
            Ativar notificações
          </button>
        )}
        {pushState === 'enabled' && (
          <>
            <span className="text-emerald-300">Notificações ativadas</span>
            <button
              className="min-h-11 rounded-lg border border-slate-700 px-4"
              onClick={() => void disablePush()}
            >
              Desativar neste dispositivo
            </button>
          </>
        )}
        {pushState === 'denied' && (
          <span className="text-amber-300">Notificações bloqueadas pelo navegador</span>
        )}
        {pushState === 'unsupported' && (
          <span className="text-slate-400">Push não suportado neste navegador</span>
        )}
        {pushState === 'unavailable' && (
          <span className="text-slate-400">Push ainda não configurado no servidor</span>
        )}
        {update && (
          <button
            className="min-h-11 rounded-lg border border-slate-600 px-4"
            onClick={() => update.postMessage({ type: 'SKIP_WAITING' })}
          >
            Atualizar aplicativo
          </button>
        )}
      </section>
    </>
  );
}
