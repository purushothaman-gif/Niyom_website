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
import { MfLaunchPage } from './features/mutual-funds/MfLaunchPage';
import { ExploreHub, type ExploreScreen } from './features/explore/ExploreHub';
import { WatchlistProvider } from './watchlist/Watchlist';
import { MarketWatchView } from './features/market/MarketWatchView';
import { useMfLaunch } from './features/mutual-funds/useMfLaunch';
import { isFundHeld } from './features/mutual-funds/heldFund';
import { BondsModule } from './features/bonds/BondsModule';
import { SharesModule } from './features/shares/SharesModule';
import { TransactionsPage } from './features/transactions/TransactionsPage';
import { ReportsPage } from './features/reports/ReportsPage';
import { CapitalGainsPage } from './features/gains/CapitalGainsPage';
import { DocumentsPage } from './features/documents/DocumentsPage';
import { ProfilePage } from './features/profile/ProfilePage';
import { SipPage } from './features/sip/SipPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
import { SupportPage } from './features/support/SupportPage';
import { ChangePasswordModal } from './features/profile/ChangePasswordModal';
import { ImportPortfolioModal } from './features/portfolio/ImportPortfolioModal';
import { ConnectDematModal } from './features/portfolio/ConnectDematModal';
import { ImportHubModal } from './features/portfolio/ImportHubModal';
import { DematImportService } from '../../shared/portal/services/DematImportService';
import { InboxService } from '../../shared/portal/services/InboxService';
import { InboundEmailService } from '../../shared/portal/services/InboundEmailService';
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
import { isDemoClientSession } from '../../shared/portal/demo/demoClient';
import { mfSsoEnabled } from '../../shared/platform/env';
import type { PortalView } from './layout/navigation';
import { clientSupabase } from '../lib/supabase';
import { useHiddenProducts } from '../lib/productAccess';

