/** UCC Management — client registrations and their verification state at BSE. */
import { Hash } from 'lucide-react';
import { StatusPill } from '../../../portal/components/StatusPill';
import { BseOpsService, type BseUccRow } from '../../services/BseOpsService';
import { useBseData } from '../../hooks/useBseData';
import { BsePanel, TableScroll, TH, TD } from './BsePanel';

/** UCC lifecycle: ACTIVE is transactable; PENDING_* is mid-onboarding. */
function tone(status: string): 'success' | 'warning' | 'danger' | 'muted' {
  const s = status.toUpperCase();
  if (s === 'ACTIVE') return 'success';
  if (s.includes('REJECT') || s.includes('SUSPEND')) return 'danger';
  if (s.startsWith('PENDING')) return 'warning';
  return 'muted';
}

const HOLDING: Record<string, string> = { SI: 'Single', JO: 'Joint', AS: 'Anyone or Survivor' };

export function UccBookPage() {
  const { data, loading, error, refresh } = useBseData<BseUccRow[]>(() => BseOpsService.uccs());
  const rows = data ?? [];
  const active = rows.filter((r) => r.status.toUpperCase() === 'ACTIVE').length;

  return (
    <BsePanel
      title="UCC Management"
      icon={Hash}
      loading={loading}
      error={error}
      isEmpty={rows.length === 0}
      emptyText="No UCCs registered at BSE yet."
      onRefresh={refresh}
    >
      <TableScroll>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <TH>Client Code</TH>
              <TH>Name</TH>
              <TH>PAN</TH>
              <TH>Holding</TH>
              <TH>PAN Verified</TH>
              <TH>Status</TH>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.clientCode} className="hover:bg-bg-base/50">
                <TD>
                  <span className="font-mono">{u.clientCode}</span>
                </TD>
                <TD>{u.name || '—'}</TD>
                <TD>
                  <span className="font-mono">{u.pan || '—'}</span>
                </TD>
                <TD>{HOLDING[u.holdingNature] ?? u.holdingNature ?? '—'}</TD>
                <TD>
                  {u.isPanExempt ? (
                    // Nothing is outstanding for an exempt holder — "Pending"
                    // would be a permanent, misleading state.
                    <StatusPill tone="muted">Exempt</StatusPill>
                  ) : (
                    <StatusPill tone={u.isPanVerified ? 'success' : 'warning'}>
                      {u.isPanVerified ? 'Yes' : 'Pending'}
                    </StatusPill>
                  )}
                </TD>
                <TD>
                  <StatusPill tone={tone(u.status)}>{u.status || 'unknown'}</StatusPill>
                </TD>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <p className="mt-3 text-[11px] text-text-faint">
        {rows.length} UCC{rows.length === 1 ? '' : 's'} · {active} active and able to transact
      </p>
    </BsePanel>
  );
}
