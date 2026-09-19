import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Loader2, RotateCcw, Search, Undo2, X } from 'lucide-react';
import { LogoLoader } from '../components/LogoLoader';
import { supabase } from '../lib/supabase';

// ===========================================================================
// Reverse a transfer approved by mistake — ADMIN ONLY (admin / super_admin;
// the Transfer-Queue-only login cannot undo). The work is done by the
// nw_reverse_transfer RPC, which re-checks the role, keeps the deal and its
// payments, returns it to the queue, and records a 'transfer_reversed' event.
// ===========================================================================

interface TransferredRow {
  deal_id: string;
  confirmation_number: string;
  client_name: string;
  client_code: string;
  references: string[];
  securities: string[];
  amount: number;
  transferred_at: string | null;
  transferred_by: string | null;
}

const inr = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDateTime = (d: string | null) => d
  ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : '—';

/** Call the RPC. Returns the reversed references. */
async function reverseTransfer(dealId: string, reason: string): Promise<string[]> {
  const { data, error } = await supabase.rpc('nw_reverse_transfer', { p_deal_id: dealId, p_reason: reason });
  if (error) throw new Error(error.message);
  return ((data as { reversed_references?: string[] } | null)?.reversed_references) ?? [];
}

/** The confirm dialog, shared by the history list and the success screen. */
export function ReverseTransferDialog({ dealLabel, clientName, references, onCancel, onDone, dealId }: {
  dealId: string;
  dealLabel: string;
  clientName: string;
  references: string[];
  onCancel: () => void;
  onDone: (refs: string[]) => void;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const go = async () => {
    if (reason.trim().length < 3) { setError('Give a reason for reversing this transfer.'); return; }
    setBusy(true); setError('');
    try {
      onDone(await reverseTransfer(dealId, reason.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reverse the transfer.');
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <div className="px-6 py-5 space-y-3">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-base font-bold text-text-primary">Reverse this transfer?</h3>
            <button onClick={onCancel} disabled={busy} style={{ color: 'var(--text-faint)' }}><X className="w-4 h-4" /></button>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            <span className="font-mono">{references.join(', ') || '—'}</span> · {dealLabel} · {clientName}
          </p>
          <ul className="text-xs space-y-1.5 list-disc pl-4" style={{ color: 'var(--text-secondary)' }}>
            <li>The deal goes back to the Transfer Queue as not yet transferred. Its payments are kept.</li>
            <li>A line booked before the transfer returns to pending. A line the transfer created is removed, and the client's holding is reduced by it.</li>
            <li>The original transfer and this reversal both stay in the deal's audit trail.</li>
            <li><b>The closure email already sent to the client cannot be recalled.</b></li>
          </ul>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>
              Reason <span style={{ color: 'var(--accent)' }}>*</span>
            </label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} disabled={busy}
              placeholder="e.g. Approved by mistake — client acceptance still pending"
              className="w-full px-3 py-2 rounded-xl text-sm text-text-primary outline-none"
              style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }} />
          </div>
          {error && (
            <div className="rounded-xl px-3 py-2 text-sm flex items-start gap-2"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--danger)' }}>
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" /><span>{error}</span>
            </div>
          )}
        </div>
        <div className="px-6 py-4 flex justify-end gap-2" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onCancel} disabled={busy} className="px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            Cancel
          </button>
          <button onClick={go} disabled={busy} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60"
            style={{ background: 'rgba(239,68,68,0.15)', color: 'rgb(239,68,68)', border: '1px solid rgba(239,68,68,0.4)' }}>
            {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Reversing…</> : <><Undo2 className="w-4 h-4" /> Reverse transfer</>}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Recently transferred deals, each with a Reverse button. */
export default function TransferHistory({ onReversed }: { onReversed?: () => void }) {
  const [rows, setRows] = useState<TransferredRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [target, setTarget] = useState<TransferredRow | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    const { data, error: qErr } = await supabase
      .from('nw_transactions')
      .select(`deal_confirmation_id, transfer_reference, product_name, consolidated_amount, transferred_at,
               client:nw_clients!nw_transactions_client_id_fkey(full_name, client_code),
               deal:nw_deal_confirmations!nw_transactions_deal_confirmation_id_fkey(confirmation_number),
               by:nw_employees!nw_transactions_transferred_by_fkey(full_name)`)
      .eq('transfer_stage', 'transferred')
      .not('deal_confirmation_id', 'is', null)
      .order('transferred_at', { ascending: false })
      .limit(300);
    if (qErr) { setError(qErr.message); setLoading(false); return; }

    // One row per deal (a multi-line deal has one transaction per line).
    const byDeal = new Map<string, TransferredRow>();
    for (const t of (data ?? []) as unknown as {
      deal_confirmation_id: string; transfer_reference: string | null; product_name: string;
      consolidated_amount: number; transferred_at: string | null;
      client: { full_name: string; client_code: string } | null;
      deal: { confirmation_number: string } | null;
      by: { full_name: string } | null;
    }[]) {
      const cur = byDeal.get(t.deal_confirmation_id) ?? {
        deal_id: t.deal_confirmation_id,
        confirmation_number: t.deal?.confirmation_number ?? '—',
        client_name: t.client?.full_name ?? '—',
        client_code: t.client?.client_code ?? '',
        references: [], securities: [], amount: 0,
        transferred_at: t.transferred_at, transferred_by: t.by?.full_name ?? null,
      };
      if (t.transfer_reference) cur.references.push(t.transfer_reference);
      cur.securities.push(t.product_name);
      cur.amount += Number(t.consolidated_amount || 0);
      byDeal.set(t.deal_confirmation_id, cur);
    }
    setRows([...byDeal.values()].slice(0, 100));
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const q = search.trim().toLowerCase();
  const shown = q
    ? rows.filter(r => [r.confirmation_number, r.client_name, r.client_code, ...r.references, ...r.securities]
        .some(s => s.toLowerCase().includes(q)))
    : rows;

  return (
    <div className="space-y-4">
      <div className="relative max-w-xl">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-faint)' }} />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by TRF reference, deal number, client or security…"
          className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm text-text-primary outline-none"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }} />
      </div>

      {notice && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', color: 'var(--success)' }}>
          {notice}
        </div>
      )}
      {error && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        {loading ? (
          <div className="flex justify-center py-16"><LogoLoader size={48} /></div>
        ) : shown.length === 0 ? (
          <p className="text-center py-16 text-sm" style={{ color: 'var(--text-faint)' }}>No transferred deals found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full nw-table">
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                  {['Transfer Ref', 'Deal Number', 'Client', 'Security', 'Amount', 'Transferred', ''].map(h => (
                    <th key={h} className="px-5 py-3.5 text-left text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.deal_id} style={{ borderBottom: '1px solid var(--bg-raised)' }}>
                    <td className="px-5 py-3.5 text-xs font-mono text-text-primary">{r.references.join(', ')}</td>
                    <td className="px-5 py-3.5 text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{r.confirmation_number}</td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm text-text-primary">{r.client_name}</p>
                      <p className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>{r.client_code}</p>
                    </td>
                    <td className="px-5 py-3.5 text-sm" style={{ color: 'var(--text-secondary)' }}>{r.securities.join(', ')}</td>
                    <td className="px-5 py-3.5 text-sm text-text-primary tabular-nums">{inr(r.amount)}</td>
                    <td className="px-5 py-3.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                      {fmtDateTime(r.transferred_at)}{r.transferred_by ? <><br />by {r.transferred_by}</> : null}
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <button onClick={() => { setNotice(''); setTarget(r); }}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                        style={{ background: 'rgba(239,68,68,0.08)', color: 'rgb(239,68,68)', border: '1px solid rgba(239,68,68,0.3)' }}>
                        <RotateCcw className="w-3.5 h-3.5" /> Reverse
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {target && (
        <ReverseTransferDialog
          dealId={target.deal_id}
          dealLabel={target.confirmation_number}
          clientName={target.client_name}
          references={target.references}
          onCancel={() => setTarget(null)}
          onDone={(refs) => {
            setNotice(`Reversed ${refs.join(', ')}. ${target.confirmation_number} is back in the Transfer Queue.`);
            setTarget(null);
            load();
            onReversed?.();
          }}
        />
      )}
    </div>
  );
}
