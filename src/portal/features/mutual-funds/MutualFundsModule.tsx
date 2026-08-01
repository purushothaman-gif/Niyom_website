import { useMemo, useState } from 'react';
import { AlertTriangle, Clock, Lock, ArrowRight } from 'lucide-react';
import type { NWHolding } from '../../../crm/types';
import { LogoLoader } from '../../../components/LogoLoader';
import type { PortalView } from '../../layout/navigation';
import { Card } from '../../components/Card';
import { Segmented } from '../../components/Segmented';
import { useFundCatalog } from '../../hooks/useFundCatalog';
import { useMfCatalog } from '../../hooks/useMfCatalog';
import { BSEService } from '../../services/BSEService';
import { useBseAccount } from './useBseAccount';
import type { FundScheme, OrderType } from '../../types/funds';
import { FundDiscoveryPage } from './discovery/FundDiscoveryPage';
import { FundDetailsPage } from './details/FundDetailsPage';
import { CatalogFundPage } from './explore/CatalogFundPage';
import { CollectionPage } from './explore/CollectionPage';
import { ExploreHome } from './explore/ExploreHome';
import { collectionById } from './explore/collections';
import { InvestFlow } from './invest/InvestFlow';
import { MyFundsPage } from './holdings/MyFundsPage';
import { RedeemFlow } from './redeem/RedeemFlow';
import { SwitchFlow } from './switch/SwitchFlow';
import { mapMfHoldings } from './mappers';

interface Props {
  clientId: string;
  /** Client's holdings (mutual-fund rows are used for My Funds / Redeem / Switch). */
  holdings: NWHolding[];
  holdingsLoading: boolean;
  /** True once KYC is verified (onboarding_status === 'active'). Gates ordering. */
  onboardingComplete: boolean;
  /** Portal navigation — used to send un-onboarded clients to the KYC wizard. */
  onNavigate: (view: PortalView) => void;
}

/**
 * Why a client cannot place an order right now:
 *   - 'onboarding'  — KYC not yet verified → finish onboarding first.
 *   - 'coming_soon' — onboarded, but live BSE ordering isn't enabled yet
 *                     (BSEService.isMock). We block rather than let clients place
 *                     simulated orders they might mistake for real ones.
 */
/**
 * Why a client cannot order, most fundamental first. null means they can.
 * Layered deliberately: KYC, then registered at BSE, then BSE's own checks —
 * so the message names the actual obstacle rather than a generic refusal.
 */
export type InvestGate =
  | 'onboarding'
  | 'coming_soon'
  | 'checking'
  | 'bse_not_registered'
  | 'bse_pending'
  | 'bse_unavailable'
  | null;

type Tab = 'explore' | 'all-funds' | 'my-funds';

type Screen =
  | { name: 'list' }
  /** A curated collection ("Small cap", "Tax saver"). */
  | { name: 'collection'; id: string }
  /** A curated fund, keyed by AMFI code — the research view. */
  | { name: 'fund'; amfiCode: string }
  /** A raw BSE scheme, keyed by BSE code — reached from All schemes. */
  | { name: 'details'; schemeCode: string }
  /*
   * Carries the scheme itself, not just its code: a fund resolved from the
   * curated catalog is looked up in BSE's master on demand and need not be in
   * the page of schemes this module loaded. `back` is where the flow returns to,
   * which differs by where the order started.
   */
  | { name: 'invest'; scheme: FundScheme; orderType: OrderType; back: Screen }
  | { name: 'redeem'; holdingId: string }
  | { name: 'switch'; holdingId: string };

/**
 * Self-contained Mutual Fund module. Owns the tab bar (Explore | All schemes |
 * My Funds) and a screen machine over two catalogs:
 *
 *   - the CURATED catalog (`useMfCatalog`) — real returns and NAVs from AMFI,
 *     which is what Explore, collections and the fund page are built on;
 *   - the BSE scheme master (`useFundCatalog`) — the order rail, which carries
 *     no performance data at all and is only used to place and list trades.
 *
 * They fail independently on purpose: BSE being unreachable costs the ordering
 * path, not the ability to research a fund.
 */
