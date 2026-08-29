// Client bond marketplace — a rich card grid (Jiraaf-style) rendered in the
// portal's own tokens. Each card leads to a detail page where the client picks
// units and places an order. Prices are the client's approved, marked-up price
// (indicative); base price / cost / margin never reach here.

import { useMemo, useState } from 'react';
import { Landmark, TrendingUp, ArrowRight, ShieldCheck, SlidersHorizontal, X, Search } from 'lucide-react';
import { bondMatchesQuery } from '../../../../shared/portal/bonds/bondSearch';
import { inr, inrCompact, pct, shortDate } from '../../../lib/money';
import { Card } from '../../components/Card';
import { StatusPill } from '../../components/StatusPill';
import { MiniStat, Pill, Blank } from '../../ui/kit';
import type { ClientBond } from '../../../../shared/portal/services/BondOrderService';
import { tenureLabel } from './bondMath';
import { BondFilterModal } from './BondFilterModal';
import {
  EMPTY_FILTERS, countFilters, matchesFilters, filterChips, removeFilter,
  type BondFilters,
} from '../../../../shared/portal/bonds/bondFilters';

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
  const [filters, setFilters] = useState<BondFilters>(EMPTY_FILTERS);
  const [showFilter, setShowFilter] = useState(false);
  const [query, setQuery] = useState('');

  const shown = useMemo(
    () => bonds.filter((b) => bondMatchesQuery(b, query) && matchesFilters(b, filters)),
    [bonds, filters, query],
  );
  const activeCount = countFilters(filters);
  const chips = filterChips(filters);

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
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by ISIN, name, issuer or rating"
            className="w-full rounded-token-md border border-border bg-bg-raised py-2 pl-9 pr-8 text-sm text-text-primary outline-none focus:border-accent/50"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-faint hover:text-text-primary">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowFilter(true)}
          className="inline-flex shrink-0 items-center gap-2 rounded-token-md border border-border bg-bg-raised px-3.5 py-2 text-xs font-semibold text-text-primary transition-colors hover:border-accent/40"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" /> Filter
          {activeCount > 0 && (
            <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] leading-none text-on-accent">{activeCount}</span>
          )}
        </button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          {activeCount > 0 || query ? `${shown.length} of ${bonds.length}` : bonds.length} bond{bonds.length === 1 ? '' : 's'}
        </p>
        <p className="hidden text-xs text-text-faint sm:block">Prices are indicative, per ₹100 face value.</p>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {chips.map((chip) => (
            <button
              key={`${chip.cat}:${chip.k}`}
              type="button"
              onClick={() => setFilters((f) => removeFilter(f, chip.cat, chip.k))}
              className="inline-flex items-center gap-1 rounded-full border border-accent/30 bg-selected px-2.5 py-1 text-[11px] font-semibold text-accent"
            >
              {chip.label} <X className="h-3 w-3" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => setFilters(EMPTY_FILTERS)}
            className="px-2 text-[11px] font-semibold text-text-muted hover:text-accent"
          >
            Clear all
          </button>
        </div>
      )}

      {showFilter && (
        <BondFilterModal
          bonds={bonds}
          initial={filters}
          onApply={setFilters}
          onClose={() => setShowFilter(false)}
        />
      )}

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
