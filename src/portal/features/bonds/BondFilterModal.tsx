// Bond marketplace filter (Jiraaf-style) — a category rail on the left, options
// on the right, Clear All + Apply in the footer. Yield / Tenure / Min-Investment
// are fixed ranges; Rating / Payout / Tax / Collateral are derived from the bonds
// actually on offer so we never show an empty bucket. Multi-select within a
// category is OR; across categories is AND.

import { useMemo, useState } from 'react';
import { X, Check } from 'lucide-react';
import type { ClientBond } from '../../../../shared/portal/services/BondOrderService';

export interface BondFilters {
  yield: string[];
  tenure: string[];
  minInv: string[];
  rating: string[];
  payout: string[];
  tax: string[];
  collateral: string[];
}

export const EMPTY_FILTERS: BondFilters = {
  yield: [], tenure: [], minInv: [], rating: [], payout: [], tax: [], collateral: [],
};

export function countFilters(f: BondFilters): number {
  return Object.values(f).reduce((n, arr) => n + arr.length, 0);
}

// ---- derivations shared with the list ----
export function yieldOf(b: ClientBond): number | null {
  const v = b.analytics?.ytm ?? b.coupon_rate;
  return v == null ? null : Number(v);
}
export function tenureYearsOf(b: ClientBond): number | null {
  const y = b.analytics?.years_to_maturity;
  if (y != null && Number.isFinite(y)) return Number(y);
  if (b.maturity_date) {
    const d = new Date(b.maturity_date);
    if (!Number.isNaN(d.getTime())) return (d.getTime() - Date.now()) / (365.25 * 24 * 3600 * 1000);
  }
  return null;
}
export function minInvOf(b: ClientBond): number | null {
  const v = b.min_investment ?? b.face_value;
  return v == null ? null : Number(v);
}
/** The credit grade token (AAA/AA/A/BBB/…) out of a full rating like "CARE BBB-". */
export function ratingGrade(r: string | null): string | null {
  if (!r) return null;
  const m = r.toUpperCase().match(/[A-D]{1,3}/g);
  return m && m.length ? m[m.length - 1] : null;
}
const FREQ_LABEL: Record<string, string> = {
  monthly: 'Monthly', quarterly: 'Quarterly', 'semi-annual': 'Semi-annual',
  'semi_annual': 'Semi-annual', 'half-yearly': 'Semi-annual', annual: 'Annual',
  annually: 'Annual', yearly: 'Annual', cumulative: 'Cumulative',
  'at-maturity': 'At maturity', 'at_maturity': 'At maturity', maturity: 'At maturity',
};
export function payoutOf(b: ClientBond): string {
  const v = (b.coupon_frequency || '').toLowerCase().replace(/\s+/g, '_');
  if (!v) return '';
  return FREQ_LABEL[v] ?? FREQ_LABEL[v.replace(/_/g, '-')] ?? (v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, ' '));
}
const titleCase = (s: string) => s.length <= 4 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
export function taxOf(b: ClientBond): string { return (b.tax_status || '').trim(); }
export function collateralOf(b: ClientBond): string { return (b.security_type || '').trim(); }

const YIELD_OPTS = [
  { k: 'lt8', label: 'Up to 8%' },
  { k: '8_10', label: '8 – 10%' },
  { k: '10_12', label: '10 – 12%' },
  { k: 'gt12', label: 'More than 12%' },
];
const TENURE_OPTS = [
  { k: 'lt1', label: 'Up to 1 year' },
  { k: '1_3', label: '1 – 3 years' },
  { k: '3_5', label: '3 – 5 years' },
  { k: 'gt5', label: 'More than 5 years' },
];
const MININV_OPTS = [
  { k: 'lt1l', label: 'Up to ₹1 L' },
  { k: '1_3l', label: '₹1 – 3 L' },
  { k: '3_5l', label: '₹3 – 5 L' },
  { k: 'gt5l', label: 'More than ₹5 L' },
];

