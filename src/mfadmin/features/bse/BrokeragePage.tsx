/**
 * Brokerage — trail income accruing on NIYOM's mutual-fund book.
 *
 * These are ACCRUAL ESTIMATES, not settled receipts: BSE does not expose
 * brokerage to our member tier (get_mis_detail / get_payment_detail both return
 * errcode `authz`), so the figures are a run-rate computed from real holdings
 * and their trail_percent. The page says so plainly rather than implying BSE
 * has confirmed or paid these amounts.
 */
import { Coins, Info, PieChart } from 'lucide-react';
import { fmt } from '../../../crm/utils';
import { Card } from '../../../portal/components/Card';
import { KpiStat } from '../../../portal/components/KpiStat';
import { SectionHeader } from '../../../portal/components/SectionHeader';
import { EmptyState } from '../../../portal/components/EmptyState';
import { LogoLoader } from '../../../components/LogoLoader';
import { RevenueService, type BrokerageSummary } from '../../services/RevenueService';
import { useBseData } from '../../hooks/useBseData';
import { ErrorNote, WarnNote } from './formBits';
import { TableScroll, TH, TD } from './BsePanel';

export function BrokeragePage() {
  const { data, loading, error } = useBseData<BrokerageSummary>(() => RevenueService.brokerage());

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <LogoLoader size={48} />
      </div>
    );
  }
  if (error) return <ErrorNote title="Couldn’t load brokerage." message={error} />;
  if (!data) return null;

  const empty = data.rows.length === 0;

  return (
    <div className="space-y-5">
      {/* Provenance first — these numbers are not BSE-confirmed. */}
      <div className="flex items-start gap-2 rounded-token-md border border-border bg-bg-surface p-3 text-xs text-text-secondary">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
        <span>
          <strong className="text-text-primary">Estimated accrual.</strong> BSE does not report
          settled brokerage to our member code, so these figures are a run-rate computed from
          holdings and their trail rate — not amounts BSE has confirmed or paid.
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card padding="md" accent>
          <KpiStat label="Trail (annual run-rate)" value={fmt(data.annualTrail)} color="var(--accent)" />
        </Card>
        <Card padding="md">
          <KpiStat label="Trail per month" value={fmt(data.monthlyTrail)} />
        </Card>
        <Card padding="md">
          <KpiStat label="Book value" value={fmt(data.totalValue)} sub={`${data.rows.length} holdings`} />
        </Card>
        <Card padding="md">
          <KpiStat
            label="Effective trail"
            value={data.totalValue > 0 ? `${((data.annualTrail / data.totalValue) * 100).toFixed(2)}%` : '—'}
            sub="weighted"
          />
        </Card>
      </div>

      {data.missingTrail > 0 && (
        <WarnNote>
          {data.missingTrail} holding{data.missingTrail === 1 ? ' has' : 's have'} no trail rate set,
          so {data.missingTrail === 1 ? 'it contributes' : 'they contribute'} nothing above. Set
          <strong> trail %</strong> on the holding in the CRM to include{' '}
          {data.missingTrail === 1 ? 'it' : 'them'}.
        </WarnNote>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <SectionHeader title="Trail by holding" icon={Coins} />
          {empty ? (
            <EmptyState icon={Coins} title="No mutual fund holdings yet." compact />
          ) : (
            <TableScroll>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <TH>Client</TH>
                    <TH>Scheme</TH>
                    <TH right>Value</TH>
                    <TH right>Trail %</TH>
                    <TH right>Annual</TH>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.slice(0, 50).map((r, i) => (
                    <tr key={`${r.clientId}-${i}`} className="hover:bg-bg-base/50">
                      <TD>
                        <span className="font-medium">{r.clientName}</span>
                        <span className="ml-1.5 font-mono text-text-faint">{r.clientCode}</span>
                      </TD>
                      <TD>
                        <span title={r.scheme}>
                          {r.scheme.length > 30 ? `${r.scheme.slice(0, 29)}…` : r.scheme}
                        </span>
                      </TD>
                      <TD right>{fmt(r.value)}</TD>
                      <TD right>
                        {r.trailPercent > 0 ? (
                          `${r.trailPercent}%`
                        ) : (
                          <span className="text-warning">not set</span>
                        )}
                      </TD>
                      <TD right>{fmt(r.annual)}</TD>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
          {data.rows.length > 50 && (
            <p className="mt-3 text-[11px] text-text-faint">
              Showing the 50 highest-earning of {data.rows.length} holdings.
            </p>
          )}
        </Card>

        <Card>
          <SectionHeader title="By AMC" icon={PieChart} />
          {empty ? (
            <EmptyState icon={PieChart} title="Nothing to summarise." compact />
          ) : (
            <ul className="space-y-2.5">
              {data.byAmc.slice(0, 10).map((a) => (
                <li key={a.amc} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-text-primary">
                      {a.amc}
                    </span>
                    <span className="block text-[10px] text-text-faint">
                      {a.count} holding{a.count === 1 ? '' : 's'} · {fmt(a.value)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold text-accent">{fmt(a.annual)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
