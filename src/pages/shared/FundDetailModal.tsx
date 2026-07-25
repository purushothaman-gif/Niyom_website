import { useEffect, useState } from 'react';
import { X, RefreshCw, AlertCircle, TrendingUp, Building2, CalendarDays, Wallet } from 'lucide-react';
import { mfSource, type MfDetail } from './mfSource';
import { NavChart } from './NavChart';
import { fmtPct, returnColor, fmtNav, fmtDate, RiskBadge } from './mfFormat';

/**
 * Fund detail dialog for the MF Research page. Fetches on-demand detail
 * (metrics + NAV history) via `mfSource.detail` for any scheme code — a curated
 * fund or a hit from the universe search. Accessible: Esc + backdrop to close,
 * focus moves to the panel.
 */

export interface FundSeed {
  scheme_code: string;
  fund_name: string;
  category?: string | null;
  sub_category?: string | null;
  fund_house?: string | null;
  risk_level?: string | null;
  min_investment?: number | null;
}

type ReturnKey = 'return_ytd' | 'return_6m' | 'return_1y' | 'return_3y' | 'return_5y' | 'return_si';
const RETURN_ROWS: { key: ReturnKey; label: string }[] = [
  { key: 'return_ytd', label: 'YTD' },
  { key: 'return_6m', label: '6M' },
  { key: 'return_1y', label: '1Y' },
  { key: 'return_3y', label: '3Y p.a.' },
  { key: 'return_5y', label: '5Y p.a.' },
  { key: 'return_si', label: 'Since incep. p.a.' },
];

interface FundDetailModalProps {
  seed: FundSeed;
  onClose: () => void;
}

export function FundDetailModal({ seed, onClose }: FundDetailModalProps) {
  const [detail, setDetail] = useState<MfDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    mfSource
      .detail(seed.scheme_code)
      .then((d) => alive && setDetail(d))
      .catch(() => alive && setError('Unable to load this fund right now. Please try again shortly.'))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [seed.scheme_code]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const meta = detail?.meta;
  const metrics = detail?.metrics;
  const fundHouse = meta?.fund_house ?? seed.fund_house ?? null;
  const category = seed.sub_category || meta?.scheme_category || seed.category || '';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${seed.fund_name} details`}
    >
      <div
        className="w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex items-start justify-between gap-3 px-5 sm:px-6 py-4"
          style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border-subtle)' }}
        >
          <div className="min-w-0">
            <h2 className="font-bold text-text-primary leading-snug truncate" style={{ fontFamily: 'var(--font-display)' }}>
              {meta?.scheme_name ?? seed.fund_name}
            </h2>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              {category && <span className="text-xs text-text-muted">{category}</span>}
              {seed.risk_level && <RiskBadge level={seed.risk_level} />}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="press flex-shrink-0 p-1.5 rounded-lg"
            style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)' }}
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-5 sm:px-6 py-5">
          {loading ? (
            <div className="py-16 text-center text-text-muted">
              <RefreshCw className="w-6 h-6 mx-auto mb-3 animate-spin text-accent-soft" /> Loading fund detail…
            </div>
          ) : error ? (
            <div
              className="flex items-center gap-2 rounded-xl px-4 py-3 text-sm"
              style={{ background: 'rgba(var(--danger-soft-rgb),0.12)', color: 'rgb(var(--danger-soft-rgb))', border: '1px solid rgba(var(--danger-soft-rgb),0.3)' }}
            >
              <AlertCircle size={16} /> {error}
            </div>
          ) : metrics ? (
            <>
              {/* Top stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <Stat icon={TrendingUp} label="Current NAV" value={fmtNav(metrics.current_nav)} sub={fmtDate(metrics.nav_date)} />
                <Stat label="52-week high" value={fmtNav(metrics.high_52w)} />
                <Stat label="52-week low" value={fmtNav(metrics.low_52w)} />
                <Stat icon={Wallet} label="Min. investment" value={seed.min_investment ? fmtNav(seed.min_investment) : '—'} />
              </div>

              {/* NAV chart */}
              <div
                className="rounded-2xl p-4 mb-5"
                style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-subtle)' }}
              >
                <NavChart points={detail!.navHistory} />
              </div>

              {/* Returns grid */}
              <h3 className="text-sm font-semibold text-text-secondary mb-2">Returns</h3>
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 mb-5">
                {RETURN_ROWS.map((r) => (
                  <div key={r.key} className="rounded-xl px-2 py-2.5 text-center" style={{ background: 'var(--bg-raised)' }}>
                    <div className="text-[10px] text-text-muted uppercase tracking-wide leading-tight">{r.label}</div>
                    <div className="text-sm font-bold mt-1" style={{ color: returnColor(metrics[r.key]) }}>
                      {fmtPct(metrics[r.key])}
                    </div>
                  </div>
                ))}
              </div>

              {/* Fund facts */}
              <div className="grid sm:grid-cols-2 gap-3">
                <Fact icon={Building2} label="Fund house" value={fundHouse ?? '—'} />
                <Fact icon={CalendarDays} label="Inception" value={fmtDate(meta?.launch_date)} />
                {meta?.scheme_type && <Fact label="Type" value={meta.scheme_type} />}
                {meta?.scheme_category && <Fact label="Category" value={meta.scheme_category} />}
              </div>
            </>
          ) : null}

          <p className="mt-5 text-[11px] text-text-faint leading-relaxed">
            Data sourced from public AMFI NAV history and may be delayed. Past performance is not
            indicative of future returns. Read all scheme documents and consult a qualified advisor
            before investing.
          </p>
        </div>

        {/* Conversion CTA — turn fund research into an onboarding opportunity.
            Sticky so it stays visible while the detail scrolls. */}
        <div
          className="sticky bottom-0 z-10 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-5 sm:px-6 py-4"
          style={{ background: 'var(--bg-elevated)', borderTop: '1px solid var(--border-subtle)' }}
        >
          <p className="text-xs text-text-muted min-w-0 truncate">
            Ready to invest in <span className="font-medium text-text-secondary">{meta?.scheme_name ?? seed.fund_name}</span>?
          </p>
          <button
            onClick={() => window.open('/onboarding', '_blank')}
            className="lift press inline-flex items-center justify-center gap-2 flex-shrink-0 bg-accent-soft hover:bg-accent-soft-deep text-black font-bold px-6 py-3 rounded-xl shadow-md"
          >
            <Wallet size={16} /> Invest Now
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
}: {
  icon?: React.ElementType;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--bg-raised)' }}>
      <div className="flex items-center gap-1 text-[11px] text-text-muted">
        {Icon && <Icon size={12} />} {label}
      </div>
      <div className="text-sm font-bold text-text-primary mt-0.5">{value}</div>
      {sub && <div className="text-[10px] text-text-faint mt-0.5">{sub}</div>}
    </div>
  );
}

function Fact({ icon: Icon, label, value }: { icon?: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      {Icon && <Icon size={15} className="text-text-muted mt-0.5 flex-shrink-0" />}
      <div className="min-w-0">
        <div className="text-[11px] text-text-muted">{label}</div>
        <div className="text-sm text-text-primary font-medium break-words">{value}</div>
      </div>
    </div>
  );
}
