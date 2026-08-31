// Client & partner markup pricing — one screen, both products.
//
// An RM proposes a % on the base price; an admin approves it; only then does any
// client or partner see a price at all. Bonds and unlisted shares run the exact
// same workflow over their own tables, so this component takes the product and
// its copy as props rather than existing twice.

import { useMemo, useState } from 'react';
import { Loader2, Percent, Check, X, ShieldAlert, Search, Users, Handshake, type LucideIcon } from 'lucide-react';
import { NWEmployee } from '../types';
import {
  useMarkups, useMyClients, useMyPartners, usePropose, useApprove, useReject,
  MarkupRow, NamedRow, Audience, Product,
} from './pricingClient';

export interface MarkupPricingProps {
  employee: NWEmployee;
  product: Product;
  /** Small caps line above the title, e.g. "Bond Pricing". */
  eyebrow: string;
  /** What the markup is applied to, in the intro line, e.g. "bond price". */
  baseLabel: string;
  /** Icon for the empty state of the individual-override list. */
  emptyIcon: LucideIcon;
}

const fmtPct = (v: number | null | undefined) => v === null || v === undefined ? '—' : `${Number(v).toFixed(2)}%`;

function StatusBadge({ status }: { status: string }) {
  const rgb = status === 'approved' ? '16,185,129' : status === 'pending' ? '245,158,11' : '148,163,184';
  return <span className="text-[10px] px-2 py-0.5 rounded-lg font-bold capitalize" style={{ background: `rgba(${rgb},0.12)`, color: `rgb(${rgb})` }}>{status}</span>;
}

// A percent input + Propose button for one target.
function ProposeCell({ current, pending, onPropose, busy }: { current: number | null; pending: number | null; onPropose: (v: number) => void; busy: boolean }) {
  const [val, setVal] = useState('');
  return (
    <div className="flex items-center gap-2">
      <div className="relative">
        <Percent className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
        <input type="number" step="0.01" min={0} value={val} onChange={e => setVal(e.target.value)} placeholder={current !== null ? String(current) : '%'}
          className="w-24 pl-6 pr-2 py-1.5 rounded-lg text-sm outline-none" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
      </div>
      <button disabled={busy || val === '' || Number.isNaN(parseFloat(val))} onClick={() => { onPropose(parseFloat(val)); setVal(''); }}
        className="px-3 py-1.5 rounded-lg text-xs font-bold text-on-accent disabled:opacity-40" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Propose'}
      </button>
      {pending !== null && <span className="text-[10px]" style={{ color: 'rgb(245,158,11)' }}>pending {fmtPct(pending)}</span>}
    </div>
  );
}

