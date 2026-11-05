import { ChevronRight } from 'lucide-react';
import { inr } from '../../../lib/money';
import { ASSET_META, type InvestmentRow } from '../../../../shared/portal/investments/model';
import { signedPct, toneOf } from './format';

/** Dashboard right rail: the client's largest holdings, compact. */
export function TopHoldingsCard({
  rows,
  limit = 5,
  onOpen,
}: {
  rows: InvestmentRow[];
  limit?: number;
  onOpen: () => void;
}) {
  if (!rows.length) return null;
  const top = [...rows].sort((a, b) => b.value - a.value).slice(0, limit);
  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-xl font-bold tracking-tight text-text-primary">
          Holdings <span className="text-text-faint">({rows.length})</span>
        </h2>
        <button type="button" onClick={onOpen} className="inline-flex items-center gap-0.5 text-xs font-semibold text-accent hover:text-accent-soft">
          View all <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="overflow-hidden rounded-token-xl border border-border bg-bg-elevated shadow-token-card">
        {top.map((r) => {
          const m = ASSET_META[r.asset];
          return (
            <button
              key={r.id}
              type="button"
              onClick={onOpen}
              className="flex w-full items-center gap-3 border-b border-border-subtle px-4 py-3 text-left transition-colors last:border-0 hover:bg-hover"
            >
              <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: m.color }} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold text-text-primary">{r.name}</span>
                <span className="block text-[11px] text-text-secondary">{m.label}</span>
              </span>
              <span className="shrink-0 text-right">
                <span className="block text-[13px] font-bold tabular-nums text-text-primary">{inr(r.value)}</span>
                <span className={`block text-[11px] tabular-nums ${toneOf(r.gainPct)}`}>
                  {r.gainPct == null ? '—' : signedPct(r.gainPct)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
