/**
 * Commission — what NIYOM owes and has paid its DSAs.
 *
 * This page READS the debit notes that the CRM's DSA Payout screen has already
 * computed and issued. It deliberately does NOT recompute a payout: that
 * formula lives in DSAPayout.tsx and only there, the issued debit note is the
 * document of record, and a second implementation would silently drift from it.
 * Generating or paying notes stays in the CRM; this is the read-only view.
 */
import { Info, Percent } from 'lucide-react';
import { fmt, fmtDate } from '../../../crm/utils';
import { Card } from '../../../portal/components/Card';
import { KpiStat } from '../../../portal/components/KpiStat';
import { SectionHeader } from '../../../portal/components/SectionHeader';
import { StatusPill } from '../../../portal/components/StatusPill';
import { EmptyState } from '../../../portal/components/EmptyState';
import { LogoLoader } from '../../../components/LogoLoader';
import { RevenueService, monthLabel, type CommissionSummary } from '../../services/RevenueService';
import { useBseData } from '../../hooks/useBseData';
import { ErrorNote } from './formBits';
import { TableScroll, TH, TD } from './BsePanel';

function tone(status: string, signature: string): 'success' | 'warning' | 'danger' | 'muted' {
  const s = status.toLowerCase();
  if (s === 'paid') return 'success';
  if (s === 'cancelled') return 'danger';
  if (signature?.toLowerCase() === 'signed') return 'success';
  return 'warning';
}

export function CommissionPage() {
  const { data, loading, error } = useBseData<CommissionSummary>(() => RevenueService.commission());

  if (loading) {
    return (
      <div className="flex min-h-[300px] items-center justify-center">
        <LogoLoader size={48} />
      </div>
    );
  }
  if (error) return <ErrorNote title="Couldn’t load commission." message={error} />;
  if (!data) return null;

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-2 rounded-token-md border border-border bg-bg-surface p-3 text-xs text-text-secondary">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
        <span>
          Read-only view of debit notes issued from the CRM’s <strong>DSA Payout</strong> screen,
          which remains where notes are generated, signed and marked paid. Cancelled notes are
          excluded from the totals.
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card padding="md" accent>
          <KpiStat label="Net payable (all notes)" value={fmt(data.totalNet)} color="var(--accent)" />
        </Card>
        <Card padding="md">
          <KpiStat label="Paid" value={fmt(data.paidNet)} color="var(--success)" />
        </Card>
        <Card padding="md">
          <KpiStat
            label="Outstanding"
            value={fmt(data.outstandingNet)}
            color={data.outstandingNet > 0 ? 'var(--warning)' : 'var(--text-primary)'}
          />
        </Card>
        <Card padding="md">
          <KpiStat label="TDS withheld" value={fmt(data.totalTds)} sub={`gross ${fmt(data.totalPayout)}`} />
        </Card>
      </div>

      <Card>
        <SectionHeader title="Debit notes" icon={Percent} />
        {data.notes.length === 0 ? (
          <EmptyState icon={Percent} title="No DSA debit notes issued yet." compact />
        ) : (
          <>
            <TableScroll>
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <TH>Note</TH>
                    <TH>DSA</TH>
                    <TH>Period</TH>
                    <TH right>Gross</TH>
                    <TH right>TDS</TH>
                    <TH right>Net</TH>
                    <TH>Issued</TH>
                    <TH>Status</TH>
                  </tr>
                </thead>
                <tbody>
                  {data.notes.map((n) => {
                    const cancelled = n.status.toLowerCase() === 'cancelled';
                    return (
                      <tr
                        key={n.id}
                        className={`hover:bg-bg-base/50 ${cancelled ? 'opacity-50' : ''}`}
                      >
                        <TD>
                          <span className="font-mono">{n.noteNumber || '—'}</span>
                        </TD>
                        <TD>
                          <span className="font-medium">{n.dsaName}</span>
                          <span className="ml-1.5 font-mono text-text-faint">{n.dsaCode}</span>
                        </TD>
                        <TD>
                          {n.month ? `${monthLabel(n.month)} ${n.year}` : '—'}
                        </TD>
                        <TD right>{fmt(n.payout)}</TD>
                        <TD right>{fmt(n.tds)}</TD>
                        <TD right>
                          <span className="font-semibold">{fmt(n.net)}</span>
                        </TD>
                        <TD>{n.generatedAt ? fmtDate(n.generatedAt) : '—'}</TD>
                        <TD>
                          <StatusPill tone={tone(n.status, n.signatureStatus)}>
                            {n.status || 'generated'}
                          </StatusPill>
                        </TD>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
            <p className="mt-3 text-[11px] text-text-faint">
              {data.notes.length} note{data.notes.length === 1 ? '' : 's'} · totals exclude cancelled
            </p>
          </>
        )}
      </Card>
    </div>
  );
}
