import { ArrowDown, ArrowUp } from 'lucide-react';
import { fmt } from '../../../crm/utils';
import { StatusPill } from '../../components/StatusPill';
import { OwnershipBadge } from '../../components/OwnershipBadge';
import type { HoldingRow } from '../../types';

export type SortKey = 'value' | 'gain' | 'invested' | 'name';

interface HoldingsTableProps {
  rows: HoldingRow[];
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
}

const COLS: Array<{ key: SortKey; label: string; align: 'left' | 'right' }> = [
  { key: 'name', label: 'Holding', align: 'left' },
  { key: 'invested', label: 'Invested', align: 'right' },
  { key: 'value', label: 'Current Value', align: 'right' },
  { key: 'gain', label: 'P&L', align: 'right' },
];

function SortHead({
  col,
  active,
  dir,
  onSort,
}: {
  col: (typeof COLS)[number];
  active: boolean;
  dir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
}) {
  return (
    <th
      className={`whitespace-nowrap px-5 py-3.5 text-xs font-semibold uppercase tracking-wider text-text-secondary ${
        col.align === 'right' ? 'text-right' : 'text-left'
      }`}
    >
      <button
        type="button"
        onClick={() => onSort(col.key)}
        className={`inline-flex items-center gap-1 hover:text-text-primary ${
          active ? 'text-accent' : ''
        } ${col.align === 'right' ? 'flex-row-reverse' : ''}`}
      >
        {col.label}
        {active &&
          (dir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />)}
      </button>
    </th>
  );
}

export function HoldingsTable({ rows, sortKey, sortDir, onSort }: HoldingsTableProps) {
  return (
    <div className="overflow-x-auto rounded-token-xl border border-border bg-bg-elevated shadow-token-card">
      <table className="w-full min-w-[640px]">
        <thead>
          <tr className="border-b border-border-subtle">
            {COLS.map((c) => (
              <SortHead
                key={c.key}
                col={c}
                active={sortKey === c.key}
                dir={sortDir}
                onSort={onSort}
              />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const up = r.gain >= 0;
            return (
              <tr key={r.id} className="border-b border-border-subtle last:border-0 hover:bg-hover">
                <td className="px-5 py-3.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: r.productColor }}
                    />
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="truncate text-sm font-medium text-text-primary">{r.name}</p>
                        {/* Renders nothing unless this is a statement-sourced fund. */}
                        <OwnershipBadge ownership={r.ownership} />
                      </div>
                      <p className="truncate text-[11px] text-text-secondary">
                        {r.productLabel}
                        {r.meta ? ` · ${r.meta}` : ''}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-5 py-3.5 text-right text-sm text-text-primary">
                  {fmt(r.invested)}
                </td>
                <td className="px-5 py-3.5 text-right text-sm font-bold text-text-primary">
                  {fmt(r.value)}
                </td>
                <td className="px-5 py-3.5 text-right">
                  <p
                    className="text-sm font-bold"
                    style={{ color: up ? 'var(--success)' : 'var(--danger)' }}
                  >
                    {up ? '+' : ''}{fmt(r.gain)}
                  </p>
                  <p className="text-[11px]" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>
                    {up ? '+' : ''}{r.gainPercent.toFixed(1)}%
                  </p>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length === 0 && (
        <div className="flex items-center justify-center py-14">
          <StatusPill tone="muted">No holdings in this filter</StatusPill>
        </div>
      )}
    </div>
  );
}