/** In-house MF views that have no place once mutual funds run on the MF platform. */
const MF_PLATFORM_RETIRED_VIEWS: PortalView[] = ['sip', 'capital-gains'];

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
  const { view, navigate: routeTo } = usePortalRouter();
  /*
   * Mutual funds run on the MF platform. Every way into the Mutual Funds view (nav,
   * dashboard card, quick actions, SIP) passes through here, so the click that
   * navigates also opens the MF platform tab — in the same gesture, which is what
   * keeps popup blockers out of the way.
   */
  const mf = useMfLaunch(clientId);
  const mfSsoOn = mfSsoEnabled();
  const productHidden = useHiddenProducts(clientSupabase, 'client');
  /*
   * With mutual funds on the MF platform, our own SIP book and the CAS-based
   * capital gains page retire with the rest of the in-house MF machinery; they
   * ride the same hidden-view path, so links and bookmarks to them land on the
   * dashboard too.
   */
  const hiddenProducts = useMemo(
    () => (mfSsoOn ? new Set([...productHidden, ...MF_PLATFORM_RETIRED_VIEWS]) : productHidden),
    [mfSsoOn, productHidden],
  );
  const navigate = (v: PortalView) => {
    // A switched-off product is unreachable from every entry point, not just the nav.
    if (hiddenProducts.has(v)) return routeTo('dashboard');
    routeTo(v);
  };
  // ...including a bookmarked or back-button URL to it.
  useEffect(() => {
    if (hiddenProducts.has(view)) routeTo('dashboard');
  }, [hiddenProducts, view, routeTo]);
  const { snapshot, loading, error, refreshedAt, refresh } = useClientSnapshot(clientId);
  const [showChangePw, setShowChangePw] = useState(false);
  const [showActivate, setShowActivate] = useState(false);
  /*
   * Owned here rather than by either screen: the dashboard and the portfolio
   * both offer the import, and two components each holding their own copy of
   * the wizard is two places for its state to drift.
   */
  const [showImport, setShowImport] = useState(false);
  /** When the import modal is opened straight on its upload step (hub's "I have
   *  the file"), vs the default request flow. */
  const [importStartAt, setImportStartAt] = useState<'upload' | undefined>(undefined);
  const [showDemat, setShowDemat] = useState(false);
  /*
   * The hub is the single door to every import route. It opens straight away
   * for a client arriving on an invite link (?import=1 — what a partner or RM
   * shares), and the flag is stripped so a refresh does not reopen it.
   */
  // Returning from the email-connect round trip: ConnectInbox left this flag
  // before redirecting, so reopen the hub (and guide them to Sync now) instead
  // of stranding them on the dashboard, which is all the proxy callback links to.
  const [justConnectedInbox] = useState(() => {
    try {
      return sessionStorage.getItem('nw_import_return') === '1';
    } catch {
      return false;
    }
  });
  const [showHub, setShowHub] = useState(() => {
    try {
      return new URLSearchParams(window.location.search).get('import') === '1' || justConnectedInbox;
    } catch {
      return justConnectedInbox;
    }
  });
  useEffect(() => {
    try {
      sessionStorage.removeItem('nw_import_return');
    } catch {
      /* ignore */
    }
    const params = new URLSearchParams(window.location.search);
    if (!params.has('import')) return;
    params.delete('import');
    const qs = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${qs ? `?${qs}` : ''}`);
  }, []);
  // Whether the server can fetch demat holdings; the entry point is hidden
  // until we know it can, so a client is never offered something that errors.
  const [dematEnabled, setDematEnabled] = useState(false);
  // The two email import routes probe the same way. Resolving all three up front
  // (not inside the import hub) means the hub opens at its final size instead of
  // growing as each self-checking card pops in a second later.
  const [inboxEnabled, setInboxEnabled] = useState(false);
  const [forwardEnabled, setForwardEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    void DematImportService.enabled().then((e) => alive && setDematEnabled(e));
    void InboxService.enabled().then((e) => alive && setInboxEnabled(e));
    void InboundEmailService.enabled().then((e) => alive && setForwardEnabled(e));
    return () => {
      alive = false;
    };
  }, []);
  /** A bond/share picked on Explore, opened straight to its detail page. */
  const [openBondId, setOpenBondId] = useState<string | null>(null);
  const [openShareId, setOpenShareId] = useState<string | null>(null);
  /** A fund/collection picked on the dashboard rails, opened on Explore. */
  const [exploreScreen, setExploreScreen] = useState<ExploreScreen | null>(null);
  // Used once on arrival; leaving Explore forgets it so the nav opens Explore home.
  useEffect(() => {
    if (view !== 'explore') setExploreScreen(null);
  }, [view]);

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
  // The client's depository, inferred from the demat account on file, so the
  // import hub can skip the "which depository?" step: CDSL ids are 16 digits,
  // NSDL ids begin "IN". Null when there's no (or an unrecognised) account.
  const depositoryHint: 'cdsl' | 'nsdl' | null = (() => {
    const acct = (client?.demat_account ?? '').replace(/\s/g, '');
    if (/^\d{16}$/.test(acct)) return 'cdsl';
    if (/^IN/i.test(acct)) return 'nsdl';
    return null;
  })();
  const hasData = !!refreshedAt; // first load completed

  useEffect(() => {
    if (pinPromptDecided.current || !client) return;
    pinPromptDecided.current = true;
    // Never in the sample portal: the credentials are handed to prospects, and
    // enrolling a device PIN against a client that does not exist would call
    // client-pin-set and fail in their face. Matches PartnerApp.
    if (isDemoClientSession()) return;
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

  const fundInvestButton = (fund: { name: string }) => (
            <button
              type="button"
              onClick={() =>
                !mfSsoOn
                  ? navigate('mutual-funds')
                  : mf.state === 'kyc_incomplete'
                    ? navigate('onboarding')
                    : mf.launch()
              }
              disabled={mf.state === 'opening'}
              className="w-full rounded-token-md py-3 text-sm font-bold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-60"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
            >
              {mfSsoOn && mf.state === 'kyc_incomplete'
                ? 'Complete KYC to invest'
                : mf.state === 'opening'
                  ? 'Opening…'
                  : isFundHeld(fund.name, snapshot.holdings)
                    ? 'Invest more'
                    : 'Invest now'}
            </button>
  );

  const renderView = () => {
    // Views that fetch their own data don't wait on the client snapshot.
    if (view === 'mutual-funds' && mfSsoOn)
      return (
        <MfLaunchPage
          clientId={clientId}
          state={mf.state}
          onLaunch={mf.launch}
          onNavigate={navigate}
          holdings={snapshot.holdings}
          onImport={() => setShowImport(true)}
        />
      );
    if (view === 'explore')
      return (
        <ExploreHub
          holdings={snapshot.holdings}
          xirrPercent={dashboardData?.xirrPercent ?? null}
          xirrCoveragePct={dashboardData?.xirrCoveragePct ?? null}
          xirrNote={dashboardData?.xirrNote ?? null}
          hidden={hiddenProducts}
          onNavigate={navigate}
          onOpenBond={(id) => {
            setOpenBondId(id);
            navigate('bonds');
          }}
          onOpenShare={(id) => {
            setOpenShareId(id);
            navigate('unlisted-shares');
          }}
          fundInvest={fundInvestButton}
          initialScreen={exploreScreen}
        />
      );
    if (view === 'mutual-funds')
      return (
        <MutualFundsModule
          clientId={clientId}
          holdings={snapshot.holdings}
          holdingsLoading={loading && !hasData}
          onboardingComplete={client?.onboarding_status === 'active'}
          onNavigate={navigate}
          onImport={() => setShowImport(true)}
        />
      );
    if (view === 'bonds')
      return (
        <BondsModule
          clientId={clientId}
          onboardingComplete={client?.onboarding_status === 'active'}
          holdings={snapshot.holdings}
          initialBondId={openBondId}
          onInitialConsumed={() => setOpenBondId(null)}
        />
      );
    if (view === 'unlisted-shares')
      return (
        <SharesModule
          clientId={clientId}
          onboardingComplete={client?.onboarding_status === 'active'}
          holdings={snapshot.holdings}
          initialShareId={openShareId}
          onInitialConsumed={() => setOpenShareId(null)}
        />
      );
    if (view === 'transactions') return <TransactionsPage clientId={clientId} client={client} />;
    if (view === 'documents') return <DocumentsPage clientId={clientId} />;
    if (view === 'notifications') return <NotificationsPage client={client} onNavigate={navigate} />;
    if (view === 'support') return <SupportPage clientId={clientId} />;
    if (view === 'market-watch') return <MarketWatchView surface="client" />;

    // Snapshot-backed views (need the client record / holdings).
    const snapshotView =
      view === 'dashboard' ||
      view === 'onboarding' ||
      view === 'portfolio' ||
      view === 'allocation' ||
      view === 'reports' ||
      view === 'capital-gains' ||
      view === 'profile' ||
      view === 'sip';
    if (snapshotView && loading && !hasData) return <LoadingState />;
    if (snapshotView && error) return <ErrorState message={error} onRetry={refresh} />;

    switch (view) {
      case 'dashboard':
        return dashboardData ? (
          <DashboardPage
            explore={
              <ExploreHub
                embedded
                holdings={snapshot.holdings}
                xirrPercent={dashboardData?.xirrPercent ?? null}
          xirrCoveragePct={dashboardData?.xirrCoveragePct ?? null}
          xirrNote={dashboardData?.xirrNote ?? null}
                hidden={hiddenProducts}
                onNavigate={navigate}
                onOpenBond={(id) => {
                  setOpenBondId(id);
                  navigate('bonds');
                }}
                onOpenShare={(id) => {
                  setOpenShareId(id);
                  navigate('unlisted-shares');
                }}
                onOpenScreen={(sc) => {
                  setExploreScreen(sc);
                  navigate('explore');
                }}
                fundInvest={fundInvestButton}
              />
            }
            clientId={clientId}
            client={client}
            data={dashboardData}
            holdings={snapshot.holdings}
            refreshedAt={refreshedAt}
            onNavigate={navigate}
            onActivateProducts={() => setShowActivate(true)}
            onImport={() => setShowImport(true)}
            onOpenImportHub={() => setShowHub(true)}
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
            clientId={clientId}
            client={client}
            data={portfolioData}
            holdings={snapshot.holdings}
            xirrPercent={dashboardData?.xirrPercent ?? null}
          xirrCoveragePct={dashboardData?.xirrCoveragePct ?? null}
          xirrNote={dashboardData?.xirrNote ?? null}
            onNavigate={navigate}
            onImport={() => setShowImport(true)}
            onOpenImportHub={() => setShowHub(true)}
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
        return (
          <ReportsPage
            clientId={clientId}
            client={client}
            holdings={snapshot.holdings}
            onOpenCapitalGains={() => navigate('capital-gains')}
          />
        );
      case 'capital-gains':
        return (
          <CapitalGainsPage
            clientId={clientId}
            client={client}
            // Opens the import flow here rather than bouncing to My Portfolio
            // and leaving the client to find the button again.
            onImport={() => setShowImport(true)}
          />
        );
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
      <WatchlistProvider surface="client" demo={isDemoClientSession()}>
      <PortalShell
        view={view}
        title={VIEW_TITLES[view]}
        client={client}
        refreshing={loading}
        onNavigate={navigate}
        onRefresh={refresh}
        onChangePassword={() => setShowChangePw(true)}
        onLogout={onLogout}
        onOpenSmartCas={() => setShowImport(true)}
        onOpenImportHub={() => setShowHub(true)}
        hiddenProducts={hiddenProducts}
      >
        {renderView()}
      </PortalShell>
      </WatchlistProvider>

      {showChangePw && (
        <ChangePasswordModal clientId={clientId} onClose={() => setShowChangePw(false)} />
      )}

      {showHub && (
        <ImportHubModal
          onClose={() => setShowHub(false)}
          onMutualFunds={() => {
            setShowHub(false);
            setImportStartAt(undefined);
            setShowImport(true);
          }}
          onUpload={() => {
            setShowHub(false);
            setImportStartAt('upload');
            setShowImport(true);
          }}
          onDemat={
            dematEnabled
              ? () => {
                  setShowHub(false);
                  setShowDemat(true);
                }
              : undefined
          }
          depositoryHint={depositoryHint}
          inboxEnabled={inboxEnabled}
          forwardEnabled={forwardEnabled}
          justConnectedInbox={justConnectedInbox}
          onImported={refresh}
        />
      )}

      {showImport && (
        <ImportPortfolioModal
          onClose={() => {
            setShowImport(false);
            setImportStartAt(undefined);
          }}
          startAt={importStartAt}
          pan={client?.pan ?? undefined}
          onImported={refresh}
        />
      )}

      {showDemat && (
        <ConnectDematModal onClose={() => setShowDemat(false)} onImported={refresh} />
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
