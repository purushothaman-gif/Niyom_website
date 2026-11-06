import { useMemo, useState } from 'react';
import { ChevronRight, Hourglass, Loader2, Plus, ShieldCheck, TrendingUp } from 'lucide-react';
import { PortalButton } from '../../ui/kit';
import { fromClientHoldings } from '../../../../shared/portal/investments/model';
import { InvestmentsBoard } from '../investments/InvestmentsBoard';
import { useInvestmentRows } from '../investments/useInvestmentRows';
import { SipsCard } from '../investments/SipsCard';
import { Card } from '../../components/Card';
import { EmptyState } from '../../components/EmptyState';
import { LogoLoader } from '../../../components/LogoLoader';
import type { PortalView } from '../../layout/navigation';
import { useRtaMf } from '../../hooks/useRtaMf';
import type { MfLaunchState } from './useMfLaunch';
import type { PortalHolding } from '../../types/cas';
import { ExploreHub } from '../explore/ExploreHub';
import { MfWatchlist } from './MfWatchlist';
import { AddExternalFundsCta } from './AddExternalFundsCta';

type MfTab = 'explore' | 'dashboard' | 'sips' | 'watchlist';

interface Props {
  clientId: string;
  state: MfLaunchState;
  onLaunch: () => void;
  onNavigate: (view: PortalView) => void;
  /** The client's holdings — mutual-fund rows feed the Explore "Your investments" card. */
  holdings?: PortalHolding[];
  /** Opens the Smart CAS importer (owned by PortalApp). */
  onImport?: () => void;
}

/** Bonds/shares rails are hidden on the MF Explore tab — this page is funds only. */
const FUNDS_ONLY: ReadonlySet<string> = new Set<PortalView>(['bonds', 'unlisted-shares']);

/**
 * The Mutual Funds home. Funds are transacted on our MF platform, but the
 * client should feel they are inside their own account, not sent off to a
 * third-party site: their real holdings and running SIPs (from the registrar
 * feed) are shown here, and investing is a single in-place action that opens
 * the platform, pre-signed, only at the moment they choose to transact.
 */
