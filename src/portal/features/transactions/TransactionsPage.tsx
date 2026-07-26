import { useMemo, useState } from 'react';
import { ArrowLeftRight, Download, Search } from 'lucide-react';
import { fmt, fmtDate } from '../../../crm/utils';
import { LogoLoader } from '../../../components/LogoLoader';
import type { NWClient } from '../../../crm/types';
import { Card } from '../../components/Card';
import { KpiStat } from '../../components/KpiStat';
import { Segmented } from '../../components/Segmented';
import { EmptyState } from '../../components/EmptyState';
import { useTransactions } from '../../hooks/useTransactions';
import { TransactionService } from '../../services/TransactionService';
import { exportTransactionsXlsx } from '../../services/exporters';
import { DEFAULT_TXN_FILTER, type TxnFilter, type TxnTypeFilter } from '../../types/activity';
import type { ProductType } from '../../../crm/types';

export function TransactionsPage({ clientId, client }: { clientId: string; client: NWClient | null }) {
  const { rows, loading, error } = useTransactions(clientId);
  const [filter, setFilter] = useState<TxnFilter>(DEFAULT_TXN_FILTER);
  const patch = (p: Partial<TxnFilter>) => setFilter((f) => ({ ...f, ...p }));

  const productOptions = useMemo(() => {
    const present = [...new Set(rows.map((r) => r.productType))];
    return [
      { value: 'all' as const, label: 'All' },
      ...present.map((pt) => ({
        value: pt,
        label: rows.find((r) => r.productType === pt)!.productLabel,
      })),
    ];
  }, [rows]);

  const visible = useMemo(() => TransactionService.filter(rows, filter), [rows, filter]);
  const summary = useMemo(() => TransactionService.summary(visible), [visible]);
  const groups = useMemo(() => TransactionService.groupByMonth(visible), [visible]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <LogoLoader size={48} />
      </div>
    );
  }

  if (error) {
    return <Card><EmptyState icon={ArrowLeftRight} title={error} /></Card>;
  }

  if (rows.length === 0) {
    return <Card><EmptyState icon={ArrowLeftRight} title="No transactions yet." hint="Your buy and sell activity will appear here." /></Card>;
  }

  return (
    <div className="space-y-5">
      {/* Summary */}
      <Card padding="lg">
        <div className="grid grid-cols-3 gap-4">
          <KpiStat label="Invested" value={fmt(summary.invested)} />
          <KpiStat label="Redeemed" value={fmt(summary.redeemed)} color="var(--text-primary)" />
          <KpiStat label="Transactions" value={String(summary.count)} />
        </div>
      </Card>

      {/* Filters */}
      <div className="space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
            <input
              value={filter.query}
              onChange={(e) => patch({ query: e.target.value })}
              placeholder="Search by scheme or security…"
              className="w-full rounded-token-md border border-border bg-bg-surface py-2.5 pl-10 pr-4 text-sm text-text-primary outline-none transition-colors focus:border-accent"
            />
          </div>
          <button
            type="button"
            onClick={() => exportTransactionsXlsx(visible, client)}
            className="flex items-center justify-center gap-2 rounded-token-md border border-border bg-bg-surface px-4 py-2.5 text-xs font-semibold text-text-primary transition-colors hover:border-accent/40 hover:text-accent"
          >
            <Download className="h-4 w-4" /> Export
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented options={productOptions} value={filter.product} onChange={(product) => patch({ product: product as ProductType | 'all' })} />
          <Segmented<TxnTypeFilter>
            size="sm"
            options={[
              { value: 'all', label: 'All' },
              { value: 'buy', label: 'Buy' },
              { value: 'sell', label: 'Sell' },
            ]}
            value={filter.type}
            onChange={(type) => patch({ type })}
          />
        </div>
      </div>

      {/* Grouped list */}
      {visible.length === 0 ? (
        <Card><EmptyState icon={Search} title="No transactions match your filters." compact /></Card>
      ) : (
        <div className="space-y-5">
          {groups.map((g) => (
            <div key={g.key}>
              <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-text-faint">{g.label}</p>
              <Card padding="none" className="overflow-hidden">
                <ul className="divide-y divide-border-subtle">
                  {g.rows.map((r) => {
                    const isBuy = r.txnType === 'buy';
                    return (
                      <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-token-md text-[10px] font-bold uppercase"
                          style={{
                            color: isBuy ? 'var(--success)' : 'var(--danger)',
                            background: isBuy ? 'rgba(var(--success-rgb),0.1)' : 'rgba(var(--danger-rgb),0.1)',
                          }}
                        >
                          {isBuy ? 'Buy' : 'Sell'}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-text-primary">{r.name}</p>
                          <p className="flex items-center gap-1.5 text-[11px] text-text-secondary">
                            <span className="h-1.5 w-1.5 rounded-sm" style={{ background: r.productColor }} />
                            {r.productLabel} · {fmtDate(r.date)}
                            {r.units ? ` · ${r.units} units` : ''}
                          </p>
                        </div>
                        <p className="shrink-0 text-sm font-bold" style={{ color: isBuy ? 'var(--text-primary)' : 'var(--success)' }}>
                          {isBuy ? '' : '+'}{fmt(r.amount)}
                        </p>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </div>
          ))}
          <p className="px-1 text-xs text-text-faint">Showing {visible.length} of {rows.length} transactions</p>
        </div>
      )}
    </div>
  );
}