export function MutualFundsModule({
  clientId,
  holdings,
  holdingsLoading,
  onboardingComplete,
  onNavigate,
}: Props) {
  const { schemes, facets, loading, error } = useFundCatalog();
  const catalog = useMfCatalog();
  const [tab, setTab] = useState<Tab>('explore');
  const [screen, setScreen] = useState<Screen>({ name: 'list' });

  // Ordering is gated: finish KYC first, and until live BSE is enabled we block
  // (rather than allow simulated orders). `investGate` is null only when a client
  // is fully onboarded AND real ordering is live.
  // The client's BSE account — only worth asking once they are past KYC and we
  // are actually talking to BSE.
  const live = !BSEService.isMock();
  const bse = useBseAccount(onboardingComplete && live);

  // Ordering is gated in layers, most fundamental first: finish KYC, then be
  // registered at BSE, then have BSE's checks pass. `investGate` is null only
  // when a client can genuinely place an order that will be accepted.
  const investGate: InvestGate = !onboardingComplete
    ? 'onboarding'
    : !live
      ? 'coming_soon'
      : bse.loading
        ? 'checking'
        : bse.state?.status === 'ready'
          ? null
          : bse.state?.status === 'pending'
            ? 'bse_pending'
            : bse.state?.status === 'not_registered'
              ? 'bse_not_registered'
              : 'bse_unavailable';
  const [gatePrompt, setGatePrompt] = useState<InvestGate>(null);
  /** Run an order action only when allowed; otherwise surface the gate. */
  const guardOrder = (proceed: () => void) => {
    if (investGate) setGatePrompt(investGate);
    else proceed();
  };

  const mfHoldings = useMemo(() => mapMfHoldings(holdings, schemes), [holdings, schemes]);
  const schemeOf = (code: string) => schemes.find((s) => s.schemeCode === code) ?? null;
  const holdingOf = (id: string) => mfHoldings.find((h) => h.id === id) ?? null;
  const fundOf = (amfiCode: string) =>
    catalog.funds.find((f) => f.amfiCode === amfiCode) ?? null;

  const goList = () => setScreen({ name: 'list' });

  // The curated catalog is what the landing screen is made of, so it is the one
  // worth waiting for. The BSE master loads alongside and is only awaited by the
  // screens that trade.
  if (catalog.loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <LogoLoader size={52} />
      </div>
    );
  }

  if (catalog.error) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-danger" />
        <p className="text-sm text-text-primary">{catalog.error}</p>
        <button
          type="button"
          onClick={catalog.reload}
          className="mt-4 rounded-token-md border border-border bg-bg-surface px-4 py-2 text-xs font-semibold text-text-primary hover:text-accent"
        >
          Try again
        </button>
      </div>
    );
  }

  // --- Detail / flow screens take over the whole view ---------------------

  if (screen.name === 'collection') {
    const collection = collectionById(screen.id);
    if (collection) {
      return (
        <CollectionPage
          collection={collection}
          funds={catalog.funds}
          onBack={goList}
          onOpenFund={(amfiCode) => setScreen({ name: 'fund', amfiCode })}
        />
      );
    }
  }

  if (screen.name === 'fund') {
    const fund = fundOf(screen.amfiCode);
    if (fund) {
      return (
        <CatalogFundPage
          fund={fund}
          schemes={schemes}
          gate={investGate}
          onBack={goList}
          onInvest={(scheme, orderType) =>
            guardOrder(() =>
              setScreen({ name: 'invest', scheme, orderType, back: { name: 'fund', amfiCode: fund.amfiCode } }),
            )
          }
        />
      );
    }
  }

  if (screen.name === 'details') {
    const scheme = schemeOf(screen.schemeCode);
    if (scheme) {
      return (
        <FundDetailsPage
          scheme={scheme}
          onBack={goList}
          gate={investGate}
          onInvest={(orderType) =>
            guardOrder(() =>
              setScreen({
                name: 'invest',
                scheme,
                orderType,
                back: { name: 'details', schemeCode: scheme.schemeCode },
              }),
            )
          }
        />
      );
    }
  }

  if (screen.name === 'invest') {
    const { scheme, back } = screen;
    return (
      <InvestFlow
        scheme={scheme}
        clientId={clientId}
        initialType={screen.orderType}
        onBack={() => setScreen(back)}
        onDone={goList}
      />
    );
  }

  if (screen.name === 'redeem') {
    const holding = holdingOf(screen.holdingId);
    if (holding) {
      return <RedeemFlow holding={holding} clientId={clientId} onBack={goList} onDone={goList} />;
    }
  }

  if (screen.name === 'switch') {
    const holding = holdingOf(screen.holdingId);
    if (holding) {
      return (
        <SwitchFlow
          holding={holding}
          schemes={schemes}
          clientId={clientId}
          onBack={goList}
          onDone={goList}
        />
      );
    }
  }

  // --- List view: Explore / All schemes / My Funds tabs -------------------

  return (
    <div className="space-y-5">
      {investGate && (
        <InvestGateBanner gate={investGate} onAction={() => onNavigate('onboarding')} />
      )}

      <Segmented<Tab>
        options={[
          { value: 'explore', label: 'Explore' },
          { value: 'all-funds', label: 'All schemes' },
          { value: 'my-funds', label: 'My Funds', count: mfHoldings.length || undefined },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'explore' ? (
        <ExploreHome
          funds={catalog.funds}
          recommendations={catalog.recommendations}
          holdings={mfHoldings}
          onOpenFund={(amfiCode) => setScreen({ name: 'fund', amfiCode })}
          onOpenCollection={(id) => setScreen({ name: 'collection', id })}
          onAllFunds={() => setTab('all-funds')}
          onNavigate={onNavigate}
        />
      ) : tab === 'all-funds' ? (
        loading ? (
          <div className="flex min-h-[40vh] items-center justify-center">
            <LogoLoader size={48} />
          </div>
        ) : error ? (
          /* Only the ordering rail is down. Explore and My Funds still work,
             so this is a section-level message, not a page-level one. */
          <Card>
            <div className="py-8 text-center">
              <AlertTriangle className="mx-auto mb-3 h-7 w-7 text-danger" />
              <p className="text-sm text-text-primary">{error}</p>
              <p className="mt-1 text-xs text-text-secondary">
                Fund research on the Explore tab is unaffected.
              </p>
            </div>
          </Card>
        ) : (
          <FundDiscoveryPage
            schemes={schemes}
            facets={facets}
            onOpenFund={(schemeCode) => setScreen({ name: 'details', schemeCode })}
            onInvest={(schemeCode) => {
              const scheme = schemeOf(schemeCode);
              if (scheme)
                guardOrder(() =>
                  setScreen({
                    name: 'invest',
                    scheme,
                    orderType: 'lumpsum',
                    back: { name: 'list' },
                  }),
                );
            }}
          />
        )
      ) : (
        <MyFundsPage
          holdings={mfHoldings}
          loading={holdingsLoading}
          onRedeem={(holdingId) => guardOrder(() => setScreen({ name: 'redeem', holdingId }))}
          onSwitch={(holdingId) => guardOrder(() => setScreen({ name: 'switch', holdingId }))}
          onExplore={() => setTab('explore')}
        />
      )}

      {gatePrompt && (
        <InvestGateModal
          gate={gatePrompt}
          onClose={() => setGatePrompt(null)}
          onGoOnboarding={() => {
            setGatePrompt(null);
            onNavigate('onboarding');
          }}
        />
      )}
    </div>
  );
}

