import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { LogoLoader } from '../components/LogoLoader';
import { PortalShell } from './layout/PortalShell';
import { VIEW_TITLES } from './layout/navigation';
import { usePortalRouter } from './routing/usePortalRouter';
import { useClientSnapshot } from './hooks/useClientSnapshot';
import { buildDashboardData } from './services/dashboardModel';
import { PortfolioService } from './services/PortfolioService';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { OnboardingWizard } from './features/onboarding/OnboardingWizard';
import { ActivateProductsModal } from './features/onboarding/ActivateProductsModal';
import { PortfolioPage } from './features/portfolio/PortfolioPage';
import { AllocationPage } from './features/allocation/AllocationPage';
import { MutualFundsModule } from './features/mutual-funds/MutualFundsModule';
import { TransactionsPage } from './features/transactions/TransactionsPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { DocumentsPage } from './features/documents/DocumentsPage';
import { ProfilePage } from './features/profile/ProfilePage';
import { SipPage } from './features/sip/SipPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { SupportPage } from './features/support/SupportPage';
import { ChangePasswordModal } from './features/profile/ChangePasswordModal';
import { ImportPortfolioModal } from './features/portfolio/ImportPortfolioModal';
import { IdleWarning } from './components/IdleWarning';
import { useIdleTimeout } from './hooks/useIdleTimeout';
import { SetPinPrompt } from './features/profile/SetPinPrompt';
import {
  PIN_PROMPT_LIMIT,
  hasProfile,
  pinPromptSkips,
  recordPinPromptSkip,
  silencePinPrompt,
} from '../lib/pinDevice';

interface PortalAppProps {
  clientId: string;
  onLogout: () => void;
  /**
   * Sign-out triggered by inactivity rather than by the client. Lands them back
   * on the sign-in screen (which opens on the PIN keypad) instead of the public
   * home page, because they did not ask to leave.
   */
  onIdleLogout?: () => void;
}

/**
 * Wealth Portal root. Fetches one client snapshot and derives every view's
 * model from it, so navigation between Dashboard / Portfolio / Allocation never
 * re-queries. Owns internal routing; leaves the host router in App.tsx untouched.
 */
