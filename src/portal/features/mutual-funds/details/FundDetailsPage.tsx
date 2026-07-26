import { ArrowLeft, CalendarClock, TrendingUp, Clock, Lock } from 'lucide-react';
import { fmt, fmtDate } from '../../../../crm/utils';
import { Card } from '../../../components/Card';
import { MockBadge } from '../../../components/StatusPill';
import type { FundScheme, OrderType } from '../../../types/funds';
import { AmcAvatar } from '../components/AmcAvatar';
import { RatingStars } from '../components/RatingStars';
import { RiskBadge } from '../components/RiskBadge';
import { ReturnsRow } from '../components/ReturnsRow';

interface Props {
  scheme: FundScheme;
  onBack: () => void;
  onInvest: (type: OrderType) => void;
  /** When set, ordering is blocked; the CTAs reflect why (see MutualFundsModule). */
  gate?: 'onboarding' | 'coming_soon' | null;
}

export function FundDetailsPage({ scheme, onBack, onInvest, gate }: Props) {
  const facts: Array<{ label: string; value: string }> = [
    { label: 'Category', value: `${scheme.category} · ${scheme.subCategory}` },
    { label: 'Fund Manager', value: scheme.fundManager },
    { label: 'Benchmark', value: scheme.benchmark },
    { label: 'Fund Size (AUM)', value: fmt(scheme.aum * 1e7) },
    { label: 'Expense Ratio', value: `${scheme.expenseRatio.toFixed(2)}%` },
    { label: 'Exit Load', value: scheme.exitLoad },
    { label: 'Min. Lumpsum', value: fmt(scheme.minLumpsum) },
    { label: 'Min. SIP', value: fmt(scheme.minSip) },
  ];

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-accent"
      >
        <ArrowLeft className="h-4 w-4" /> All Funds
      </button>

      {/* Header */}
      <Card accent>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <AmcAvatar amc={scheme.amc} size={48} />
            <div className="min-w-0">
              <h2 className="font-display text-xl font-bold text-text-primary">{scheme.name}</h2>
              <p className="mt-0.5 text-xs text-text-secondary">
                {scheme.amc} · {scheme.plans.join(' / ')} Plan
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <RatingStars rating={scheme.rating} size={14} />
                <RiskBadge risk={scheme.riskLevel} />
              </div>
            </div>
          </div>
          <div className="shrink-0 sm:text-right">
            <p className="text-[10px] uppercase tracking-wide text-text-faint">NAV · {fmtDate(scheme.navDate)}</p>
            <p className="font-display text-2xl font-bold text-text-primary">₹{scheme.nav.toFixed(2)}</p>
          </div>
        </div>
      </Card>

      {/* Returns */}
      <Card>
        <div className="mb-4 flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-bold text-text-primary">Trailing Returns</h3>
          {scheme.isMock && <MockBadge />}
        </div>
        <ReturnsRow returns={scheme.returns} />
        <p className="mt-3 text-[11px] text-text-faint">
          Returns above 1 year are annualised (CAGR). Past performance is not indicative of future results.
        </p>
      </Card>

      {/* Facts */}
      <Card>
        <h3 className="mb-4 text-sm font-bold text-text-primary">Fund Facts</h3>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {facts.map((f) => (
            <div key={f.label} className="flex items-center justify-between gap-3 rounded-token-md bg-bg-surface px-3 py-2.5">
              <dt className="text-xs text-text-secondary">{f.label}</dt>
              <dd className="truncate text-right text-xs font-semibold text-text-primary">{f.value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {/* Sticky-ish invest CTAs */}
      <div className="sticky bottom-4 z-10 flex gap-3 rounded-token-xl border border-border bg-bg-elevated/95 p-3 shadow-token-lg backdrop-blur">
        {gate === 'coming_soon' ? (
          <div className="flex flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-token-md border border-border bg-bg-base py-3 text-sm font-bold text-text-secondary">
            <Clock className="h-4 w-4" /> Investing launches soon
          </div>
        ) : gate === 'onboarding' ? (
          <button
            type="button"
            onClick={() => onInvest('lumpsum')}
            className="flex flex-1 items-center justify-center gap-2 rounded-token-md py-3 text-sm font-bold text-on-accent transition-opacity hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
          >
            <Lock className="h-4 w-4" /> Complete onboarding to invest
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => onInvest('sip')}
              className="flex flex-1 items-center justify-center gap-2 rounded-token-md border border-accent/30 bg-accent/10 py-3 text-sm font-bold text-accent transition-colors hover:bg-accent/15"
            >
              <CalendarClock className="h-4 w-4" /> Start SIP
            </button>
            <button
              type="button"
              onClick={() => onInvest('lumpsum')}
              className="flex-1 rounded-token-md py-3 text-sm font-bold text-on-accent transition-opacity hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
            >
              Invest Lumpsum
            </button>
          </>
        )}
      </div>
    </div>
  );
}