export function MarkupPricing({ employee, product, eyebrow, baseLabel, emptyIcon: EmptyIcon }: MarkupPricingProps) {
  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';
  const { data: markups = [], isLoading } = useMarkups(product);
  const { data: clients = [] } = useMyClients();
  const { data: partners = [] } = useMyPartners();
  const propose = usePropose(product);
  const approve = useApprove(product);
  const reject = useReject(product);
  const [tab, setTab] = useState<Audience>('client');
  const [search, setSearch] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => { setErr(null); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : 'Failed'); } };

  // Index approved / pending markups.
  const idx = useMemo(() => {
    const ind: Record<string, { approved: number | null; pending: number | null }> = {};
    const grp: Record<string, { approved: number | null; pending: number | null }> = {};
    const key = (m: MarkupRow) => m.scope === 'individual' ? (m.client_id || m.dsa_id)! : `${m.audience}:${m.employee_id ?? 'company'}`;
    for (const m of markups) {
      const bucket = m.scope === 'individual' ? ind : grp;
      const k = key(m);
      bucket[k] = bucket[k] || { approved: null, pending: null };
      if (m.status === 'approved') bucket[k].approved = m.markup_percent;
      if (m.status === 'pending') bucket[k].pending = m.markup_percent;
    }
    return { ind, grp };
  }, [markups]);

  const grpRate = (audience: Audience, empId: string | null) => idx.grp[`${audience}:${empId ?? 'company'}`] || { approved: null, pending: null };
  const pending = markups.filter(m => m.status === 'pending');

  const list: NamedRow[] = (tab === 'client' ? clients : partners).filter(r => {
    const s = search.trim().toLowerCase();
    return !s || r.full_name.toLowerCase().includes(s) || r.code.toLowerCase().includes(s);
  });

  const targetLabel = (m: MarkupRow) =>
    m.scope === 'group'
      ? `${m.audience === 'client' ? 'All clients' : 'All partners'}${m.employee_id ? '' : ' (company-wide)'}`
      : m.client?.full_name || m.dsa?.full_name || (m.client_id || m.dsa_id) || '—';

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>{eyebrow}</p>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Client &amp; Partner Markups</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-faint)' }}>Set an added-revenue % on the base {baseLabel}. Rates go live only after admin approval.</p>
      </div>

      {err && <div className="p-3 rounded-xl text-sm flex items-center gap-2" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: 'rgb(239,68,68)' }}><ShieldAlert className="w-4 h-4" />{err}</div>}

      {/* Group rates */}
      <div className="rounded-2xl p-5" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        <h2 className="text-xs font-bold uppercase tracking-widest mb-3" style={{ color: 'var(--accent)' }}>Group rate (applies to all of your {isAdmin ? 'or company-wide' : ''})</h2>
        <div className="space-y-3">
          {(['client', 'partner'] as Audience[]).map(aud => {
            const g = grpRate(aud, employee.id);
            const cg = grpRate(aud, null);
            return (
              <div key={aud} className="flex flex-wrap items-center justify-between gap-3 pb-3" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                <div className="flex items-center gap-2 min-w-[180px]">
                  {aud === 'client' ? <Users className="w-4 h-4" style={{ color: 'var(--text-faint)' }} /> : <Handshake className="w-4 h-4" style={{ color: 'var(--text-faint)' }} />}
                  <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>All {aud === 'client' ? 'clients' : 'partners'}</span>
                  <span className="text-xs" style={{ color: 'var(--text-faint)' }}>approved {fmtPct(g.approved)}</span>
                </div>
                <ProposeCell current={g.approved} pending={g.pending} busy={propose.isPending}
                  onPropose={v => run(() => propose.mutateAsync({ audience: aud, scope: 'group', markup: v }))} />
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs" style={{ color: 'var(--text-faint)' }}>company-wide {fmtPct(cg.approved)}</span>
                    <ProposeCell current={cg.approved} pending={cg.pending} busy={propose.isPending}
                      onPropose={v => run(() => propose.mutateAsync({ audience: aud, scope: 'group', markup: v, company_wide: true }))} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Approval queue (admin) */}
      {isAdmin && (
        <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
          <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--border)' }}>
            <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>Approval queue</h2>
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{pending.length} pending</span>
          </div>
          {pending.length === 0 ? (
            <p className="text-sm px-5 py-8 text-center" style={{ color: 'var(--text-faint)' }}>Nothing awaiting approval.</p>
          ) : (
            <table className="w-full text-sm">
              <thead><tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Target', 'Audience', 'Markup', ''].map(h => <th key={h} className="px-4 py-2 text-left text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {pending.map(m => (
                  <tr key={m.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                    <td className="px-4 py-2.5 font-semibold" style={{ color: 'var(--text-primary)' }}>{targetLabel(m)}</td>
                    <td className="px-4 py-2.5 capitalize" style={{ color: 'var(--text-secondary)' }}>{m.audience}</td>
                    <td className="px-4 py-2.5 font-bold" style={{ color: 'var(--text-primary)' }}>{fmtPct(m.markup_percent)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <button disabled={approve.isPending} onClick={() => run(() => approve.mutateAsync(m.id))} className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1" style={{ background: 'rgba(16,185,129,0.12)', color: 'rgb(16,185,129)', border: '1px solid rgba(16,185,129,0.3)' }}><Check className="w-3.5 h-3.5" /> Approve</button>
                        <button disabled={reject.isPending} onClick={() => { const r = window.prompt('Reason for rejection?') ?? ''; run(() => reject.mutateAsync({ id: m.id, reason: r })); }} className="px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1" style={{ background: 'rgba(239,68,68,0.1)', color: 'rgb(239,68,68)', border: '1px solid rgba(239,68,68,0.3)' }}><X className="w-3.5 h-3.5" /> Reject</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Individual overrides */}
      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        <div className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-2">
            {(['client', 'partner'] as Audience[]).map(a => (
              <button key={a} onClick={() => setTab(a)} className="px-3 py-1.5 rounded-lg text-xs font-bold capitalize" style={{ background: tab === a ? 'var(--accent)' : 'var(--bg-base)', color: tab === a ? 'var(--on-accent, #fff)' : 'var(--text-secondary)', border: '1px solid var(--border)' }}>{a}s</button>
            ))}
          </div>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder={`Search ${tab}s`} className="pl-9 pr-3 py-2 rounded-xl text-sm outline-none w-56" style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)' }} />
          </div>
        </div>
        {isLoading ? (
          <div className="flex items-center justify-center py-16"><Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} /></div>
        ) : list.length === 0 ? (
          <p className="text-sm px-5 py-10 text-center" style={{ color: 'var(--text-faint)' }}><EmptyIcon className="w-6 h-6 mx-auto mb-2" style={{ color: 'var(--text-faint)' }} />No {tab}s.</p>
        ) : (
          <div className="max-h-[520px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0" style={{ background: 'var(--bg-surface)' }}><tr style={{ borderBottom: '1px solid var(--border)' }}>
                {[tab === 'client' ? 'Client' : 'Partner', 'Approved', 'Override', ''].map(h => <th key={h} className="px-4 py-2 text-left text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</th>)}
              </tr></thead>
              <tbody>
                {list.slice(0, 500).map(r => {
                  const rate = idx.ind[r.id] || { approved: null, pending: null };
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                      <td className="px-4 py-2.5"><p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{r.full_name}</p><p className="text-xs font-mono" style={{ color: 'var(--text-faint)' }}>{r.code}</p></td>
                      <td className="px-4 py-2.5">{rate.approved !== null ? <span className="font-bold" style={{ color: 'var(--text-primary)' }}>{fmtPct(rate.approved)}</span> : <span style={{ color: 'var(--text-faint)' }}>—</span>}{rate.pending !== null && <StatusBadge status="pending" />}</td>
                      <td className="px-4 py-2.5" colSpan={2}>
                        <ProposeCell current={rate.approved} pending={rate.pending} busy={propose.isPending}
                          onPropose={v => run(() => propose.mutateAsync({ audience: tab, scope: 'individual', client_id: tab === 'client' ? r.id : null, dsa_id: tab === 'partner' ? r.id : null, markup: v }))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

