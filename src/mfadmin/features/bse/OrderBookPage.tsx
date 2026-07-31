/**
 * Order Book — every order at BSE StAR MF, open and closed.
 *
 * The rejection reason is shown inline rather than behind a tooltip: when an
 * order fails, that sentence is the whole reason staff opened this screen.
 */
import { useMemo } from 'react';
import { AlertCircle } from 'lucide-react';
import { BseOpsService, isBseConfigured, type BseOrderRow } from '../../services/BseOpsService';
import { useBseData } from '../../hooks/useBseData';
import { Chip, PageHead, StatTile, statusTone } from '../../ui/Surface';
import { DataTable, type Column } from '../../ui/DataTable';
import { ErrorBlock, Loading } from '../../ui/controls';
import { NotConfigured } from './formBits';
import { dateTime, humanise, inr, inrCompact, num } from '../../../lib/money';

const ORDER_TYPE: Record<string, string> = { p: 'Purchase', r: 'Redemption', s: 'Switch' };

export function OrderBookPage() {
  const { data, loading, error, refresh } = useBseData<BseOrderRow[]>(() => BseOpsService.orders());
  const rows = useMemo(() => data ?? [], [data]);

  const stats = useMemo(() => {
    const done = rows.filter((o) => /done|allot|settled|match/i.test(o.status)).length;
    const rejected = rows.filter((o) => /reject|fail|cancel/i.test(o.status)).length;
    return {
      total: rows.length,
      value: rows.reduce((s, o) => s + (o.amount || 0), 0),
      open: rows.length - done - rejected,
      rejected,
    };
  }, [rows]);

  const cols: Column<BseOrderRow>[] = [
    {
      key: 'orderId',
      header: 'Order ID',
      value: (r) => r.orderId,
      render: (r) => <span className="font-mono text-text-primary">{r.orderId}</span>,
    },
    {
      key: 'client',
      header: 'Client',
      value: (r) => `${r.clientName} ${r.clientCode}`,
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate font-medium text-text-primary">
            {r.clientName.trim() || r.clientCode || '—'}
          </p>
          {r.clientName.trim() && (
            <p className="truncate font-mono text-[10px] text-text-faint">{r.clientCode}</p>
          )}
        </div>
      ),
    },
    {
      key: 'scheme',
      header: 'Scheme',
      value: (r) => r.schemeName || r.schemeCode,
      render: (r) => (
        <div className="min-w-0">
          <p className="line-clamp-2 text-text-secondary">{r.schemeName || r.schemeCode || '—'}</p>
          {r.folio && <p className="font-mono text-[10px] text-text-faint">Folio {r.folio}</p>}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      value: (r) => ORDER_TYPE[r.type] ?? r.type,
      render: (r) => <Chip>{ORDER_TYPE[r.type] ?? r.type ?? '—'}</Chip>,
    },
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      value: (r) => r.amount,
      render: (r) => <span className="font-semibold text-text-primary">{inr(r.amount)}</span>,
    },
    {
      key: 'placedAt',
      header: 'Placed',
      value: (r) => r.placedAt,
      render: (r) => <span className="whitespace-nowrap text-text-faint">{dateTime(r.placedAt)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      value: (r) => r.status,
      render: (r) => (
        <div className="flex flex-col items-end gap-1">
          <Chip tone={statusTone(r.status)}>{humanise(r.status) || 'Unknown'}</Chip>
          {r.rejectionReason && (
            <span className="inline-flex items-center gap-1 text-right text-[10px] leading-tight text-danger-soft">
              <AlertCircle className="h-3 w-3 shrink-0" />
              {r.rejectionReason}
            </span>
          )}
        </div>
      ),
    },
  ];

  if (!isBseConfigured()) return <NotConfigured title="Order Book" />;

  return (
    <>
      <PageHead
        title="Order Book"
        subtitle="Every order at BSE StAR MF — open and closed, newest first."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Orders" value={num(stats.total)} />
        <StatTile label="Gross value" value={inrCompact(stats.value)} />
        <StatTile
          label="Still open"
          value={num(stats.open)}
          tone={stats.open > 0 ? 'warning' : 'default'}
        />
        <StatTile
          label="Rejected"
          value={num(stats.rejected)}
          tone={stats.rejected > 0 ? 'negative' : 'default'}
        />
      </div>

      {loading && <Loading label="Loading the order book from BSE…" />}
      {!loading && error && <ErrorBlock message={error} onRetry={refresh} />}
      {!loading && !error && (
        <DataTable
          rows={rows}
          columns={cols}
          rowKey={(r) => r.orderId}
          searchPlaceholder="Search by order id, client, scheme or status…"
          empty={{
            title: 'No orders at BSE yet',
            hint: 'Orders placed from Transact appear here as soon as BSE accepts them.',
          }}
        />
      )}
    </>
  );
}
