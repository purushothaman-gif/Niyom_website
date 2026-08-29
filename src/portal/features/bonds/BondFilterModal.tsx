// Bond marketplace filter (Jiraaf-style) — a category rail on the left, options
// on the right, Clear All + Apply in the footer.
//
// The RULES (which buckets exist, what falls in each, how a selection reads as a
// chip) live in `shared/portal/bonds/bondFilters.ts` so the mobile app filters
// identically; this file is only their presentation on the web — the list pages
// import the rules straight from shared/, not through this component.

import { useMemo, useState } from 'react';
import { X, Check } from 'lucide-react';
import type { FilterableBond } from '../../../../shared/portal/bonds/bondMath';
import {
  EMPTY_FILTERS,
  countFilters,
  filterCategories,
  matchesFilters,
  toggleFilter,
  type BondFilterCategory,
  type BondFilters,
} from '../../../../shared/portal/bonds/bondFilters';


export function BondFilterModal({
  bonds,
  initial,
  onApply,
  onClose,
}: {
  bonds: FilterableBond[];
  initial: BondFilters;
  onApply: (f: BondFilters) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<BondFilters>(initial);
  const [cat, setCat] = useState<BondFilterCategory>('yield');

  // Options that actually exist in the offered bonds.
  const cats = useMemo(() => filterCategories(bonds), [bonds]);
  const activeCat = cats.find((c) => c.key === cat)!;

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
            {cats.map((c) => {
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
                      onClick={() => setDraft((d) => toggleFilter(d, cat, o.k))}
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
