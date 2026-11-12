import { Fragment, useEffect, useState } from 'react';
import { Landmark } from 'lucide-react';
import { LogoLoader } from '../components/LogoLoader';
import { fmt, fmtDate } from './utils';
import { loadDematView, type DematCrmView } from './services/dematClientView';

/**
 * What the client's demat statement (eCAS) says they hold — stocks, ETFs,
 * bonds, G-secs and the rest — once they import it from their portal.
 *
 * Read-only and beside the book, exactly like the CAS panel above it: these are
 * the client's holdings wherever they were bought, not business we booked, so
 * they stay out of nw_holdings and out of every AUM and MIS figure.
 */
export function DematHoldingsPanel({ clientId }: { clientId: string }) {
  const [view, setView] = useState<DematCrmView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void loadDematView(clientId)
      .then((v) => alive && setView(v))
      .catch(() => alive && setView(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [clientId]);

  return <DematHoldingsView view={view} loading={loading} />;
}

/** The panel from data alone, for a page that has already loaded the statement. */
export function DematHoldingsView({ view, loading = false }: { view: DematCrmView | null; loading?: boolean }) {
  if (loading) {
    return (
      <div className="rounded-2xl p-8 flex justify-center" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <LogoLoader size={32} />
      </div>
    );
  }

  if (!view) {
    return (
      <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <Landmark className="mx-auto mb-2 h-6 w-6" style={{ color: 'var(--border-strong)' }} />
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          No demat statement imported yet.
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs" style={{ color: 'var(--text-faint)' }}>
          The client imports this from their portal — it shows the stocks, ETFs, bonds and other
          securities in their demat accounts. Only the investor can request one.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-bold text-text-primary">
            <Landmark className="h-4 w-4" style={{ color: 'var(--accent)' }} />
            From the client's demat statement
          </h3>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-faint)' }}>
            {view.statementDate ? `As at ${fmtDate(view.statementDate)}` : 'Imported statement'}
            {view.issuedBy ? ` · ${view.issuedBy} eCAS` : ''}
            {' · '}
            {view.holdingCount} holding{view.holdingCount === 1 ? '' : 's'}
            {view.importedAt ? ` · imported ${fmtDate(view.importedAt)}` : ''}
          </p>
        </div>
        <div className="flex items-start gap-4">
          <div className="text-right">
            <p className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>Statement value</p>
            <p className="text-lg font-bold tabular-nums" style={{ color: 'var(--accent)' }}>{fmt(view.totalValue)}</p>
          </div>
          <span
            className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold"
            style={{ color: 'var(--text-faint)', borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
            title="A statement is the client's own record. It is shown here for reference and is not editable."
          >
            Read only
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full nw-table">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {['Security', 'Demat account', 'Quantity', 'Price', 'Value'].map((h) => (
                <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.groups.map((g) => (
              <Fragment key={g.key}>
                <tr style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)' }}>
                  <td colSpan={4} className="px-5 py-2 text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                    {g.label} <span style={{ color: 'var(--text-faint)' }}>· {g.holdings.length}</span>
                  </td>
                  <td className="px-5 py-2 text-xs font-bold tabular-nums" style={{ color: 'var(--text-secondary)' }}>{fmt(g.value)}</td>
                </tr>
                {g.holdings.map((h) => (
                  <tr key={h.id} style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                    <td className="px-5 py-3">
                      <p className="text-sm font-medium text-text-primary">{h.name}</p>
                      {h.isin && <p className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>{h.isin}</p>}
                    </td>
                    <td className="px-5 py-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
                      <p>{[h.depository, h.dpName].filter(Boolean).join(' · ') || '—'}</p>
                      {h.boId && <p className="font-mono text-[11px]" style={{ color: 'var(--text-faint)' }}>{h.boId}</p>}
                    </td>
                    <td className="px-5 py-3 text-sm tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                      {h.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })}
                    </td>
                    <td className="px-5 py-3 text-sm tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                      {h.price ? h.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—'}
                    </td>
                    <td className="px-5 py-3 text-sm font-bold tabular-nums text-text-primary">{fmt(h.value)}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <p className="px-5 py-3 text-[11px]" style={{ color: 'var(--text-faint)', borderTop: '1px solid var(--border-subtle)' }}>
        A demat statement is a snapshot: it carries quantity and value as on its date, with no purchase cost, so no gain is shown.
        {view.dematMfValue > 0 &&
          ` Mutual funds held in demat (${fmt(view.dematMfValue)}) may also appear in the mutual fund statement above — do not add the two.`}
      </p>
    </div>
  );
}
