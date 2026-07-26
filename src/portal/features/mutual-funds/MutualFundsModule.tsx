import { useMemo, useState } from 'react';
import { AlertTriangle, Clock, Lock, ArrowRight } from 'lucide-react';
import type { NWHolding } from '../../../crm/types';
import { LogoLoader } from '../../../components/LogoLoader';
import type { PortalView } from '../../layout/navigation';
import { Segmented } from '../../components/Segmented';
import { useFundCatalog } from '../../hooks/useFundCatalog';
import { BSEService } from '../../services/BSEService';
import type { OrderType } from '../../types/funds';
import { FundDiscoveryPage } from './discovery/FundDiscoveryPage';
import { FundDetailsPage } from './details/FundDetailsPage';
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
type InvestGate = 'onboarding' | 'coming_soon' | null;

type Tab = 'explore' | 'my-funds';

type Screen =
  | { name: 'list' }
  | { name: 'details'; schemeCode: string }
  | { name: 'invest'; schemeCode: string; orderType: OrderType }
  | { name: 'redeem'; holdingId: string }
  | { name: 'switch'; holdingId: string };

/**
 * Self-contained Mutual Fund module. Owns an Explore | My Funds tab and a screen
 * machine (list → details → invest, and holdings → redeem / switch). Loads the
 * BSE scheme master once; the portal's outer router only knows `mutual-funds`.
 */
export function MutualFundsModule({
  clientId,
  holdings,
  holdingsLoading,
  onboardingComplete,
  onNavigate,
}: Props) {
  const { schemes, facets, loading, error } = useFundCatalog();
  const [tab, setTab] = useState<Tab>('explore');
  const [screen, setScreen] = useState<Screen>({ name: 'list' });

  // Ordering is gated: finish KYC first, and until live BSE is enabled we block
  // (rather than allow simulated orders). `investGate` is null only when a client
  // is fully onboarded AND real ordering is live.
  const investGate: InvestGate = !onboardingComplete
    ? 'onboarding'
    : BSEService.isMock()
      ? 'coming_soon'
      : null;
  const [gatePrompt, setGatePrompt] = useState<InvestGate>(null);
  /** Run an order action only when allowed; otherwise surface the gate. */
  const guardOrder = (proceed: () => void) => {
    if (investGate) setGatePrompt(investGate);
    else proceed();
  };

  const mfHoldings = useMemo(() => mapMfHoldings(holdings, schemes), [holdings, schemes]);
  const schemeOf = (code: string) => schemes.find((s) => s.schemeCode === code) ?? null;
  const holdingOf = (id: string) => mfHoldings.find((h) => h.id === id) ?? null;

  const goList = () => setScreen({ name: 'list' });

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <LogoLoader size={52} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-danger" />
        <p className="text-sm text-text-primary">{error}</p>
      </div>
    );
  }

  // --- Detail / flow screens take over the whole view ---------------------

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
              setScreen({ name: 'invest', schemeCode: scheme.schemeCode, orderType }),
            )
          }
        />
      );
    }
  }

  if (screen.name === 'invest') {
    const scheme = schemeOf(screen.schemeCode);
    if (scheme) {
      return (
        <InvestFlow
          scheme={scheme}
          clientId={clientId}
          initialType={screen.orderType}
          onBack={() => setScreen({ name: 'details', schemeCode: scheme.schemeCode })}
          onDone={goList}
        />
      );
    }
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

  // --- List view: Explore / My Funds tabs ---------------------------------

  return (
    <div className="space-y-5">
      {investGate && (
        <InvestGateBanner gate={investGate} onAction={() => onNavigate('onboarding')} />
      )}

      <Segmented<Tab>
        options={[
          { value: 'explore', label: 'Explore' },
          { value: 'my-funds', label: 'My Funds', count: mfHoldings.length || undefined },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'explore' ? (
        <FundDiscoveryPage
          schemes={schemes}
          facets={facets}
          onOpenFund={(schemeCode) => setScreen({ name: 'details', schemeCode })}
          onInvest={(schemeCode) =>
            guardOrder(() => setScreen({ name: 'invest', schemeCode, orderType: 'lumpsum' }))
          }
        />
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
