/**
 * Audit Log — every callback BSE has sent us, newest first.
 *
 * This is BSE's account of what happened, not ours: each row is a webhook BSE
 * fired as an order, UCC, mandate or SIP changed state. That makes it the
 * reference when a client disputes what was done, and the first place to look
 * when a status seems stuck.
 *
 * It is empty until BSE registers our callback URL — which is a configuration
 * step on their side, so the page says that rather than implying nothing has
 * happened.
 */
import { useMemo, useState } from 'react';
import { ScrollText } from 'lucide-react';
import { StatusPill } from '../../../portal/components/StatusPill';
import { EmptyState } from '../../../portal/components/EmptyState';
import { LogoLoader } from '../../../components/LogoLoader';
import { BseOpsExtra, isBseConfigured, type BseEventRow } from '../../services/BseOpsService';
import { useBseData } from '../../hooks/useBseData';
import { ErrorNote, NotConfigured } from './formBits';
import { TableScroll, TH, TD } from './BsePanel';
import { PageHead, Panel, PanelHead } from '../../ui/Surface';

/** BSE event names are lifecycle states; colour the terminal ones. */
function tone(event: string): 'success' | 'warning' | 'danger' | 'muted' {
  const e = event.toLowerCase();
  if (e === 'done' || e === 'active' || e.includes('matched') || e.includes('settled')) return 'success';
  if (e.includes('reject') || e.includes('fail') || e.includes('cancel') || e === 'suspended') return 'danger';
  if (e.includes('pending') || e.includes('awaited') || e === 'received' || e.includes('init')) return 'warning';
  return 'muted';
}

export function AuditPage() {
  const { data, loading, error, refresh } = useBseData<BseEventRow[]>(() => BseOpsExtra.events());
  const [type, setType] = useState<string>('all');

  const rows = data ?? [];
  const types = useMemo(
    () => [...new Set(rows.map((r) => r.event_type).filter(Boolean))] as string[],
    [rows],
  );
  const shown = type === 'all' ? rows : rows.filter((r) => r.event_type === type);

  if (!isBseConfigured()) return <NotConfigured title="Audit Log" />;

  return (
    <>
      <PageHead
        title="Audit Log"
        subtitle="Callbacks BSE has sent us. Empty until BSE registers our webhook URL."
      />
      <Panel>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PanelHead title="BSE event log" icon={ScrollText} />
        <div className="flex flex-wrap items-center gap-1.5">
          {types.length > 0 && (
            <>
              <button
                type="button"
                onClick={() => setType('all')}
                className={`rounded-token-md border px-2.5 py-1 text-[11px] font-semibold ${
                  type === 'all'
                    ? 'border-accent bg-accent/10 text-accent'
                    : 'border-border bg-bg-surface text-text-secondary hover:text-accent'
                }`}
              >
                All ({rows.length})
              </button>
              {types.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  className={`rounded-token-md border px-2.5 py-1 text-[11px] font-semibold ${
                    type === t
                      ? 'border-accent bg-accent/10 text-accent'
                      : 'border-border bg-bg-surface text-text-secondary hover:text-accent'
                  }`}
                >
                  {t}
                </button>
              ))}
            </>
          )}
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="rounded-token-md border border-border bg-bg-surface px-3 py-1 text-[11px] font-semibold text-text-primary hover:text-accent disabled:opacity-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading && (
        <div className="flex min-h-[240px] items-center justify-center">
          <LogoLoader size={44} />
        </div>
      )}
      {!loading && error && <ErrorNote title="Couldn’t load the event log." message={error} />}

      {!loading && !error && shown.length === 0 && (
        <>
          <EmptyState icon={ScrollText} title="No events received from BSE yet." compact />
          <p className="mx-auto mt-2 max-w-md text-center text-[11px] text-text-faint">
            Our callback endpoint is live and answering, but BSE has to register it against member
            code 66899 before they will send anything. Until they do, statuses only update when a
            screen is refreshed.
          </p>
        </>
      )}

      {!loading && !error && shown.length > 0 && (
        <>
          <TableScroll>
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <TH>Received</TH>
                  <TH>Type</TH>
                  <TH>Event</TH>
                  <TH>Client</TH>
                  <TH>Reference</TH>
                </tr>
              </thead>
              <tbody>
                {shown.map((e, i) => (
                  <tr key={`${e.request_id}-${i}`} className="hover:bg-bg-base/50">
                    <TD>
                      {e.received_at ? new Date(e.received_at).toLocaleString('en-IN') : '—'}
                    </TD>
                    <TD>{e.event_type || '—'}</TD>
                    <TD>
                      <StatusPill tone={tone(e.event ?? '')}>{e.event || 'unknown'}</StatusPill>
                    </TD>
                    <TD>
                      <span className="font-mono">{e.client_code || '—'}</span>
                    </TD>
                    <TD>
                      <span className="font-mono text-text-faint">
                        {e.order_id || e.sxp_reg_num || e.mandate_id || '—'}
                      </span>
                    </TD>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <p className="mt-3 text-[11px] text-text-faint">
            {shown.length} event{shown.length === 1 ? '' : 's'} · as reported by BSE
          </p>
        </>
      )}
    </Panel>
    </>
  );
}
