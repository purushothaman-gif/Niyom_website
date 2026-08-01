/**
 * A single curated fund: what it is, what it has done, and how to buy it.
 * -----------------------------------------------------------------------------
 * The performance half comes from the curated catalog (AMFI NAV history). The
 * ordering half comes from BSE, which is a different catalog with different
 * codes — so the invest box has to RESOLVE this fund in the scheme master
 * before it can offer anything, and says plainly when it cannot.
 */
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, CalendarClock, Clock, LineChart, Lock } from 'lucide-react';
import { fmt } from '../../../../crm/utils';
// The public MF Research page already renders NAV history as a hand-rolled SVG
// with range toggles. Same data shape, same look — reused rather than forked.
import { NavChart } from '../../../../pages/shared/NavChart';
import { Card } from '../../../components/Card';
import { SectionHeader } from '../../../components/SectionHeader';
import { LogoLoader } from '../../../../components/LogoLoader';
import { MfCatalogService } from '../../../services/MfCatalogService';
import { BSEService } from '../../../services/BSEService';
import type {
  CatalogFund,
  CatalogFundDetail,
  FundScheme,
  OrderType,
} from '../../../types/funds';
import { AmcAvatar } from '../components/AmcAvatar';
import type { InvestGate } from '../MutualFundsModule';
import { CatalogRiskBadge, fmtNav, fmtRet, retColor, RETURNS_FOOTNOTE } from './catalogBits';
import { ReturnCalculator } from './ReturnCalculator';
import { matchingSchemes, planLabel } from './schemeMatch';
import type { ReturnKey } from './collections';

const RETURN_ROWS: { key: ReturnKey; label: string }[] = [
  { key: '6M', label: '6M' },
  { key: 'YTD', label: 'YTD' },
  { key: '1Y', label: '1Y' },
  { key: '3Y', label: '3Y' },
  { key: '5Y', label: '5Y' },
  { key: 'SI', label: 'Since launch' },
];

interface Props {
  fund: CatalogFund;
  /** Schemes already loaded from the BSE master — searched before asking BSE. */
  schemes: FundScheme[];
  gate: InvestGate;
  onBack: () => void;
  onInvest: (scheme: FundScheme, orderType: OrderType) => void;
}

