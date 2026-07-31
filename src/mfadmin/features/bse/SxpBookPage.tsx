/**
 * Systematic plans book (SIP / SWP / STP).
 *
 * One component serves the three nav views — `only` filters to a single plan
 * kind, and the copy adapts so an empty SWP screen doesn't read as "no SIPs".
 */
import { useMemo } from 'react';
import { type LucideIcon } from 'lucide-react';
import { BseOpsService, isBseConfigured, type BseSxpRow } from '../../services/BseOpsService';
import { useBseData } from '../../hooks/useBseData';
import { Chip, PageHead, StatTile } from '../../ui/Surface';
import { DataTable, type Column } from '../../ui/DataTable';
import { ErrorBlock, Loading } from '../../ui/controls';
import { NotConfigured } from './formBits';
import { humanise, inr, inrCompact, num, shortDate } from '../../ui/format';

const FREQ: Record<string, string> = {
  m: 'Monthly',
  w: 'Weekly',
  d: 'Daily',
  f: 'Fortnightly',
  q: 'Quarterly',
  h: 'Half-yearly',
  y: 'Yearly',
};

/** SXP lifecycle: active is running; *_auth_awaited needs the investor's 2FA. */
function sxpTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  const s = (status || '').toLowerCase();
  if (s === 'active') return 'success';
  if (s.includes('cancel') || s.includes('reject')) return 'danger';
  if (s.includes('awaited') || s.includes('pending') || s.includes('paused')) return 'warning';
  return 'neutral';
}

interface Props {
  title: string;
  icon?: LucideIcon;
  /** Restrict to one plan kind (SIP / STP / SWP); omit to show all. */
  only?: string;
}

export function SxpBookPage({ title, only }: Props) {
  const { data, loading, error, refresh } = useBseData<BseSxpRow[]>(() => BseOpsService.sxp());
  const rows = useMemo(() => {
    const all = data ?? [];
    return only ? all.filter((r) => (r.type || '').toUpperCase() === only.toUpperCase()) : all;
  }, [data, only]);

  const stats = useMemo(() => {
    const active = rows.filter((r) => r.status.toLowerCase() === 'active');
    const awaiting = rows.filter((r) => /awaited|pending/i.test(r.status)).length;
    return {
      total: rows.length,
      active: active.length,
      // Only active plans actually collect, so committing the pending ones
      // into this figure would overstate the book.
      committed: active.reduce((s, r) => s + (r.amount || 0), 0),
      awaiting,
    };
  }, [rows]);

  const kind = only ?? 'systematic plan';

  const cols: Column<BseSxpRow>[] = [
    {
      key: 'reg',
      header: 'Registration',
      value: (r) => r.sxpRegNum,
      render: (r) => <span className="font-mono text-text-primary">{r.sxpRegNum}</span>,
    },
    {
      key: 'ucc',
      header: 'Client',
      value: (r) => r.clientCode,
      render: (r) => <span className="font-mono">{r.clientCode || '—'}</span>,
    },
    {
      key: 'scheme',
      header: 'Scheme',
      value: (r) => r.schemeCode,
      render: (r) => <span className="font-mono text-text-secondary">{r.schemeCode || '—'}</span>,
    },
    ...(!only
      ? [
          {
            key: 'type',
            header: 'Type',
            value: (r: BseSxpRow) => r.type,
            render: (r: BseSxpRow) => <Chip>{r.type || '—'}</Chip>,
          } as Column<BseSxpRow>,
        ]
      : []),
    {
      key: 'amount',
      header: 'Amount',
      numeric: true,
      value: (r) => r.amount,
      render: (r) => <span className="font-semibold text-text-primary">{inr(r.amount)}</span>,
    },
    {
      key: 'freq',
      header: 'Frequency',
      value: (r) => FREQ[r.frequency] ?? r.frequency,
      render: (r) => FREQ[r.frequency] ?? r.frequency ?? '—',
    },
    {
      key: 'start',
      header: 'Starts',
      value: (r) => r.startDate,
      render: (r) => <span className="whitespace-nowrap">{shortDate(r.startDate)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      value: (r) => r.status,
      render: (r) => <Chip tone={sxpTone(r.status)}>{humanise(r.status) || 'Unknown'}</Chip>,
    },
  ];

  if (!isBseConfigured()) return <NotConfigured title={title} />;

  return (
    <>
      <PageHead
        title={title}
        subtitle={`Registrations at BSE StAR MF${only ? ` — ${only} only` : ''}.`}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Registrations" value={num(stats.total)} />
        <StatTile
          label="Active"
          value={num(stats.active)}
          tone={stats.active > 0 ? 'positive' : 'default'}
        />
        <StatTile
          label="Committed per cycle"
          value={inrCompact(stats.committed)}
          sub="active plans only"
        />
        <StatTile
          label="Awaiting investor"
          value={num(stats.awaiting)}
          tone={stats.awaiting > 0 ? 'warning' : 'default'}
          sub={stats.awaiting > 0 ? 'Needs the 2FA approval link' : undefined}
        />
      </div>

      {loading && <Loading label="Loading systematic plans from BSE…" />}
      {!loading && error && <ErrorBlock message={error} onRetry={refresh} />}
      {!loading && !error && (
        <DataTable
          rows={rows}
          columns={cols}
          rowKey={(r) => r.sxpRegNum}
          searchPlaceholder="Search by registration, client, scheme or status…"
          empty={{
            title: `No ${kind} registrations yet`,
            hint: `Registering a ${kind} needs an ACTIVE UCC, and an XSIP additionally needs a mandate the investor has authorised.`,
          }}
        />
      )}
    </>
  );
}
