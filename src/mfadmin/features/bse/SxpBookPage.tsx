/**
 * Systematic plans book (SIP / SWP / STP). One component serves the SIP, STP
 * and SWP nav views — `only` filters to a single plan kind.
 */
import { CalendarClock, type LucideIcon } from 'lucide-react';
import { fmt, fmtDate } from '../../../crm/utils';
import { StatusPill } from '../../../portal/components/StatusPill';
import { BseOpsService, type BseSxpRow } from '../../services/BseOpsService';
import { useBseData } from '../../hooks/useBseData';
import { BsePanel, TableScroll, TH, TD } from './BsePanel';

const FREQ: Record<string, string> = {
  m: 'Monthly',
  w: 'Weekly',
  d: 'Daily',
  f: 'Fortnightly',
  q: 'Quarterly',
  h: 'Half-yearly',
  y: 'Yearly',
};

/** SXP lifecycle: active is running; investor_auth_awaited needs the client's 2FA. */
function tone(status: string): 'success' | 'warning' | 'danger' | 'muted' {
  const s = status.toLowerCase();
  if (s === 'active') return 'success';
  if (s.includes('cancel') || s.includes('reject')) return 'danger';
  if (s.includes('awaited') || s.includes('pending') || s.includes('paused')) return 'warning';
  return 'muted';
}

interface Props {
  title: string;
  icon?: LucideIcon;
  /** Restrict to one plan kind (SIP / STP / SWP); omit to show all. */
  only?: string;
}

export function SxpBookPage({ title, icon = CalendarClock, only }: Props) {
  const { data, loading, error, refresh } = useBseData<BseSxpRow[]>(() => BseOpsService.sxp());
  const all = data ?? [];
  const rows = only ? all.filter((r) => (r.type || '').toUpperCase() === only.toUpperCase()) : all;
  const active = rows.filter((r) => r.status.toLowerCase() === 'active').length;

  return (
    <BsePanel
      title={title}
      icon={icon}
      loading={loading}
      error={error}
      isEmpty={rows.length === 0}
      emptyText={`No ${only ?? 'systematic'} registrations at BSE yet.`}
      onRefresh={refresh}
    >
      <TableScroll>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <TH>Registration</TH>
              <TH>UCC</TH>
              <TH>Scheme</TH>
              {!only && <TH>Type</TH>}
              <TH right>Amount</TH>
              <TH>Frequency</TH>
              <TH>Starts</TH>
              <TH>Status</TH>
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.sxpRegNum} className="hover:bg-bg-base/50">
                <TD>
                  <span className="font-mono">{s.sxpRegNum}</span>
                </TD>
                <TD>{s.clientCode || '—'}</TD>
                <TD>{s.schemeCode || '—'}</TD>
                {!only && <TD>{s.type || '—'}</TD>}
                <TD right>{fmt(s.amount)}</TD>
                <TD>{FREQ[s.frequency] ?? s.frequency ?? '—'}</TD>
                <TD>{s.startDate ? fmtDate(s.startDate) : '—'}</TD>
                <TD>
                  <StatusPill tone={tone(s.status)}>{s.status || 'unknown'}</StatusPill>
                </TD>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <p className="mt-3 text-[11px] text-text-faint">
        {rows.length} registration{rows.length === 1 ? '' : 's'} · {active} active
      </p>
    </BsePanel>
  );
}
