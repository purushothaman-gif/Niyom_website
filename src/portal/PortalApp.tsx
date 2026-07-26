import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
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

interface PortalAppProps {
  clientId: string;
  onLogout: () => void;
}

/**
 * Wealth Portal root. Fetches one client snapshot and derives every view's
 * model from it, so navigation between Dashboard / Portfolio / Allocation never
 * re-queries. Owns internal routing; leaves the host router in App.tsx untouched.
 */
export default function PortalApp({ clientId, onLogout }: PortalAppProps) {
  const { view, navigate } = usePortalRouter();
  const { snapshot, loading, error, refreshedAt, refresh } = useClientSnapshot(clientId);
  const [showChangePw, setShowChangePw] = useState(false);
  const [showActivate, setShowActivate] = useState(false);

  const client = snapshot.client;
  const hasData = !!refreshedAt; // first load completed

  const dashboardData = useMemo(
    () => (hasData ? buildDashboardData(snapshot, clientId) : null),
    [hasData, snapshot, clientId],
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
    if (view === 'notifications') return <NotificationsPage clientId={clientId} />;
    if (view === 'support') return <SupportPage />;

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
        return portfolioData ? <PortfolioPage data={portfolioData} /> : <LoadingState />;
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
          />
        );
      case 'sip':
        return <SipPage clientId={clientId} holdings={snapshot.holdings} onNavigate={navigate} />;
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

      {showActivate && (
        <ActivateProductsModal
          client={client}
          clientId={clientId}
          onClose={() => setShowActivate(false)}
          onDone={refresh}
        />
      )}
    </>
  );
}

function LoadingState() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div
        className="h-8 w-8 animate-spin rounded-full border-2 border-t-transparent"
        style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }}
      />
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