export function MfLaunchPage({ clientId, state, onLaunch, onNavigate, holdings = [], onImport }: Props) {
  const [tab, setTab] = useState<MfTab>('explore');
  const mfHoldings = useMemo(() => holdings.filter((h) => h.product_type === 'mutual_fund'), [holdings]);
  const { data, loading } = useRtaMf(clientId);
  // The complete MF book (registrar feed + held-away CAS funds), not just the
  // funds we service — so "all distributors" shows here too, with cost/returns.
  const baseRows = useMemo(() => fromClientHoldings(mfHoldings), [mfHoldings]);
  const { rows, enriching } = useInvestmentRows('client', baseRows);
  const hasData = mfHoldings.length > 0 || !!data?.hasData;
  const busy = state === 'opening';

  // What the primary action is, and whether investing is possible right now.
  const gated = state === 'kyc_incomplete' || state === 'not_mapped' || state === 'not_available' || state === 'demo';
  const statusNote = STATUS_NOTE[state];

  const InvestCta = ({ full = false }: { full?: boolean }) => {
    if (state === 'kyc_incomplete') {
      return (
        <PortalButton variant="primary" onClick={() => onNavigate('onboarding')} full={full}>
          Complete KYC to invest
        </PortalButton>
      );
    }
    if (state === 'not_mapped') {
      return (
        <span className="inline-flex items-center gap-2 rounded-token-md border border-border px-4 py-2 text-xs font-medium text-text-secondary">
          <Hourglass className="h-3.5 w-3.5" /> Investing account being set up
        </span>
      );
    }
    if (state === 'not_available' || state === 'demo') return null;
    return (
      <PortalButton variant="primary" icon={busy ? Loader2 : Plus} onClick={onLaunch} disabled={busy} full={full}>
        {busy ? 'Opening…' : hasData ? 'Invest more' : 'Start investing'}
      </PortalButton>
    );
  };

  const tabs: Array<{ key: MfTab; label: string }> = [
    { key: 'explore', label: 'Explore' },
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'sips', label: 'SIPs' },
    { key: 'watchlist', label: 'Watchlist' },
  ];

  return (
    <div className="space-y-5">
      {/* Groww-style sub-navigation */}
      <div className="-mt-1 flex items-center justify-between gap-3 border-b border-border">
        <nav className="flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`relative px-4 pb-3 pt-1 text-[15px] font-semibold transition-colors ${
                tab === t.key ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {t.label}
              {tab === t.key && <span className="absolute inset-x-2 -bottom-px h-[3px] rounded-full bg-accent" />}
            </button>
          ))}
        </nav>
        <div className="hidden pb-2 sm:block">
          <InvestCta />
        </div>
      </div>

      {statusNote && (
        <p className={`rounded-token-lg border border-border-subtle bg-bg-surface px-4 py-3 text-xs ${statusNote.warn ? 'text-danger' : 'text-text-secondary'}`}>
          {state === 'opening' && <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />}
          {statusNote.text}
          {(state === 'opened' || state === 'blocked' || state === 'error') && (
            <button type="button" onClick={onLaunch} className="ml-1 font-semibold text-accent underline underline-offset-2">
              try again
            </button>
          )}
        </p>
      )}

      {tab === 'explore' ? (
        <ExploreHub
          holdings={mfHoldings}
          xirrPercent={null}
          hidden={FUNDS_ONLY}
          onNavigate={onNavigate}
          onOpenBond={() => onNavigate('bonds')}
          onOpenShare={() => onNavigate('unlisted-shares')}
          fundInvest={<InvestCta full />}
          fundsOnly
        />
      ) : tab === 'watchlist' ? (
        <MfWatchlist fundInvest={<InvestCta full />} onExplore={() => setTab('explore')} />
      ) : tab === 'sips' ? (
        <SipsCard sips={data?.sips ?? []} />
      ) : loading && !data ? (
        <div className="flex min-h-[30vh] items-center justify-center"><LogoLoader size={40} /></div>
      ) : !hasData ? (
        <>
          <Card>
            <div className="flex justify-end px-5 pt-5"><InvestCta /></div>
            <EmptyState
              icon={TrendingUp}
              title="Start your mutual fund journey"
              hint={gated ? 'Your holdings will appear here once you invest.' : 'Invest in handpicked funds and start a SIP — your holdings then appear here, updated daily.'}
            />
          </Card>
          <AddExternalFundsCta onAdd={onImport} />
        </>
      ) : (
        <>
          <InvestmentsBoard
            rows={rows}
            enriching={enriching}
            title="Mutual funds"
            lockedAsset="mutual_fund"
            detailAction={() => (gated ? null : <InvestCta full />)}
          />

          <AddExternalFundsCta onAdd={onImport} />

          {!gated && (
            <button
              type="button"
              onClick={onLaunch}
              disabled={busy}
              className="flex w-full items-center justify-between rounded-token-xl border border-border bg-bg-surface px-4 py-3.5 text-left hover:border-accent/40 disabled:opacity-60"
            >
              <span className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-token-lg bg-accent/10">
                  <Plus className="h-4 w-4 text-accent" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-text-primary">Invest or start a new SIP</span>
                  <span className="block text-[11px] text-text-secondary">Explore funds and transact securely</span>
                </span>
              </span>
              <ChevronRight className="h-4 w-4 text-text-secondary" />
            </button>
          )}
        </>
      )}

      <p className="flex items-center justify-center gap-1.5 pt-1 text-center text-[11px] text-text-faint">
        <ShieldCheck className="h-3 w-3" /> Holdings updated daily from the registrar · Investing is secured and signed in for you
      </p>
    </div>
  );
}

const STATUS_NOTE: Partial<Record<MfLaunchState, { text: string; warn?: boolean }>> = {
  opening: { text: 'Opening your investment account securely…' },
  opened: { text: 'Opened in a new tab.' },
  blocked: { text: 'Your browser blocked the new tab — allow pop-ups, then', warn: true },
  not_mapped: { text: 'Your investing account is being set up — your relationship manager will let you know when it’s ready.' },
  kyc_incomplete: { text: 'Verify your PAN to start investing.', warn: true },
  error: { text: 'We couldn’t open your investing account —', warn: true },
};