// --- Ordering gate UI --------------------------------------------------------

const GATE_COPY: Record<Exclude<InvestGate, null>, { title: string; body: string }> = {
  onboarding: {
    title: 'Complete your onboarding to invest',
    body: 'Finish your KYC verification to start placing mutual fund orders. It only takes a few minutes.',
  },
  coming_soon: {
    title: 'Investing launches soon',
    body: 'Mutual fund ordering isn’t live yet — you can explore funds now, and we’ll enable orders shortly. No orders can be placed at the moment.',
  },
  checking: {
    title: 'Checking your investment account',
    body: 'One moment while we confirm your account with the exchange.',
  },
  bse_not_registered: {
    title: 'Your investment account is being set up',
    body: 'Before you can invest, we register you with the exchange. Your relationship manager is on it — you’ll be notified as soon as it’s ready.',
  },
  bse_pending: {
    title: 'Almost there — a step is pending',
    body: 'Your exchange account is registered but not yet cleared to transact. Approving the link we sent you is usually what’s outstanding.',
  },
  bse_unavailable: {
    title: 'We can’t reach the exchange right now',
    body: 'This is on our side, not yours. Please try again shortly — nothing about your account has changed.',
  },
};

function InvestGateBanner({ gate, onAction }: { gate: Exclude<InvestGate, null>; onAction: () => void }) {
  const isOnboarding = gate === 'onboarding';
  const Icon = isOnboarding ? Lock : Clock;
  return (
    <div className="flex items-center gap-3 rounded-token-xl border border-accent/25 bg-accent/5 px-4 py-3">
      <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-token-lg bg-accent/10">
        <Icon className="h-4 w-4 text-accent" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-text-primary">{GATE_COPY[gate].title}</p>
        <p className="mt-0.5 text-xs text-text-secondary">{GATE_COPY[gate].body}</p>
      </div>
      {isOnboarding && (
        <button
          type="button"
          onClick={onAction}
          className="flex flex-shrink-0 items-center gap-1 rounded-token-md bg-accent px-3 py-2 text-xs font-bold text-on-accent transition-opacity hover:opacity-90"
        >
          Continue <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

function InvestGateModal({
  gate,
  onClose,
  onGoOnboarding,
}: {
  gate: Exclude<InvestGate, null>;
  onClose: () => void;
  onGoOnboarding: () => void;
}) {
  const isOnboarding = gate === 'onboarding';
  const Icon = isOnboarding ? Lock : Clock;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-token-xl border border-border bg-bg-elevated p-6 text-center shadow-token-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
          <Icon className="h-6 w-6 text-accent" />
        </span>
        <h3 className="text-base font-bold text-text-primary">{GATE_COPY[gate].title}</h3>
        <p className="mt-2 text-sm text-text-secondary">{GATE_COPY[gate].body}</p>
        <div className="mt-5 flex justify-center gap-3">
          {isOnboarding ? (
            <>
              <button
                type="button"
                onClick={onClose}
                className="rounded-token-md border border-border px-4 py-2 text-sm font-semibold text-text-secondary transition-colors hover:bg-bg-base"
              >
                Later
              </button>
              <button
                type="button"
                onClick={onGoOnboarding}
                className="rounded-token-md bg-accent px-4 py-2 text-sm font-bold text-on-accent transition-opacity hover:opacity-90"
              >
                Complete onboarding
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="rounded-token-md bg-accent px-5 py-2 text-sm font-bold text-on-accent transition-opacity hover:opacity-90"
            >
              Got it
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