export default function PortalApp({ clientId, onLogout, onIdleLogout }: PortalAppProps) {
  const { view, navigate } = usePortalRouter();
  const { snapshot, loading, error, refreshedAt, refresh } = useClientSnapshot(clientId);
  const [showChangePw, setShowChangePw] = useState(false);
  const [showActivate, setShowActivate] = useState(false);
  /*
   * Owned here rather than by either screen: the dashboard and the portfolio
   * both offer the import, and two components each holding their own copy of
   * the wizard is two places for its state to drift.
   */
  const [showImport, setShowImport] = useState(false);

  /*
   * Five minutes of nothing signs the client out. This is what makes a 4-digit
   * PIN a fair trade: getting back in is quick, so a session left open on a
   * shared screen does not have to be tolerated for convenience.
   */
  const { secondsLeft, stayActive } = useIdleTimeout({
    minutes: 5,
    warnSeconds: 30,
    onTimeout: () => (onIdleLogout ?? onLogout)(),
  });

  /*
   * Offer a PIN once the client record has loaded, on the device they just
   * signed in on. Decided once per mount rather than watched, so it cannot
   * appear mid-session while someone is reading their portfolio.
   */
  const [pinPromptOpen, setPinPromptOpen] = useState(false);
  const pinPromptDecided = useRef(false);

  const client = snapshot.client;
  const hasData = !!refreshedAt; // first load completed

  useEffect(() => {
    if (pinPromptDecided.current || !client) return;
    pinPromptDecided.current = true;
    const already = hasProfile(clientId);
    const refused = pinPromptSkips(clientId) >= PIN_PROMPT_LIMIT;
    if (!already && !refused) setPinPromptOpen(true);
  }, [client, clientId]);
  /** A reconciled statement is what turns the prompt off and the refresh on. */
  const hasImportedStatement = snapshot.mfSource === 'cas';

  const dashboardData = useMemo(
    () => (hasData ? buildDashboardData(snapshot) : null),
    [hasData, snapshot],
  );
  const portfolioData = useMemo(
    () => (hasData ? PortfolioService.buildPortfolioData(snapshot.holdings) : null),
    [hasData, snapshot.holdings],
  );

  const renderView = () => {
    // Views that fetch their own data don't wait on the client snapshot.
    if (view === 'mutual-funds')
      return (
        <MutualFundsModule
          clientId={clientId}
          holdings={snapshot.holdings}
          holdingsLoading={loading && !hasData}
          onboardingComplete={client?.onboarding_status === 'active'}
          onNavigate={navigate}
        />
      );
    if (view === 'transactions') return <TransactionsPage clientId={clientId} client={client} />;
    if (view === 'documents') return <DocumentsPage clientId={clientId} />;
    if (view === 'notifications') return <NotificationsPage client={client} onNavigate={navigate} />;
    if (view === 'support') return <SupportPage clientId={clientId} />;

    // Snapshot-backed views (need the client record / holdings).
    const snapshotView =
      view === 'dashboard' ||
      view === 'onboarding' ||
      view === 'portfolio' ||
      view === 'allocation' ||
      view === 'reports' ||
      view === 'profile' ||
      view === 'sip';
    if (snapshotView && loading && !hasData) return <LoadingState />;
    if (snapshotView && error) return <ErrorState message={error} onRetry={refresh} />;

    switch (view) {
      case 'dashboard':
        return dashboardData ? (
          <DashboardPage
            client={client}
            data={dashboardData}
            refreshedAt={refreshedAt}
            onNavigate={navigate}
            onActivateProducts={() => setShowActivate(true)}
            onImport={() => setShowImport(true)}
            hasImportedStatement={hasImportedStatement}
            dayChange={snapshot.dayChange}
            historyComplete={snapshot.historyComplete}
            statementFrom={snapshot.casStatementFrom}
          />
        ) : (
          <LoadingState />
        );
      case 'onboarding':
        return (
          <OnboardingWizard
            client={client}
            clientId={clientId}
            onRefresh={refresh}
            onNavigate={navigate}
          />
        );
      case 'portfolio':
        return portfolioData ? (
          <PortfolioPage
            data={portfolioData}
            onImport={() => setShowImport(true)}
            freshness={snapshot.casFreshness}
            hasImportedStatement={hasImportedStatement}
            valuedOn={snapshot.valuedOn}
          />
        ) : (
          <LoadingState />
        );
      case 'allocation':
        return portfolioData ? <AllocationPage data={portfolioData} /> : <LoadingState />;
      case 'reports':
        return <ReportsPage clientId={clientId} client={client} holdings={snapshot.holdings} />;
      case 'profile':
        return (
          <ProfilePage
            client={client}
            clientId={clientId}
            onChangePassword={() => setShowChangePw(true)}
            onActivateProducts={() => setShowActivate(true)}
            onRefresh={refresh}
          />
        );
      case 'sip':
        return <SipPage onNavigate={navigate} />;
      default:
        return null;
    }
  };

  return (
    <>
      <PortalShell
        view={view}
        title={VIEW_TITLES[view]}
        client={client}
        refreshing={loading}
        onNavigate={navigate}
        onRefresh={refresh}
        onChangePassword={() => setShowChangePw(true)}
        onLogout={onLogout}
      >
        {renderView()}
      </PortalShell>

      {showChangePw && (
        <ChangePasswordModal clientId={clientId} onClose={() => setShowChangePw(false)} />
      )}

      {showImport && (
        <ImportPortfolioModal
          onClose={() => setShowImport(false)}
          onImported={refresh}
        />
      )}

      {showActivate && (
        <ActivateProductsModal
          client={client}
          clientId={clientId}
          onClose={() => setShowActivate(false)}
          onDone={refresh}
        />
      )}

      {pinPromptOpen && client && (
        <SetPinPrompt
          clientId={clientId}
          clientName={client.full_name}
          clientEmail={client.email ?? ''}
          onSkip={() => {
            recordPinPromptSkip(clientId);
            setPinPromptOpen(false);
          }}
          onDone={() => {
            silencePinPrompt(clientId);
            setPinPromptOpen(false);
          }}
        />
      )}

      {secondsLeft !== null && (
        <IdleWarning
          secondsLeft={secondsLeft}
          onStay={stayActive}
          onSignOutNow={() => (onIdleLogout ?? onLogout)()}
        />
      )}
    </>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <LogoLoader size={52} />
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-danger" />
      <p className="text-sm text-text-primary">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-token-md border border-border bg-bg-surface px-4 py-2 text-xs font-semibold text-text-primary hover:text-accent"
      >
        Try again
      </button>
    </div>
  );
}
