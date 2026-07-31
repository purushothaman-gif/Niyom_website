/**
 * Holdings — netted positions across every client.
 *
 * BSE exposes no holdings or folio API to our member tier (`get_mis_detail`
 * returns errcode `authz`), so the proxy derives positions from allotment and
 * redemption details on settled orders. That means this screen is empty until
 * an order actually settles — which the empty state says outright, because a
 * blank table here would otherwise read as "this client holds nothing".
 */
import { useMemo } from 'react';
import { PieChart, Wallet } from 'lucide-react';
import { BseOpsService, isBseConfigured, type BseHoldingRow } from '../../services/BseOpsService';
import { useBseData } from '../../hooks/useBseData';
import { PageHead, StatTile } from '../../ui/Surface';
import { DataTable, type Column } from '../../ui/DataTable';
import { ErrorBlock, Loading } from '../../ui/controls';
import { NotConfigured } from '../bse/formBits';
import { inr, inrCompact, num } from '../../../lib/money';

export function HoldingsPage() {
  const holdings = useBseData<BseHoldingRow[]>(() => BseOpsService.holdings());
  const rows = useMemo(() => holdings.data ?? [], [holdings.data]);

  const totals = useMemo(
    () => ({
      value: rows.reduce((s, h) => s + (h.value || 0), 0),
      clients: new Set(rows.map((h) => h.clientCode)).size,
      folios: new Set(rows.map((h) => h.folio)).size,
    }),
    [rows],
  );

  const cols: Column<BseHoldingRow>[] = [
    {
      key: 'client',
      header: 'Client',
      value: (r) => r.clientCode,
      render: (r) => <span className="font-mono text-text-primary">{r.clientCode}</span>,
    },
    {
      key: 'scheme',
      header: 'Scheme',
      value: (r) => r.schemeName || r.schemeCode,
      render: (r) => (
        <div className="min-w-0">
          <p className="line-clamp-2 text-text-secondary">{r.schemeName || r.schemeCode}</p>
          <p className="font-mono text-[10px] text-text-faint">{r.schemeCode}</p>
        </div>
      ),
    },
    {
      key: 'folio',
      header: 'Folio',
      value: (r) => r.folio,
      render: (r) => <span className="font-mono text-text-secondary">{r.folio || '—'}</span>,
    },
    { key: 'units', header: 'Units', numeric: true, value: (r) => r.units, render: (r) => num(r.units, 3) },
    {
      key: 'nav',
      header: 'NAV',
      numeric: true,
      value: (r) => r.lastNav,
      render: (r) => (r.lastNav > 0 ? num(r.lastNav, 4) : '—'),
    },
    {
      key: 'value',
      header: 'Value',
      numeric: true,
      value: (r) => r.value,
      render: (r) => <span className="font-semibold text-text-primary">{inr(r.value)}</span>,
    },
  ];

  if (!isBseConfigured()) return <NotConfigured title="Holdings" />;

  return (
    <>
      <PageHead
        title="Holdings"
        subtitle="Positions netted from settled orders — BSE serves no holdings API to our member tier."
      />

      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Book value" value={inrCompact(totals.value)} icon={Wallet} />
        <StatTile label="Clients holding" value={num(totals.clients)} />
        <StatTile label="Folios" value={num(totals.folios)} icon={PieChart} />
      </div>

      {holdings.loading && <Loading label="Deriving positions from settled orders…" />}
      {!holdings.loading && holdings.error && (
        <ErrorBlock message={holdings.error} onRetry={holdings.refresh} />
      )}
      {!holdings.loading && !holdings.error && (
        <DataTable
          rows={rows}
          columns={cols}
          rowKey={(r) => `${r.clientCode}|${r.folio}|${r.schemeCode}`}
          searchPlaceholder="Search by client, scheme or folio…"
          empty={{
            title: 'No settled holdings yet',
            hint: 'A folio only exists once the RTA allots an order. Orders still showing “received” or “payment pending” have not created a position yet, so nothing appears here.',
          }}
        />
      )}
    </>
  );
}
