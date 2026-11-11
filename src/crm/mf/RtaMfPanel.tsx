import { useEffect, useState, type ReactNode } from 'react';
import { ArrowLeftRight, Repeat, Wallet } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { LogoLoader } from '../../components/LogoLoader';
import { fmt, fmtDate } from '../utils';
import { fetchRtaMf, fetchRtaTransactions, rtaAsOfLabel, type RtaMfData } from '../../../shared/mf/rtaMf';
import type { NWTransaction } from '../types';

/**
 * A client's mutual funds as the REGISTRAR reports them — holdings and live
 * SIP/STP/SWP registrations pulled daily from the CAMS/KFintech mailback feeds.
 *
 * Read-only on purpose, like the CAS panel it sits beside: this is the
 * registrar's own record, refreshed automatically, not the in-house book. Staff
 * editing it would only make it disagree with the feed it came from. For an RM
 * it answers "what does this client actually hold in MF, and what's running?"
 */
export function RtaMfPanel({ clientId }: { clientId: string }) {
  const [data, setData] = useState<RtaMfData | null>(null);
  const [txns, setTxns] = useState<NWTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    // Last 5 registrar transactions alongside; best-effort (returns [] on failure).
    fetchRtaTransactions(supabase, clientId, 5).then((t) => alive && setTxns(t));
    fetchRtaMf(supabase, clientId)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : 'Could not load registrar MF.'))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [clientId]);

  const shell = (children: ReactNode) => (
    <div className="rounded-2xl p-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
      {children}
    </div>
  );

  if (loading) return shell(<div className="flex justify-center py-6"><LogoLoader size={32} /></div>);
  if (error) return shell(<p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>);
  if (!data || !data.hasData) {
    return shell(
      <div className="flex items-center gap-3">
        <Wallet className="h-5 w-5" style={{ color: 'var(--text-secondary)' }} />
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          No mutual funds in the registrar feed for this client yet. Folios link by PAN once a feed arrives.
        </p>
      </div>,
    );
  }

  const active = data.sips.filter((s) => s.status === 'active');

  const asOf = rtaAsOfLabel(data, fmtDate);
  return shell(
    <div className="space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-text-primary">Mutual Funds — registrar feed</h3>
          <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            From CAMS/KFintech, updated daily{asOf ? ` · ${asOf}` : ''}
          </p>
        </div>
        <div className="text-right">
          <p className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Value</p>
          <p className="font-bold text-text-primary">{fmt(data.totalValue)}</p>
        </div>
      </div>

      {data.holdings.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: 'var(--text-secondary)' }} className="text-left text-[11px] uppercase tracking-wider">
                <th className="py-2 pr-3 font-medium">Scheme</th>
                <th className="py-2 px-3 font-medium">Folio</th>
                <th className="py-2 px-3 font-medium">Since</th>
                <th className="py-2 px-3 font-medium text-right">Units</th>
                <th className="py-2 px-3 font-medium text-right">Invested</th>
                <th className="py-2 pl-3 font-medium text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {data.holdings.map((h) => (
                <tr key={h.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td className="py-2 pr-3 text-text-primary">{h.schemeName ?? h.schemeCode}</td>
                  <td className="py-2 px-3" style={{ color: 'var(--text-secondary)' }}>{h.folio}</td>
                  <td className="py-2 px-3" style={{ color: 'var(--text-secondary)' }}>{h.firstInvestmentDate ? fmtDate(h.firstInvestmentDate) : '—'}</td>
                  <td className="py-2 px-3 text-right text-text-primary">{h.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })}</td>
                  <td className="py-2 px-3 text-right" style={{ color: 'var(--text-secondary)' }}>{h.investedCost != null ? fmt(h.investedCost) : '—'}</td>
                  <td className="py-2 pl-3 text-right text-text-primary">{fmt(h.rtaValue ?? h.navValue ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {txns.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <ArrowLeftRight className="h-4 w-4" style={{ color: 'var(--accent)' }} />
            <h4 className="text-xs font-bold text-text-primary">Recent transactions (last {txns.length})</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--text-secondary)' }} className="text-left text-[11px] uppercase tracking-wider">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 px-3 font-medium">Scheme</th>
                  <th className="py-2 px-3 font-medium">Type</th>
                  <th className="py-2 px-3 font-medium text-right">Units</th>
                  <th className="py-2 pl-3 font-medium text-right">Amount</th>
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="py-2 pr-3" style={{ color: 'var(--text-secondary)' }}>{fmtDate(t.txn_date)}</td>
                    <td className="py-2 px-3 text-text-primary">{t.product_name}</td>
                    <td className="py-2 px-3" style={{ color: t.txn_type === 'sell' ? 'var(--danger)' : 'var(--success)' }}>{t.notes}</td>
                    <td className="py-2 px-3 text-right" style={{ color: 'var(--text-secondary)' }}>
                      {t.quantity != null ? t.quantity.toLocaleString('en-IN', { maximumFractionDigits: 3 }) : '—'}
                    </td>
                    <td className="py-2 pl-3 text-right text-text-primary">{fmt(t.consolidated_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {active.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <Repeat className="h-4 w-4" style={{ color: 'var(--accent)' }} />
            <h4 className="text-xs font-bold text-text-primary">Active systematic plans ({active.length})</h4>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--text-secondary)' }} className="text-left text-[11px] uppercase tracking-wider">
                  <th className="py-2 pr-3 font-medium">Scheme</th>
                  <th className="py-2 px-3 font-medium">Type</th>
                  <th className="py-2 px-3 font-medium text-right">Amount</th>
                  <th className="py-2 px-3 font-medium">Frequency</th>
                  <th className="py-2 pl-3 font-medium">Next / day</th>
                </tr>
              </thead>
              <tbody>
                {active.map((s) => (
                  <tr key={s.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="py-2 pr-3 text-text-primary">{s.schemeName ?? s.schemeCode}</td>
                    <td className="py-2 px-3" style={{ color: 'var(--text-secondary)' }}>{s.type ?? 'SIP'}</td>
                    <td className="py-2 px-3 text-right text-text-primary">{s.amount != null ? fmt(s.amount) : '—'}</td>
                    <td className="py-2 px-3" style={{ color: 'var(--text-secondary)' }}>{s.frequency ?? '—'}</td>
                    <td className="py-2 pl-3" style={{ color: 'var(--text-secondary)' }}>{s.sipDay ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>,
  );
}
