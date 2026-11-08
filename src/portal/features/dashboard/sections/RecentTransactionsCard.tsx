import { ArrowLeftRight, ChevronRight, Receipt } from 'lucide-react';
import { fmt, fmtDate, PRODUCT_LABELS } from '../../../../crm/utils';
import { Card } from '../../../components/Card';
import { SectionHeader } from '../../../components/SectionHeader';
import { EmptyState } from '../../../components/EmptyState';
import type { RecentTransaction } from '../../../types';

interface Props {
  transactions: RecentTransaction[];
  onViewAll: () => void;
}

export function RecentTransactionsCard({ transactions, onViewAll }: Props) {
  return (
    <Card className="animate-fadeInUp animate-delay-300">
      <SectionHeader
        title="Recent Transactions"
        icon={ArrowLeftRight}
        action={
          transactions.length > 0 ? (
            <button
              type="button"
              onClick={onViewAll}
              className="flex items-center gap-0.5 text-xs font-semibold text-accent hover:text-accent-soft"
            >
              View all <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : undefined
        }
      />

      {transactions.length === 0 ? (
        <EmptyState icon={Receipt} title="No transactions yet." compact />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {transactions.map((t) => {
            const isBuy = t.txnType === 'buy';
            return (
              <li key={t.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-token-md text-[10px] font-bold uppercase"
                  style={{
                    color: isBuy ? 'var(--success)' : 'var(--danger)',
                    background: isBuy
                      ? 'rgba(var(--success-rgb),0.1)'
                      : 'rgba(var(--danger-rgb),0.1)',
                  }}
                >
                  {isBuy ? 'Buy' : 'Sell'}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-text-primary">{t.productName}</p>
                  <p className="text-[11px] text-text-secondary">
                    {PRODUCT_LABELS[t.productType]}{t.kindLabel ? ` · ${t.kindLabel}` : ''} · {fmtDate(t.date)}
                  </p>
                </div>
                <p className="text-xs font-bold text-text-primary">{fmt(t.amount)}</p>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