const STATIC_LABELS: Record<string, Record<string, string>> = {
  yield: Object.fromEntries(YIELD_OPTS.map((o) => [o.k, o.label])),
  tenure: Object.fromEntries(TENURE_OPTS.map((o) => [o.k, o.label])),
  minInv: Object.fromEntries(MININV_OPTS.map((o) => [o.k, o.label])),
};

/** Selected options flattened to removable chips, with display labels. */
export function filterChips(f: BondFilters): Array<{ cat: keyof BondFilters; k: string; label: string }> {
  const chips: Array<{ cat: keyof BondFilters; k: string; label: string }> = [];
  (Object.keys(f) as Array<keyof BondFilters>).forEach((cat) => {
    f[cat].forEach((k) => {
      const label = STATIC_LABELS[cat] ? (STATIC_LABELS[cat][k] ?? k)
        : (cat === 'tax' || cat === 'collateral') ? titleCase(k) : k;
      chips.push({ cat, k, label });
    });
  });
  return chips;
}

export function removeFilter(f: BondFilters, cat: keyof BondFilters, k: string): BondFilters {
  return { ...f, [cat]: f[cat].filter((x) => x !== k) };
}

// ---- membership tests ----
export function passYield(v: number | null, keys: string[]): boolean {
  if (!keys.length) return true;
  if (v == null) return false;
  return keys.some((k) =>
    k === 'lt8' ? v < 8 : k === '8_10' ? v >= 8 && v < 10 : k === '10_12' ? v >= 10 && v < 12 : v >= 12);
}
export function passTenure(y: number | null, keys: string[]): boolean {
  if (!keys.length) return true;
  if (y == null) return false;
  return keys.some((k) =>
    k === 'lt1' ? y < 1 : k === '1_3' ? y >= 1 && y < 3 : k === '3_5' ? y >= 3 && y < 5 : y >= 5);
}
export function passMinInv(m: number | null, keys: string[]): boolean {
  if (!keys.length) return true;
  if (m == null) return false;
  return keys.some((k) =>
    k === 'lt1l' ? m <= 100000 : k === '1_3l' ? m > 100000 && m <= 300000 : k === '3_5l' ? m > 300000 && m <= 500000 : m > 500000);
}

const GRADE_ORDER = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'C', 'D'];

/** Does a bond pass the whole filter set? */
export function matchesFilters(b: ClientBond, f: BondFilters): boolean {
  if (!passYield(yieldOf(b), f.yield)) return false;
  if (!passTenure(tenureYearsOf(b), f.tenure)) return false;
  if (!passMinInv(minInvOf(b), f.minInv)) return false;
  if (f.rating.length) { const g = ratingGrade(b.rating); if (!g || !f.rating.includes(g)) return false; }
  if (f.payout.length && !f.payout.includes(payoutOf(b))) return false;
  if (f.tax.length && !f.tax.includes(taxOf(b))) return false;
  if (f.collateral.length && !f.collateral.includes(collateralOf(b))) return false;
  return true;
}

type CatKey = 'yield' | 'tenure' | 'minInv' | 'rating' | 'payout' | 'tax' | 'collateral';