export function CatalogFundPage({ fund, schemes, gate, onBack, onInvest }: Props) {
  const [detail, setDetail] = useState<CatalogFundDetail | null>(null);
  const [detailError, setDetailError] = useState(false);
  const [detailLoading, setDetailLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setDetailLoading(true);
    setDetailError(false);
    MfCatalogService.detail(fund.amfiCode)
      .then((d) => {
        if (alive) {
          setDetail(d);
          setDetailLoading(false);
        }
      })
      .catch(() => {
        if (alive) {
          setDetailError(true);
          setDetailLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, [fund.amfiCode]);

  const facts: Array<{ label: string; value: string }> = [
    { label: 'Fund house', value: fund.amc },
    { label: 'Category', value: `${fund.category}${fund.subCategory ? ` · ${fund.subCategory}` : ''}` },
    { label: 'Risk', value: fund.risk ? `${fund.risk}` : '—' },
    { label: 'NAV date', value: fund.navDate ? new Date(fund.navDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—' },
    {
      label: 'Launched',
      value: (detail?.launchDate ?? fund.launchDate)
        ? new Date((detail?.launchDate ?? fund.launchDate) as string).toLocaleDateString('en-IN', {
            month: 'short',
            year: 'numeric',
          })
        : '—',
    },
    {
      label: '52-week range',
      value:
        detail?.low52w != null && detail?.high52w != null
          ? `${fmtNav(detail.low52w)} – ${fmtNav(detail.high52w)}`
          : '—',
    },
  ];

  const headline = fund.returns['3Y'] ?? fund.returns['1Y'];
  const headlineLabel = fund.returns['3Y'] !== null ? '3Y annualised' : '1Y return';

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-accent"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <Card accent>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <AmcAvatar amc={fund.amc} size={48} />
                <div className="min-w-0">
                  <h2 className="font-display text-xl font-bold text-text-primary">{fund.name}</h2>
                  <p className="mt-0.5 text-xs text-text-secondary">{fund.amc}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-token-sm border border-border bg-bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary">
                      {fund.category}
                    </span>
                    {fund.subCategory && (
                      <span className="rounded-token-sm border border-border bg-bg-surface px-1.5 py-0.5 text-[10px] font-semibold text-text-secondary">
                        {fund.subCategory}
                      </span>
                    )}
                    <CatalogRiskBadge risk={fund.risk} />
                  </div>
                </div>
              </div>
              <div className="shrink-0 sm:text-right">
                <p className="font-display text-2xl font-bold" style={{ color: retColor(headline) }}>
                  {fmtRet(headline)}
                </p>
                <p className="text-[10px] uppercase tracking-wide text-text-faint">{headlineLabel}</p>
                <p className="mt-2 text-sm font-bold text-text-primary">{fmtNav(fund.nav)}</p>
                <p className="text-[10px] uppercase tracking-wide text-text-faint">NAV</p>
              </div>
            </div>
          </Card>

          <Card>
            <SectionHeader title="NAV history" icon={LineChart} />
            {detailLoading ? (
              <div className="flex h-[200px] items-center justify-center">
                <LogoLoader size={40} />
              </div>
            ) : detailError || !detail || detail.navHistory.length < 2 ? (
              <div className="rounded-token-lg bg-bg-surface p-8 text-center text-sm text-text-muted">
                NAV history isn’t available for this fund right now.
              </div>
            ) : (
              <NavChart points={detail.navHistory} />
            )}
          </Card>

          <Card>
            <SectionHeader title="Trailing returns" />
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              {RETURN_ROWS.map((r) => (
                <div key={r.key} className="rounded-token-md bg-bg-surface px-3 py-2.5">
                  <p className="text-[10px] uppercase tracking-wide text-text-faint">{r.label}</p>
                  <p className="text-sm font-bold" style={{ color: retColor(fund.returns[r.key]) }}>
                    {fmtRet(fund.returns[r.key])}
                  </p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-text-faint">{RETURNS_FOOTNOTE}</p>
          </Card>

          <ReturnCalculator fund={fund} />

          <Card>
            <SectionHeader title="Fund facts" />
            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {facts.map((f) => (
                <div
                  key={f.label}
                  className="flex items-center justify-between gap-3 rounded-token-md bg-bg-surface px-3 py-2.5"
                >
                  <dt className="text-xs text-text-secondary">{f.label}</dt>
                  <dd className="truncate text-right text-xs font-semibold text-text-primary">
                    {f.value}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>

        <aside className="xl:sticky xl:top-4 xl:self-start">
          <InvestBox fund={fund} schemes={schemes} gate={gate} onInvest={onInvest} />
        </aside>
      </div>
    </div>
  );
}

/* -------------------------------- Invest box ------------------------------ */

type Resolution =
  | { state: 'loading' }
  | { state: 'found'; schemes: FundScheme[] }
  | { state: 'none' }
  | { state: 'error' };

/**
 * Find this fund in the BSE scheme master. The page of schemes the module
 * already holds is checked first; only if it misses do we ask BSE for the name,
 * because the master runs to ~28k schemes and we never load it whole.
 */
function useTradableSchemes(fund: CatalogFund, loaded: FundScheme[]): Resolution {
  const local = useMemo(() => matchingSchemes(fund, loaded), [fund, loaded]);
  const [remote, setRemote] = useState<Resolution>({ state: 'loading' });

  useEffect(() => {
    if (local.length > 0) return;
    let alive = true;
    setRemote({ state: 'loading' });
    BSEService.searchSchemes(fund.name)
      .then((hits) => {
        if (!alive) return;
        const matches = matchingSchemes(fund, hits);
        setRemote(matches.length > 0 ? { state: 'found', schemes: matches } : { state: 'none' });
      })
      .catch(() => alive && setRemote({ state: 'error' }));
    return () => {
      alive = false;
    };
  }, [fund, local.length]);

  return local.length > 0 ? { state: 'found', schemes: local } : remote;
}

function InvestBox({
  fund,
  schemes,
  gate,
  onInvest,
}: {
  fund: CatalogFund;
  schemes: FundScheme[];
  gate: InvestGate;
  onInvest: (scheme: FundScheme, orderType: OrderType) => void;
}) {
  const resolution = useTradableSchemes(fund, schemes);
  const [selected, setSelected] = useState<string>('');

  const options = resolution.state === 'found' ? resolution.schemes : [];
  const active = options.find((s) => s.schemeCode === selected) ?? options[0] ?? null;

  return (
    <Card padding="md">
      <p className="text-[10px] uppercase tracking-wide text-text-faint">Invest in</p>
      <p className="mt-0.5 line-clamp-2 text-sm font-bold text-text-primary">{fund.name}</p>

      {fund.minInvestment !== null && (
        <p className="mt-2 text-[11px] text-text-secondary">
          Minimum from {fmt(fund.minInvestment)} · SIP or one-time
        </p>
      )}

      {resolution.state === 'loading' && (
        <div className="mt-5 flex justify-center">
          <LogoLoader size={36} />
        </div>
      )}

      {(resolution.state === 'none' || resolution.state === 'error') && (
        <div className="mt-4 flex items-start gap-2 rounded-token-md border border-border bg-bg-surface p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warning" />
          <p className="text-[11px] leading-relaxed text-text-secondary">
            {resolution.state === 'none'
              ? 'This fund isn’t available to order online yet. Your relationship manager can place it for you.'
              : 'We couldn’t reach the exchange to check this fund. Please try again shortly.'}
          </p>
        </div>
      )}

      {resolution.state === 'found' && active && (
        <>
          {options.length > 1 && (
            <label className="mt-4 block">
              <span className="mb-1.5 block text-[11px] font-semibold text-text-secondary">Plan</span>
              <select
                value={active.schemeCode}
                onChange={(e) => setSelected(e.target.value)}
                className="w-full rounded-token-md border border-border bg-bg-surface px-3 py-2 text-xs font-semibold text-text-primary outline-none focus:border-accent"
              >
                {options.map((s) => (
                  <option key={s.schemeCode} value={s.schemeCode}>
                    {planLabel(s)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {gate === 'coming_soon' ? (
            <div className="mt-4 flex cursor-not-allowed items-center justify-center gap-2 rounded-token-md border border-border bg-bg-base py-3 text-sm font-bold text-text-secondary">
              <Clock className="h-4 w-4" /> Investing launches soon
            </div>
          ) : gate === 'onboarding' ? (
            <button
              type="button"
              onClick={() => onInvest(active, 'lumpsum')}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-token-md py-3 text-sm font-bold text-on-accent transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
            >
              <Lock className="h-4 w-4" /> Complete KYC to invest
            </button>
          ) : (
            <div className="mt-4 space-y-2">
              <button
                type="button"
                onClick={() => onInvest(active, 'sip')}
                className="flex w-full items-center justify-center gap-2 rounded-token-md border border-accent/30 bg-accent/10 py-3 text-sm font-bold text-accent transition-colors hover:bg-accent/15"
              >
                <CalendarClock className="h-4 w-4" /> Start SIP
              </button>
              <button
                type="button"
                onClick={() => onInvest(active, 'lumpsum')}
                className="w-full rounded-token-md py-3 text-sm font-bold text-on-accent transition-opacity hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
              >
                Invest one-time
              </button>
            </div>
          )}

          <p className="mt-3 text-[11px] leading-relaxed text-text-faint">
            Order placed in {active.name}.
          </p>
        </>
      )}
    </Card>
  );
}
