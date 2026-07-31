import { useMemo, useState } from 'react';
import { Download, Wallet } from 'lucide-react';
import { fmt } from '../../../crm/utils';
import type { ProductType } from '../../../crm/types';
import { Card } from '../../components/Card';
import { KpiStat } from '../../components/KpiStat';
import { Segmented } from '../../components/Segmented';
import { EmptyState } from '../../components/EmptyState';
import { CasStatusNote } from '../../components/CasStatusNote';
import type { PortfolioData } from '../../types';
import type { CasFreshness } from '../../types/cas';
import { HoldingsTable, type SortKey } from './HoldingsTable';
import { ImportPortfolioModal } from './ImportPortfolioModal';

type Filter = ProductType | 'all';

const SORTERS: Record<SortKey, (a: PortfolioData['rows'][number], b: PortfolioData['rows'][number]) => number> = {
  value: (a, b) => a.value - b.value,
  gain: (a, b) => a.gain - b.gain,
  invested: (a, b) => a.invested - b.invested,
  name: (a, b) => a.name.localeCompare(b.name),
};

export function PortfolioPage({
  data,
  onImported,
  freshness,
}: {
  data: PortfolioData;
  onImported?: () => void;
  /** How current the imported mutual fund picture is; absent until one exists. */
  freshness?: CasFreshness;
}) {
  const { summary, rows } = data;
  const [filter, setFilter] = useState<Filter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [importing, setImporting] = useState(false);

  const filterOptions = useMemo(() => {
    const opts: Array<{ value: Filter; label: string; count: number }> = [
      { value: 'all', label: 'All', count: rows.length },
    ];
    for (const b of data.breakdowns.product.buckets) {
      opts.push({ value: b.key as ProductType, label: b.label, count: b.count });
    }
    return opts;
  }, [rows.length, data.breakdowns.product.buckets]);

  const visibleRows = useMemo(() => {
    const filtered = filter === 'all' ? rows : rows.filter((r) => r.productType === filter);
    const sorted = [...filtered].sort(SORTERS[sortKey]);
    return sortDir === 'desc' ? sorted.reverse() : sorted;
  }, [rows, filter, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  const modal = importing ? (
    <ImportPortfolioModal
      onClose={() => setImporting(false)}
      onImported={() => onImported?.()}
    />
  ) : null;

  /**
   * An investor with nothing here has almost always invested elsewhere — an
   * empty portfolio is far more often "we cannot see it yet" than "there is
   * nothing". So the empty state offers the import rather than waiting for them
   * to start from scratch with us.
   */
  if (rows.length === 0) {
    return (
      <>
        <Card>
          <EmptyState
            icon={Wallet}
            title="No holdings yet."
            hint="Already invest elsewhere? Import your existing mutual funds from a Consolidated Account Statement."
          />
          <div className="flex justify-center pb-2">
            <ImportButton onClick={() => setImporting(true)} primary />
          </div>
        </Card>
        {modal}
      </>
    );
  }

  const gainUp = summary.gain >= 0;

  return (
    <div className="space-y-6">
      {/*
        Imported funds are valued as at the statement date, not today, and a
        client who has transacted since then is looking at figures we already
        know are behind. Saying so is the difference between a number they can
        rely on and one they will query when it does not match their fund house.
      */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {freshness && (
            <CasStatusNote freshness={freshness} onImport={() => setImporting(true)} />
          )}
        </div>
        <ImportButton onClick={() => setImporting(true)} />
      </div>

      {/* Summary bar */}
      <Card padding="lg">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-4">
          <KpiStat label="Current Value" value={fmt(summary.netWorth)} color="var(--accent)" />
          <KpiStat label="Invested" value={fmt(summary.invested)} />
          <KpiStat
            label={gainUp ? 'Total Gain' : 'Total Loss'}
            value={`${gainUp ? '+' : ''}${fmt(summary.gain)}`}
            color={gainUp ? 'var(--success)' : 'var(--danger)'}
            sub={`${gainUp ? '+' : ''}${summary.gainPercent.toFixed(2)}%`}
            trend={gainUp ? 'up' : 'down'}
          />
          <KpiStat label="Holdings" value={String(summary.holdingsCount)} sub={`${summary.productCount} asset classes`} />
        </div>
      </Card>

      {/* Filter + table */}
      <div className="space-y-3">
        <Segmented options={filterOptions} value={filter} onChange={setFilter} />
        <HoldingsTable rows={visibleRows} sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
        <p className="px-1 text-xs text-text-faint">
          Showing {visibleRows.length} of {rows.length} holdings
        </p>
      </div>

      {modal}
    </div>
  );
}

function ImportButton({ onClick, primary }: { onClick: () => void; primary?: boolean }) {
  if (primary) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="press inline-flex items-center gap-2 rounded-token-md px-5 py-2.5 text-sm font-bold text-text-on-accent"
        style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
      >
        <Download className="h-4 w-4" />
        Import existing portfolio
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-token-md border border-border bg-bg-surface px-3.5 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary"
    >
      <Download className="h-3.5 w-3.5" />
      Import existing portfolio
    </button>
  );
}
