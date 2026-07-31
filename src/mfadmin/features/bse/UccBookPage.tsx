/**
 * UCC Book — client registrations at BSE and their verification state.
 *
 * A UCC that is not ACTIVE cannot transact, so status is the column that
 * matters and it earns the right-hand anchor position.
 */
import { useMemo } from 'react';
import { BseOpsService, isBseConfigured, type BseUccRow } from '../../services/BseOpsService';
import { useBseData } from '../../hooks/useBseData';
import { Chip, PageHead, StatTile } from '../../ui/Surface';
import { DataTable, type Column } from '../../ui/DataTable';
import { ErrorBlock, Loading } from '../../ui/controls';
import { NotConfigured } from './formBits';
import { humanise, num } from '../../../lib/money';

const HOLDING: Record<string, string> = { SI: 'Single', JO: 'Joint', AS: 'Anyone or Survivor' };

/** UCC lifecycle: ACTIVE transacts; PENDING_* is mid-onboarding. */
function uccTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  const s = (status || '').toUpperCase();
  if (s === 'ACTIVE') return 'success';
  if (s.includes('REJECT') || s.includes('SUSPEND')) return 'danger';
  if (s.startsWith('PENDING')) return 'warning';
  return 'neutral';
}

export function UccBookPage() {
  const { data, loading, error, refresh } = useBseData<BseUccRow[]>(() => BseOpsService.uccs());
  const rows = useMemo(() => data ?? [], [data]);

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.status.toUpperCase() === 'ACTIVE').length;
    const pending = rows.filter((r) => r.status.toUpperCase().startsWith('PENDING')).length;
    return { total: rows.length, active, pending };
  }, [rows]);

  const cols: Column<BseUccRow>[] = [
    {
      key: 'clientCode',
      header: 'Client code',
      value: (r) => r.clientCode,
      render: (r) => <span className="font-mono text-text-primary">{r.clientCode}</span>,
    },
    {
      key: 'name',
      header: 'Name',
      value: (r) => r.name,
      render: (r) => <span className="font-medium text-text-primary">{r.name || '—'}</span>,
    },
    {
      key: 'pan',
      header: 'PAN',
      value: (r) => r.pan,
      render: (r) => <span className="font-mono">{r.pan || '—'}</span>,
    },
    {
      key: 'holding',
      header: 'Holding',
      value: (r) => HOLDING[r.holdingNature] ?? r.holdingNature,
      render: (r) => HOLDING[r.holdingNature] ?? r.holdingNature ?? '—',
    },
    {
      key: 'panVerified',
      header: 'PAN check',
      value: (r) => (r.isPanExempt ? 'exempt' : r.isPanVerified ? 'verified' : 'pending'),
      render: (r) =>
        // Nothing is outstanding for an exempt holder — "Pending" would be a
        // permanent and misleading state.
        r.isPanExempt ? (
          <Chip>Exempt</Chip>
        ) : (
          <Chip tone={r.isPanVerified ? 'success' : 'warning'}>
            {r.isPanVerified ? 'Verified' : 'Pending'}
          </Chip>
        ),
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      value: (r) => r.status,
      render: (r) => <Chip tone={uccTone(r.status)}>{humanise(r.status) || 'Unknown'}</Chip>,
    },
  ];

  if (!isBseConfigured()) return <NotConfigured title="UCC Book" />;

  return (
    <>
      <PageHead
        title="UCC Book"
        subtitle="Every client registered under the NIYOM member code, with their verification state."
      />

      <div className="mb-5 grid grid-cols-3 gap-3">
        <StatTile label="Registered" value={num(stats.total)} />
        <StatTile
          label="Able to transact"
          value={num(stats.active)}
          tone={stats.active > 0 ? 'positive' : 'default'}
        />
        <StatTile
          label="Mid-onboarding"
          value={num(stats.pending)}
          tone={stats.pending > 0 ? 'warning' : 'default'}
          sub={stats.pending > 0 ? 'See KYC for what is blocking each' : undefined}
        />
      </div>

      {loading && <Loading label="Loading the UCC book from BSE…" />}
      {!loading && error && <ErrorBlock message={error} onRetry={refresh} />}
      {!loading && !error && (
        <DataTable
          rows={rows}
          columns={cols}
          rowKey={(r) => r.clientCode}
          searchPlaceholder="Search by client code, name, PAN or status…"
          empty={{
            title: 'No UCCs registered yet',
            hint: 'Register a client from Clients → Client Management. Registration is what creates a UCC at BSE.',
          }}
        />
      )}
    </>
  );
}
