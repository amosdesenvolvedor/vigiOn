import { AuthProvider, useAuth } from './auth/AuthContext';
import { AuthScreen } from './auth/AuthScreen';
import { OrganizationPanel } from './organizations/OrganizationPanel';
import { BillingPanel } from './billing/BillingPanel';
import { CameraPanel } from './cameras/CameraPanel';
import { GatewayPanel } from './gateways/GatewayPanel';
import { EventPanel } from './events/EventPanel';
import { NotificationCenter } from './notifications/NotificationCenter';
import { IntelligencePanel } from './intelligence/IntelligencePanel';
import { MonitoringDashboard } from './dashboard/MonitoringDashboard';
import { MobileExperience } from './mobile/MobileExperience';
import { PlatformDashboard } from './platform/PlatformDashboard';
import { SupportPage } from './support/SupportPage';
import { PrivacyPolicyPage } from './legal/PrivacyPolicyPage';
import { TermsOfServicePage } from './legal/TermsOfServicePage';

function ProtectedArea() {
  const { user, organization, loading, logout } = useAuth();
  if (loading)
    return (
      <main className="grid min-h-screen place-items-center bg-slate-950 text-slate-300">
        Validando sessão…
      </main>
    );
  if (!user || !organization) return <AuthScreen />;
  if (window.location.pathname.startsWith('/platform'))
    return user.platformRole === 'PLATFORM_ADMIN' ? (
      <PlatformDashboard logout={logout} />
    ) : (
      <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-slate-100">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Acesso restrito</h1>
          <p className="mt-2 text-slate-400">Sua conta não possui autorização de plataforma.</p>
          <a
            href="/monitoring"
            className="mt-5 inline-block rounded border border-slate-700 px-4 py-3"
          >
            Voltar ao dashboard
          </a>
        </div>
      </main>
    );
  return (
    <main className="min-h-screen bg-slate-950 px-4 pb-24 pt-4 text-slate-100 sm:p-6">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <strong className="text-xl">VigiOn</strong>
            <p className="text-sm text-slate-400">{organization.name}</p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/suporte"
              className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:text-emerald-300"
            >
              Suporte
            </a>
            <button
              onClick={() => void logout()}
              className="rounded-lg border border-slate-700 px-4 py-2 text-sm"
            >
              Sair
            </button>
          </div>
        </header>
        <MobileExperience />
        <section className="pt-8 sm:pt-12">
          <p className="text-sm font-semibold uppercase tracking-[.2em] text-emerald-400">
            Sessão protegida
          </p>
          <h1 className="mt-4 text-4xl font-bold">Olá, {user.name}.</h1>
          <p className="mt-4 text-slate-400">
            Sua sessão está ativa com a função {user.role}. A central acompanha sua organização em
            tempo quase real.
          </p>
        </section>
        <div id="more">
          <OrganizationPanel />
        </div>
        <div id="monitoring">
          <MonitoringDashboard />
        </div>
        <div id="cameras">
          <CameraPanel />
        </div>
        <div id="events">
          <EventPanel />
        </div>
        <IntelligencePanel />
        <div id="alerts">
          <NotificationCenter />
        </div>
        <GatewayPanel />
        <BillingPanel />
      </div>
      <nav
        aria-label="Navegação principal"
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-slate-700 bg-slate-950/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {[
          ['monitoring', 'Central', '◉'],
          ['cameras', 'Câmeras', '▣'],
          ['alerts', 'Alertas', '△'],
          ['events', 'Eventos', '≡'],
          ['more', 'Mais', '•••'],
        ].map(([target, label, icon]) => (
          <a
            key={target}
            href={`#${target}`}
            className="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs text-slate-300 focus:bg-slate-800 focus:outline-none"
          >
            <span aria-hidden="true" className="text-lg">
              {icon}
            </span>
            <span>{label}</span>
          </a>
        ))}
      </nav>
    </main>
  );
}

export function App() {
  if (window.location.pathname === '/termos' || window.location.pathname === '/termos/')
    return <TermsOfServicePage />;
  if (window.location.pathname === '/privacidade' || window.location.pathname === '/privacidade/')
    return <PrivacyPolicyPage />;
  if (window.location.pathname === '/suporte' || window.location.pathname === '/suporte/')
    return <SupportPage />;
  return (
    <AuthProvider>
      <ProtectedArea />
    </AuthProvider>
  );
}
