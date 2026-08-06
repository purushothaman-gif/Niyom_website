import { useMemo, useState } from 'react';
import { Upload, Wallet } from 'lucide-react';
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
import { ImportPortfolioCard } from './ImportPortfolioCard';

type Filter = ProductType | 'all';

const SORTERS: Record<SortKey, (a: PortfolioData['rows'][number], b: PortfolioData['rows'][number]) => number> = {
  value: (a, b) => a.value - b.value,
  gain: (a, b) => a.gain - b.gain,
  invested: (a, b) => a.invested - b.invested,
  name: (a, b) => a.name.localeCompare(b.name),
};

export function PortfolioPage({
  data,
  onImport,
  freshness,
  hasImportedStatement = false,
  valuedOn,
}: {
  data: PortfolioData;
  /** Opens the import wizard, which PortalApp owns so both screens share one. */
  onImport: () => void;
  /** How current the imported mutual fund picture is; absent until one exists. */
  freshness?: CasFreshness;
  hasImportedStatement?: boolean;
  /** NAV date the mutual fund figures are priced at, when newer than the statement. */
  valuedOn?: string | null;
}) {
  const { summary, rows } = data;
  const [filter, setFilter] = useState<Filter>('all');
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

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

  /**
   * An investor with nothing here has almost always invested elsewhere — an
   * empty portfolio is far more often "we cannot see it yet" than "there is
   * nothing". So the empty state offers the import rather than waiting for them
   * to start from scratch with us.
   */
  if (rows.length === 0) {
    return (
      <div className="space-y-5">
        {/* The pitch does the work here; a bare "no holdings" card would not. */}
        <ImportPortfolioCard onImport={onImport} dismissible={false} />
        <Card>
          <EmptyState
            icon={Wallet}
            title="Nothing here yet."
            hint="Holdings you buy through us will appear here as they settle."
          />
        </Card>
      </div>
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
      {/*
        Before a statement exists the client does not know anything is missing,
        so the case for it gets real space. Once imported, the same action
        becomes a quiet "bring it up to date" button.
      */}
      {!hasImportedStatement && (
        <ImportPortfolioCard
          onImport={onImport}
          visibleHoldings={rows.length}
          returnsUnavailable={false}
        />
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {freshness && (
            <CasStatusNote freshness={freshness} onImport={onImport} valuedOn={valuedOn} />
          )}
        </div>
        {hasImportedStatement && <ImportButton onClick={onImport} />}
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

    </div>
  );
}

/** The quiet variant, shown only once a statement has already been imported. */
/**
 * The way back into the import flow once a statement already exists.
 *
 * Wording and prominence both matter here, and both were wrong. It read
 * "Update from a newer statement", which describes only half of what the flow
 * does — a second statement ADDS to the portfolio rather than replacing it,
 * which is exactly what a client with folios under two email addresses needs.
 * Someone looking for "add another statement" would not recognise this button
 * as the thing they wanted, and reasonably concluded there was no such option.
 *
 * It also carried a Download icon for an action that uploads.
 */
function ImportButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-2 rounded-token-md border border-accent/30 bg-accent/5 px-3.5 py-2 text-xs font-semibold text-accent transition-colors hover:border-accent/50 hover:bg-accent/10"
    >
      <Upload className="h-3.5 w-3.5" />
      Add or update a statement
    </button>
  );
}
