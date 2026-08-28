// Client bond marketplace — a rich card grid (Jiraaf-style) rendered in the
// portal's own tokens. Each card leads to a detail page where the client picks
// units and places an order. Prices are the client's approved, marked-up price
// (indicative); base price / cost / margin never reach here.

import { useMemo, useState } from 'react';
import { Landmark, TrendingUp, ArrowRight, ShieldCheck } from 'lucide-react';
import { inr, inrCompact, pct, shortDate } from '../../../lib/money';
import { Card } from '../../components/Card';
import { StatusPill } from '../../components/StatusPill';
import { MiniStat, Pill, Blank } from '../../ui/kit';
import type { ClientBond } from '../../../../shared/portal/services/BondOrderService';
import { tenureLabel } from './bondMath';

type QuickFilter = 'all' | 'short' | 'high_yield' | 'low_min';

const FILTERS: Array<{ value: QuickFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'short', label: 'Short tenure' },
  { value: 'high_yield', label: 'High yield' },
  { value: 'low_min', label: 'Low minimum' },
];

/** A short marketing tag derived from the bond's own numbers. */
function derivedTag(b: ClientBond): { label: string; tone: 'accent' | 'success' } | null {
  const ytm = b.analytics?.ytm;
  const yrs = b.analytics?.years_to_maturity;
  if (ytm != null && ytm >= 12) return { label: 'High yield', tone: 'success' };
  if (yrs != null && yrs > 0 && yrs < 1) return { label: 'Short tenure', tone: 'accent' };
  const min = (Number(b.min_investment) || Number(b.face_value) || 0);
  if (min > 0 && min <= 100000) return { label: 'Low minimum', tone: 'accent' };
  return null;
}

function freqLabel(f: string | null): string {
  const v = (f || '').toLowerCase().replace(/_/g, '-');
  if (!v) return '—';
  return v.charAt(0).toUpperCase() + v.slice(1);
}

export function BondsListPage({
  bonds,
  onOpen,
}: {
  bonds: ClientBond[];
  onOpen: (bond: ClientBond) => void;
}) {
  const [filter, setFilter] = useState<QuickFilter>('all');

  const shown = useMemo(() => {
    return bonds.filter((b) => {
      const ytm = b.analytics?.ytm;
      const yrs = b.analytics?.years_to_maturity;
      const min = Number(b.min_investment) || Number(b.face_value) || 0;
      switch (filter) {
        case 'short': return yrs != null && yrs > 0 && yrs < 3;
        case 'high_yield': return ytm != null && ytm >= 11;
        case 'low_min': return min > 0 && min <= 200000;
        default: return true;
      }
    });
  }, [bonds, filter]);

  if (bonds.length === 0) {
    return (
      <Card padding="none">
        <Blank
          icon={Landmark}
          title="No bonds available yet"
          body="Fixed-income opportunities curated for you will appear here. Please contact your relationship manager to get started."
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const active = f.value === filter;
            return (
              <button
                key={f.value}
                type="button"
                onClick={() => setFilter(f.value)}
                className={`rounded-token-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-accent/30 bg-selected text-accent'
                    : 'border-border bg-bg-raised text-text-muted hover:text-text-primary'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>
        <p className="text-xs text-text-faint">Prices are indicative, per ₹100 face value.</p>
      </div>

      {shown.length === 0 ? (
        <Card padding="none">
          <Blank icon={Landmark} title="Nothing matches this filter" body="Try a different filter to see more opportunities." />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((b) => {
            const tag = derivedTag(b);
            const min = Number(b.min_investment) || Number(b.face_value) || null;
            return (
              <Card
                key={b.id}
                interactive
                padding="md"
                className="flex cursor-pointer flex-col gap-4"
                // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
              >
                <button type="button" onClick={() => onOpen(b)} className="flex flex-1 flex-col gap-4 text-left">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-token-lg bg-accent/10 font-display text-sm font-bold text-accent">
                        {(b.issuer_name || b.bond_name || '?').trim().charAt(0).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold leading-snug text-text-primary">
                          {b.issuer_name || b.bond_name || b.isin}
                        </p>
                        <p className="truncate text-[11px] text-text-faint">{b.isin}</p>
                      </div>
                    </div>
                    {b.rating && <StatusPill tone="accent">{b.rating}</StatusPill>}
                  </div>

                  {tag && <div><Pill tone={tag.tone}>{tag.label}</Pill></div>}

                  <div className="grid grid-cols-3 gap-2">
                    <MiniStat
                      label="Yield (YTM)"
                      value={b.analytics?.ytm != null ? pct(b.analytics.ytm) : pct(b.coupon_rate ?? 0)}
                      tone="positive"
                    />
                    <MiniStat label="Tenure" value={tenureLabel(b)} />
                    <MiniStat label="Min. Invest" value={min != null ? inrCompact(min) : '—'} />
                  </div>

                  <div className="mt-auto flex items-end justify-between border-t border-border-subtle pt-3">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">Coupon</p>
                      <p className="font-display text-lg font-bold leading-none text-text-primary">{pct(b.coupon_rate ?? 0)}</p>
                      <p className="mt-1 text-[11px] text-text-muted">
                        Interest {freqLabel(b.coupon_frequency)} · Matures {shortDate(b.maturity_date)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">Price / ₹100</p>
                      <p className="font-display text-lg font-extrabold leading-none text-accent">{inr(b.client_price ?? 0)}</p>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => onOpen(b)}
                  className="inline-flex items-center justify-center gap-1.5 rounded-token-md border border-border bg-bg-surface py-2 text-xs font-bold text-text-primary transition-colors hover:border-accent/40 hover:text-accent"
                >
                  View details & invest <ArrowRight className="h-3.5 w-3.5" />
                </button>
              </Card>
            );
          })}
        </div>
      )}

      <p className="flex items-start gap-1.5 pt-1 text-[11px] text-text-faint">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
        <span className="inline-flex items-center gap-1"><TrendingUp className="h-3 w-3" /> Yields and prices are indicative and finalised by your relationship manager on the deal confirmation.</span>
      </p>
    </div>
  );
}