export function BondFilterModal({
  bonds,
  initial,
  onApply,
  onClose,
}: {
  bonds: ClientBond[];
  initial: BondFilters;
  onApply: (f: BondFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<BondFilters>(initial);
  const [cat, setCat] = useState<CatKey>('yield');

  // Options that actually exist in the offered bonds.
  const dynamic = useMemo(() => {
    const ratings = new Set<string>(), payouts = new Set<string>(), taxes = new Set<string>(), colls = new Set<string>();
    bonds.forEach((b) => {
      const g = ratingGrade(b.rating); if (g) ratings.add(g);
      const p = payoutOf(b); if (p) payouts.add(p);
      const t = taxOf(b); if (t) taxes.add(t);
      const c = collateralOf(b); if (c) colls.add(c);
    });
    return {
      rating: GRADE_ORDER.filter((g) => ratings.has(g)),
      payout: [...payouts].sort(),
      tax: [...taxes].sort(),
      collateral: [...colls].sort(),
    };
  }, [bonds]);

  const CATS: Array<{ key: CatKey; label: string; opts: Array<{ k: string; label: string }> }> = [
    { key: 'yield', label: 'Yield', opts: YIELD_OPTS },
    { key: 'tenure', label: 'Tenure', opts: TENURE_OPTS },
    { key: 'minInv', label: 'Min Investment', opts: MININV_OPTS },
    { key: 'rating', label: 'Rating', opts: dynamic.rating.map((g) => ({ k: g, label: g })) },
    { key: 'payout', label: 'Payout Frequency', opts: dynamic.payout.map((p) => ({ k: p, label: p })) },
    { key: 'tax', label: 'Tax Status', opts: dynamic.tax.map((t) => ({ k: t, label: titleCase(t) })) },
    { key: 'collateral', label: 'Collateral', opts: dynamic.collateral.map((c) => ({ k: c, label: titleCase(c) })) },
  ];

  const activeCat = CATS.find((c) => c.key === cat)!;
  const toggle = (key: CatKey, k: string) =>
    setDraft((d) => ({ ...d, [key]: d[key].includes(k) ? d[key].filter((x) => x !== k) : [...d[key], k] }));

  const total = countFilters(draft);
  const matchCount = useMemo(() => bonds.filter((b) => matchesFilters(b, draft)).length, [bonds, draft]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-token-xl border border-border bg-bg-elevated shadow-token-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 className="font-display text-lg font-bold text-text-primary">Filter</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary"><X className="h-5 w-5" /></button>
        </div>

        {/* Body: category rail + options */}
        <div className="flex min-h-0 flex-1">
          <div className="w-36 shrink-0 overflow-y-auto border-r border-border-subtle bg-bg-surface py-2 sm:w-44">
            {CATS.map((c) => {
              const n = draft[c.key].length;
              const on = c.key === cat;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCat(c.key)}
                  className={`flex w-full items-center justify-between gap-1 px-3 py-2.5 text-left text-xs font-semibold transition-colors sm:px-4 sm:text-sm ${
                    on ? 'bg-bg-elevated text-accent' : 'text-text-secondary hover:text-text-primary'
                  }`}
                  style={on ? { boxShadow: 'inset 2px 0 0 var(--accent)' } : undefined}
                >
                  <span className="truncate">{c.label}</span>
                  {n > 0 && <span className="rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">{n}</span>}
                </button>
              );
            })}
          </div>

          <div className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-5">
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-wider text-text-faint">{activeCat.label}</p>
            {activeCat.opts.length === 0 ? (
              <p className="py-8 text-center text-sm text-text-muted">No options available for the bonds on offer.</p>
            ) : (
              <div className="space-y-1.5">
                {activeCat.opts.map((o) => {
                  const checked = draft[cat].includes(o.k);
                  return (
                    <button
                      key={o.k}
                      type="button"
                      onClick={() => toggle(cat, o.k)}
                      className={`flex w-full items-center justify-between gap-3 rounded-token-md border px-3.5 py-3 text-left text-sm transition-colors ${
                        checked ? 'border-accent/40 bg-selected text-text-primary' : 'border-border bg-bg-surface text-text-secondary hover:border-border-strong'
                      }`}
                    >
                      <span className="font-medium">{o.label}</span>
                      <span className={`flex h-5 w-5 items-center justify-center rounded-token-sm border ${checked ? 'border-accent bg-accent text-on-accent' : 'border-border'}`}>
                        {checked && <Check className="h-3.5 w-3.5" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-5 py-4">
          <button
            type="button"
            onClick={() => setDraft(EMPTY_FILTERS)}
            disabled={total === 0}
            className="text-sm font-semibold text-text-secondary hover:text-accent disabled:opacity-40"
          >
            Clear All
          </button>
          <button
            type="button"
            onClick={() => { onApply(draft); onClose(); }}
            className="rounded-token-md px-6 py-2.5 text-sm font-bold text-on-accent"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
          >
            {total > 0 ? `Show ${matchCount} bond${matchCount === 1 ? '' : 's'}` : 'Apply filters'}
          </button>
        </div>
      </div>
    </div>
  );
}
