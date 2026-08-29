// Partner bond marketplace — the same rich card grid + Filter panel the client
// portal has, but priced for the partner: their cost (partner_base) and their
// selling price (partner_price = cost × their spread). Includes the partner's
// global markup control. Card click → detail.

import { useMemo, useState } from 'react';
import { Landmark, ArrowRight, SlidersHorizontal, X, Percent, Check, Loader2, Search } from 'lucide-react';
import { inr, inrCompact, pct, shortDate } from '../../../lib/money';
import { BondFilterModal } from '../../../portal/features/bonds/BondFilterModal';
import {
  EMPTY_FILTERS, countFilters, matchesFilters, filterChips, removeFilter,
  type BondFilters,
} from '../../../../shared/portal/bonds/bondFilters';
import { bondMatchesQuery } from '../../../../shared/portal/bonds/bondSearch';
import { tenureLabel } from '../../../portal/features/bonds/bondMath';
import type { PartnerBond } from '../../services/PartnerService';

function freqLabel(f: string | null): string {
  const v = (f || '').toLowerCase().replace(/_/g, '-');
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : '—';
}

export function PartnerBondsList({
  bonds,
  currentMarkup,
  onSaveMarkup,
  onOpen,
}: {
  bonds: PartnerBond[];
  currentMarkup: number;
  onSaveMarkup: (pct: number) => Promise<void>;
  onOpen: (bond: PartnerBond) => void;
}) {
  const [filters, setFilters] = useState<BondFilters>(EMPTY_FILTERS);
  const [showFilter, setShowFilter] = useState(false);
  const [query, setQuery] = useState('');
  const [markup, setMarkup] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const shown = useMemo(
    () => bonds.filter((b) => bondMatchesQuery(b, query) && matchesFilters(b, filters)),
    [bonds, filters, query],
  );
  const activeCount = countFilters(filters);
  const chips = filterChips(filters);

  const save = async () => {
    const v = parseFloat(markup);
    if (Number.isNaN(v)) return;
    setSaving(true); setSaveErr(null);
    try { await onSaveMarkup(v); setMarkup(''); }
    catch (e) { setSaveErr(e instanceof Error ? e.message : 'Failed to save'); }
    finally { setSaving(false); }
  };

  return (
    <div className="space-y-4">
      {/* Global markup control */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-token-xl border border-border bg-bg-elevated p-5">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-text-faint">Your markup</p>
          <p className="mt-0.5 text-sm text-text-secondary">
            Added on top of your cost, capped at <strong>5%</strong>. Current: <strong className="text-text-primary">{pct(currentMarkup)}</strong>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Percent className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
            <input
              type="number" step="0.01" min={0} max={5} value={markup} onChange={(e) => setMarkup(e.target.value)}
              placeholder={String(currentMarkup)}
              className="w-28 rounded-token-md border border-border bg-bg-surface py-2 pl-8 pr-2 text-sm text-text-primary outline-none"
            />
          </div>
          <button
            disabled={saving || markup === '' || Number.isNaN(parseFloat(markup))}
            onClick={save}
            className="inline-flex items-center gap-1.5 rounded-token-md bg-accent px-4 py-2 text-sm font-bold text-on-accent disabled:opacity-40"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Save
          </button>
        </div>
      </div>
      {saveErr && <p className="text-sm text-danger-soft">{saveErr}</p>}

      {/* Search + filter */}
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
          className="inline-flex shrink-0 items-center gap-2 rounded-token-md border border-border bg-bg-raised px-3.5 py-2 text-xs font-semibold text-text-primary hover:border-accent/40"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" /> Filter
          {activeCount > 0 && <span className="rounded-full bg-accent px-1.5 py-0.5 text-[10px] leading-none text-on-accent">{activeCount}</span>}
        </button>
      </div>

      {/* Count */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary">
          {activeCount > 0 || query ? `${shown.length} of ${bonds.length}` : bonds.length} bond{bonds.length === 1 ? '' : 's'}
        </p>
        <p className="hidden text-xs text-text-faint sm:block">Prices per ₹100 face; “Your price” includes your {pct(currentMarkup)} markup.</p>
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
          <button type="button" onClick={() => setFilters(EMPTY_FILTERS)} className="px-2 text-[11px] font-semibold text-text-muted hover:text-accent">Clear all</button>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="rounded-token-xl border border-border bg-bg-elevated py-16 text-center">
          <Landmark className="mx-auto mb-3 h-8 w-8 text-text-faint" />
          <p className="text-base font-semibold text-text-primary">
            {bonds.length === 0 ? 'No bonds available yet' : 'Nothing matches this filter'}
          </p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-text-muted">
            {bonds.length === 0
              ? 'Bonds you can offer will appear here once your relationship manager approves your pricing.'
              : 'Try a different filter to see more opportunities.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => onOpen(b)}
              className="flex flex-col gap-4 rounded-token-xl border border-border bg-bg-elevated p-5 text-left shadow-token-card transition-colors hover:border-accent/40"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-token-lg bg-accent/10 font-display text-sm font-bold text-accent">
                    {(b.issuer_name || b.bond_name || '?').trim().charAt(0).toUpperCase()}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold leading-snug text-text-primary">{b.issuer_name || b.bond_name || b.isin}</p>
                    <p className="truncate text-[11px] text-text-faint">{b.isin}</p>
                  </div>
                </div>
                {b.rating && <span className="shrink-0 rounded-token-sm border border-accent/20 bg-accent/10 px-1.5 py-0.5 text-[11px] font-semibold text-accent">{b.rating}</span>}
              </div>

              <div className="grid grid-cols-3 gap-2">
                <Stat label="Yield (YTM)" value={b.analytics?.ytm != null ? pct(b.analytics.ytm) : pct(b.coupon_rate ?? 0)} accent />
                <Stat label="Tenure" value={tenureLabel(b)} />
                <Stat label="Min. Invest" value={b.min_investment != null ? inrCompact(b.min_investment) : (b.face_value != null ? inrCompact(b.face_value) : '—')} />
              </div>

              <div className="mt-auto flex items-end justify-between border-t border-border-subtle pt-3">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">Coupon</p>
                  <p className="font-display text-lg font-bold leading-none text-text-primary">{pct(b.coupon_rate ?? 0)}</p>
                  <p className="mt-1 text-[11px] text-text-muted">Interest {freqLabel(b.coupon_frequency)} · {shortDate(b.maturity_date)}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">Your price / ₹100</p>
                  <p className="font-display text-lg font-extrabold leading-none text-accent">{inr(b.partner_price ?? 0)}</p>
                  <p className="mt-1 text-[11px] text-text-faint">cost {inr(b.partner_base ?? 0)}</p>
                </div>
              </div>

              <span className="inline-flex items-center justify-center gap-1.5 rounded-token-md border border-border bg-bg-surface py-2 text-xs font-bold text-text-primary">
                View details <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </button>
          ))}
        </div>
      )}

      {showFilter && (
        <BondFilterModal bonds={bonds} initial={filters} onApply={setFilters} onClose={() => setShowFilter(false)} />
      )}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-text-faint">{label}</p>
      <p className={`mt-0.5 truncate font-semibold tabular-nums ${accent ? 'text-success' : 'text-text-primary'}`}>{value}</p>
    </div>
  );
}
