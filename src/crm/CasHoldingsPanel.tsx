import { useEffect, useState } from 'react';
import { Circle, FileText, HelpCircle, ShieldCheck } from 'lucide-react';
import { LogoLoader } from '../components/LogoLoader';
import { fmt, fmtDate } from './utils';
import { loadCasView, type CasCrmScheme, type CasCrmView } from './services/casClientView';
import { MF_OWNERSHIP, MF_OWNERSHIP_PRESENTATION } from '../portal/types/ownership';

/**
 * What the client's own statement says they hold.
 *
 * Sits BESIDE the holdings table, never inside it, and carries no edit or
 * delete controls. Both are deliberate. The table above is the book of what we
 * sold — editable, priced, and what MIS and AUM are computed from. This is
 * evidence the client supplied, covering funds we may have had nothing to do
 * with, and staff correcting it would only make it disagree with the document
 * it came from.
 *
 * The held-away total is the point of the panel for an RM: it is the money this
 * client has with someone else, sized and named, which is the conversation the
 * "held-away assets detected" alert exists to start.
 */
export function CasHoldingsPanel({ clientId }: { clientId: string }) {
  const [view, setView] = useState<CasCrmView | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void loadCasView(clientId)
      .then((v) => alive && setView(v))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [clientId]);

  return <CasHoldingsView view={view} loading={loading} />;
}

/**
 * The panel itself, from data alone.
 *
 * Separated from the loading shell above so it can be rendered without a
 * database — the fetch is one line and the presentation is the part with
 * decisions in it (which totals matter, how ownership reads, what an empty
 * state should say).
 */
export function CasHoldingsView({
  view,
  loading = false,
}: {
  view: CasCrmView | null;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <div className="rounded-2xl p-8 flex justify-center" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <LogoLoader size={32} />
      </div>
    );
  }

  // No statement imported: say what would appear here rather than showing an
  // empty table, and say who can start it — only the client can.
  if (!view) {
    return (
      <div className="rounded-2xl p-6 text-center" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <FileText className="mx-auto mb-2 h-6 w-6" style={{ color: 'var(--border-strong)' }} />
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          No Consolidated Account Statement imported yet.
        </p>
        <p className="mx-auto mt-1 max-w-md text-xs" style={{ color: 'var(--text-faint)' }}>
          The client imports this from their portal — it shows every mutual fund they hold,
          including funds bought through other distributors. Only the investor can request one.
        </p>
      </div>
    );
  }

  const gain = view.totalValue - view.totalCost;

  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
      {/* ---------------------------------------------------------- header */}
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-bold text-text-primary">
            <FileText className="h-4 w-4" style={{ color: 'var(--accent)' }} />
            From the client's statement
          </h3>
          <p className="mt-0.5 text-xs" style={{ color: 'var(--text-faint)' }}>
            {view.statementTo ? `As at ${fmtDate(view.statementTo)}` : 'Imported statement'}
            {' · '}
            {view.schemeCount} schemes, {view.transactionCount} transactions
            {view.importedAt ? ` · imported ${fmtDate(view.importedAt)}` : ''}
          </p>
        </div>
        <span
          className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold"
          style={{ color: 'var(--text-faint)', borderColor: 'var(--border)', background: 'var(--bg-surface)' }}
          title="A statement is the client's own record. It is shown here for reference and is not editable."
        >
          Read only
        </span>
      </div>

      {/* ----------------------------------------------------------- totals */}
      <div className="grid grid-cols-2 gap-4 px-5 py-4 sm:grid-cols-4" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <Stat label="Statement value" value={fmt(view.totalValue)} accent />
        <Stat label="Cost" value={fmt(view.totalCost)} />
        <Stat
          label={gain >= 0 ? 'Gain' : 'Loss'}
          value={`${gain >= 0 ? '+' : ''}${fmt(gain)}`}
          color={gain >= 0 ? 'var(--success)' : 'var(--danger)'}
        />
        {/* The number an RM is here for. */}
        <Stat
          label="Held elsewhere"
          value={view.heldAwayCount ? fmt(view.heldAwayValue) : '—'}
          sub={view.heldAwayCount ? `${view.heldAwayCount} scheme${view.heldAwayCount === 1 ? '' : 's'}` : 'none'}
          color={view.heldAwayValue > 0 ? 'var(--warning)' : undefined}
        />
      </div>

      {/* ---------------------------------------------------------- schemes */}
      <div className="overflow-x-auto">
        <table className="w-full nw-table">
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
              {['Scheme', 'Folio', 'Units', 'NAV', 'Cost', 'Value', 'P&L', 'Sits with'].map((h) => (
                <th key={h} className="px-5 py-3 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {view.schemes.map((s) => (
              <SchemeRow key={s.id} s={s} />
            ))}
          </tbody>
        </table>
      </div>

      <p className="px-5 py-3 text-[11px]" style={{ color: 'var(--text-faint)', borderTop: '1px solid var(--border-subtle)' }}>
        Every figure was checked against the totals printed on the statement before it was accepted.
        Funds the client has fully exited are excluded from this list but retained for capital gains.
      </p>
    </div>
  );
}

function SchemeRow({ s }: { s: CasCrmScheme }) {
  const up = s.gain >= 0;
  const own = MF_OWNERSHIP_PRESENTATION[s.ownership];
  const Icon =
    s.ownership === MF_OWNERSHIP.heldWithNiyom
      ? ShieldCheck
      : s.ownership === MF_OWNERSHIP.heldAway
        ? Circle
        : HelpCircle;

  return (
    <tr style={{ borderBottom: '1px solid var(--bg-raised)' }}>
      <td className="px-5 py-3">
        <p className="text-sm font-medium text-text-primary">{s.name}</p>
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          {[s.amc, s.registrar].filter(Boolean).join(' · ')}
          {s.isin ? ` · ${s.isin}` : ''}
        </p>
      </td>
      <td className="px-5 py-3 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{s.folioNumber || '—'}</td>
      <td className="px-5 py-3 text-sm tabular-nums" style={{ color: 'var(--text-secondary)' }}>{s.units.toFixed(3)}</td>
      <td className="px-5 py-3 text-sm tabular-nums" style={{ color: 'var(--text-secondary)' }}>{s.nav ? s.nav.toFixed(4) : '—'}</td>
      <td className="px-5 py-3 text-sm tabular-nums" style={{ color: 'var(--text-secondary)' }}>{fmt(s.cost)}</td>
      <td className="px-5 py-3 text-sm font-bold tabular-nums text-text-primary">{fmt(s.value)}</td>
      <td className="px-5 py-3">
        <p className="text-sm font-bold tabular-nums" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>
          {up ? '+' : ''}{fmt(s.gain)}
        </p>
        <p className="text-[11px] tabular-nums" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>
          {up ? '+' : ''}{s.gainPercent.toFixed(1)}%
        </p>
      </td>
      <td className="px-5 py-3">
        {/*
          The advisor code is shown verbatim next to the label. An RM chasing a
          migration needs to know WHICH distributor holds it, not just that
          someone else does.
        */}
        <span
          className="inline-flex items-center gap-1 text-xs font-semibold"
          style={{ color: s.ownership === MF_OWNERSHIP.heldWithNiyom ? 'var(--success)' : 'var(--text-muted)' }}
          title={own.hint}
        >
          <Icon className="h-3 w-3" />
          {own.label}
        </span>
        {s.advisorCode && s.ownership !== MF_OWNERSHIP.heldWithNiyom && (
          <p className="mt-0.5 font-mono text-[11px]" style={{ color: 'var(--text-faint)' }}>{s.advisorCode}</p>
        )}
      </td>
    </tr>
  );
}

function Stat({
  label,
  value,
  sub,
  color,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  accent?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{label}</p>
      <p
        className="mt-0.5 truncate text-lg font-bold tabular-nums"
        style={{ color: color ?? (accent ? 'var(--accent)' : 'var(--text-primary)') }}
      >
        {value}
      </p>
      {sub && <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{sub}</p>}
    </div>
  );
}
