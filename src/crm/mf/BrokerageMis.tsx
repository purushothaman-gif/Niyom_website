// Brokerage MIS — MF trail/upfront brokerage from the CAMS WBR77 mailback,
// labelled by the WBR39 scheme master, broken down by month / AMC / scheme /
// client / RM / DSA partner / selling employee (EUIN).
//
// Visibility is enforced by RLS on mf_rta_brokerage (view is security_invoker):
// admins see the whole book, an RM only lines on their own clients. The admin-
// only panels (reconciliation, AUM-without-brokerage, unmatched lines, imports)
// read tables RMs cannot see at all.
//
// This page REPORTS brokerage and holds no payout/incentive formula. MIS
// revenue reads the same mf_rta_brokerage lines (from Oct 2026 — see
// MANUAL_BROKERAGE_LAST_MONTH in crm/misRevenue.ts).
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { supabase } from '../../lib/supabase';
import { NWEmployee } from '../types';
import { BadgeIndianRupee, RefreshCw, AlertTriangle, CheckCircle2, Scale, Link2, Database } from 'lucide-react';
import { SearchSelect } from '../../components/SearchSelect';

interface Props { employee: NWEmployee; }

interface Line {
  id: string;
  brokerage_month: string;
  category: string;
  amc_code: string | null;
  amc_name: string | null;
  scheme_code: string | null;
  scheme_name: string | null;
  folio: string;
  holder_name: string | null;
  brokerage: number;
  gst_total: number;
  avg_assets: number | null;
  euin: string | null;
  euin_valid: boolean | null;
  match_method: string | null;
  client_id: string | null;
  client_name: string | null;
  client_code: string | null;
  rm_id: string | null;
  rm_name: string | null;
  dsa_id: string | null;
  dsa_name: string | null;
  sold_by_employee_id: string | null;
  sold_by_name: string | null;
}
interface Receipt { id: string; amc_code: string; period_month: string; amount: number; notes: string | null; }
interface ImportRow { id: string; created_at: string; report: string | null; source: string | null; source_file: string | null; status: string; rows_total: number | null; matched: number | null; unmatched: number | null; amount_total: number | null; gst_total: number | null; schemes_upserted: number | null; error: string | null; }
interface Holding { folio: string; amc_code: string | null; scheme_name: string | null; rta_value: number | null; nav_value: number | null; registrar: string; }
interface ClientLite { id: string; full_name: string; client_code: string; }

type GroupBy = 'month' | 'amc' | 'scheme' | 'client' | 'rm' | 'dsa' | 'sold_by';
const GROUPS: { key: GroupBy; label: string }[] = [
  { key: 'month', label: 'Month' }, { key: 'amc', label: 'AMC' }, { key: 'scheme', label: 'Scheme' },
  { key: 'client', label: 'Client' }, { key: 'rm', label: 'RM' }, { key: 'dsa', label: 'DSA partner' },
  { key: 'sold_by', label: 'Sold by (EUIN)' },
];

// Brokerage lines are often paise-level: always show two decimals.
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const monthLabel = (m: string) => new Date(`${m}T00:00:00`).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
/** Same normalisation as SQL mf_folio_base(): part before '/', alphanumerics, upper-case. */
const folioBase = (f: string) => f.split('/')[0].replace(/[^A-Za-z0-9]/g, '').toUpperCase();

async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    const page = (data as T[]) ?? [];
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

export default function BrokerageMis({ employee }: Props) {
  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';
  const [lines, setLines] = useState<Line[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [imports, setImports] = useState<ImportRow[]>([]);
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [fromMonth, setFromMonth] = useState('');
  const [toMonth, setToMonth] = useState('');
  const [category, setCategory] = useState<'all' | 'trail' | 'upfront' | 'other'>('all');
  const [groupBy, setGroupBy] = useState<GroupBy>('month');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setLoading(true); setError('');
    try {
      const ls = await fetchAll<Line>((a, b) => supabase.from('mf_rta_brokerage_mis')
        .select('id, brokerage_month, category, amc_code, amc_name, scheme_code, scheme_name, folio, holder_name, brokerage, gst_total, avg_assets, euin, euin_valid, match_method, client_id, client_name, client_code, rm_id, rm_name, dsa_id, dsa_name, sold_by_employee_id, sold_by_name')
        .order('brokerage_month', { ascending: false }).range(a, b));
      setLines(ls.map((l) => ({ ...l, brokerage: Number(l.brokerage), gst_total: Number(l.gst_total), avg_assets: l.avg_assets == null ? null : Number(l.avg_assets) })));
      if (isAdmin) {
        const [r, i, h, c] = await Promise.all([
          supabase.from('mf_brokerage_receipts').select('id, amc_code, period_month, amount, notes'),
          supabase.from('mf_rta_import_log').select('id, created_at, report, source, source_file, status, rows_total, matched, unmatched, amount_total, gst_total, schemes_upserted, error')
            .in('report', ['WBR77', 'WBR39']).order('created_at', { ascending: false }).limit(20),
          supabase.from('mf_rta_holdings').select('folio, amc_code, scheme_name, rta_value, nav_value, registrar').eq('registrar', 'CAMS'),
          supabase.from('nw_clients').select('id, full_name, client_code').order('full_name'),
        ]);
        setReceipts(((r.data ?? []) as Receipt[]).map((x) => ({ ...x, amount: Number(x.amount) })));
        setImports((i.data ?? []) as ImportRow[]);
        setHoldings((h.data ?? []) as Holding[]);
        setClients((c.data ?? []) as ClientLite[]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load brokerage.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const months = useMemo(() => [...new Set(lines.map((l) => l.brokerage_month))].sort(), [lines]);
  const filtered = useMemo(() => lines.filter((l) =>
    (!fromMonth || l.brokerage_month >= fromMonth) && (!toMonth || l.brokerage_month <= toMonth)
    && (category === 'all' || l.category === category)), [lines, fromMonth, toMonth, category]);

  const kpi = useMemo(() => {
    const sum = (f: (l: Line) => boolean) => filtered.filter(f).reduce((s, l) => s + l.brokerage, 0);
    return {
      total: sum(() => true),
      gst: filtered.reduce((s, l) => s + l.gst_total, 0),
      trail: sum((l) => l.category === 'trail'),
      upfront: sum((l) => l.category === 'upfront'),
      lines: filtered.length,
      clients: new Set(filtered.map((l) => l.client_id).filter(Boolean)).size,
      unmatched: filtered.filter((l) => !l.client_id).length,
      unmatchedAmt: sum((l) => !l.client_id),
    };
  }, [filtered]);

  const grouped = useMemo(() => {
    const keyOf = (l: Line): [string, string] => {
      switch (groupBy) {
        case 'month': return [l.brokerage_month, monthLabel(l.brokerage_month)];
        case 'amc': return [l.amc_code ?? '?', l.amc_name ?? l.amc_code ?? 'Unknown AMC'];
        case 'scheme': return [`${l.amc_code}|${l.scheme_code}`, l.scheme_name ?? l.scheme_code ?? 'Unknown scheme'];
        case 'client': return l.client_id ? [l.client_id, `${l.client_name ?? '—'}${l.client_code ? ` (${l.client_code})` : ''}`] : ['~', 'Unmatched'];
        case 'rm': return l.rm_id ? [l.rm_id, l.rm_name ?? '—'] : ['~', l.client_id ? 'No RM' : 'Unmatched'];
        case 'dsa': return l.dsa_id ? [l.dsa_id, l.dsa_name ?? 'DSA partner'] : ['~', 'Direct (no DSA)'];
        case 'sold_by': return l.sold_by_employee_id ? [l.sold_by_employee_id, `${l.sold_by_name ?? '—'} · ${l.euin}`] : ['~', l.euin ? `Unknown EUIN ${l.euin}` : 'No EUIN'];
      }
    };
    const m = new Map<string, { label: string; lines: number; brokerage: number; gst: number; clients: Set<string> }>();
    for (const l of filtered) {
      const [k, label] = keyOf(l);
      const g = m.get(k) ?? { label, lines: 0, brokerage: 0, gst: 0, clients: new Set<string>() };
      g.lines++; g.brokerage += l.brokerage; g.gst += l.gst_total;
      if (l.client_id) g.clients.add(l.client_id);
      m.set(k, g);
    }
    const rows = [...m.entries()].map(([k, g]) => ({ key: k, ...g, clients: g.clients.size }));
    return groupBy === 'month' ? rows.sort((a, b) => b.key.localeCompare(a.key)) : rows.sort((a, b) => b.brokerage - a.brokerage);
  }, [filtered, groupBy]);

  // ── Reconciliation: computed (WBR77, all categories) vs received per AMC × month.
  const recon = useMemo(() => {
    const m = new Map<string, { amc_code: string; amc_name: string; month: string; computed: number; gst: number }>();
    for (const l of lines) {
      if (fromMonth && l.brokerage_month < fromMonth) continue;
      if (toMonth && l.brokerage_month > toMonth) continue;
      const k = `${l.amc_code}|${l.brokerage_month}`;
      const g = m.get(k) ?? { amc_code: l.amc_code ?? '?', amc_name: l.amc_name ?? l.amc_code ?? '?', month: l.brokerage_month, computed: 0, gst: 0 };
      g.computed += l.brokerage; g.gst += l.gst_total;
      m.set(k, g);
    }
    for (const r of receipts) {
      const k = `${r.amc_code}|${r.period_month}`;
      if (!m.has(k) && (!fromMonth || r.period_month >= fromMonth) && (!toMonth || r.period_month <= toMonth)) {
        m.set(k, { amc_code: r.amc_code, amc_name: r.amc_code, month: r.period_month, computed: 0, gst: 0 });
      }
    }
    const rec = new Map(receipts.map((r) => [`${r.amc_code}|${r.period_month}`, r]));
    return [...m.values()].sort((a, b) => b.month.localeCompare(a.month) || a.amc_name.localeCompare(b.amc_name))
      .map((g) => ({ ...g, receipt: rec.get(`${g.amc_code}|${g.month}`) ?? null }));
  }, [lines, receipts, fromMonth, toMonth]);

  const [draft, setDraft] = useState<Record<string, string>>({});
  const saveReceipt = async (amc_code: string, month: string) => {
    const k = `${amc_code}|${month}`;
    const raw = (draft[k] ?? '').trim();
    const amount = Number(raw);
    if (!raw || !Number.isFinite(amount) || amount < 0) { setError('Enter the amount the AMC paid (₹, as on its payout notice).'); return; }
    setBusy(true); setError('');
    const { error: e } = await supabase.from('mf_brokerage_receipts').upsert(
      { registrar: 'CAMS', amc_code, period_month: month, amount, entered_by: employee.id, updated_at: new Date().toISOString() },
      { onConflict: 'registrar,amc_code,period_month' });
    setBusy(false);
    if (e) { setError(e.message); return; }
    setDraft((d) => { const n = { ...d }; delete n[k]; return n; });
    await load();
  };

  // ── AUM earning no brokerage: CAMS holdings whose folio has no line in the latest loaded month.
  const latestMonth = months[months.length - 1] ?? null;
  const noBrokerage = useMemo(() => {
    if (!latestMonth) return [];
    const paid = new Set(lines.filter((l) => l.brokerage_month === latestMonth).map((l) => `${(l.amc_code ?? '').toUpperCase()}|${folioBase(l.folio)}`));
    const paidAnyAmc = new Set(lines.filter((l) => l.brokerage_month === latestMonth).map((l) => folioBase(l.folio)));
    return holdings
      .filter((h) => !(h.amc_code ? paid.has(`${h.amc_code.toUpperCase()}|${folioBase(h.folio)}`) : paidAnyAmc.has(folioBase(h.folio))))
      .map((h) => ({ ...h, value: Number(h.rta_value ?? h.nav_value ?? 0) }))
      .filter((h) => h.value > 0)
      .sort((a, b) => b.value - a.value);
  }, [holdings, lines, latestMonth]);

  // ── Unmatched lines: re-run the folio match, or assign a folio to a client by hand.
  const unmatchedFolios = useMemo(() => {
    const m = new Map<string, { folio: string; holder: string | null; amc: string | null; lines: number; amount: number }>();
    for (const l of lines) {
      if (l.client_id) continue;
      const g = m.get(l.folio) ?? { folio: l.folio, holder: l.holder_name, amc: l.amc_name, lines: 0, amount: 0 };
      g.lines++; g.amount += l.brokerage;
      m.set(l.folio, g);
    }
    return [...m.values()].sort((a, b) => b.amount - a.amount);
  }, [lines]);
  const [assign, setAssign] = useState<Record<string, string>>({});

  const rematch = async () => {
    setBusy(true); setError(''); setNotice('');
    const { data, error: e } = await supabase.rpc('mf_rta_brokerage_match', { p_only_unmatched: true });
    setBusy(false);
    if (e) { setError(e.message); return; }
    setNotice(`Re-match done — ${data ?? 0} line(s) newly linked.`);
    await load();
  };
  const assignFolio = async (folio: string) => {
    const clientId = assign[folio];
    if (!clientId) return;
    setBusy(true); setError('');
    const { error: e } = await supabase.from('mf_rta_brokerage')
      .update({ client_id: clientId, match_method: 'manual', matched_at: new Date().toISOString() })
      .eq('registrar', 'CAMS').eq('folio', folio).is('client_id', null);
    setBusy(false);
    if (e) { setError(e.message); return; }
    await load();
  };

  const card: CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border)' };
  const sel: CSSProperties = { background: 'var(--bg-raised)', border: '1px solid var(--border)' };
  const th = 'px-4 py-2 font-semibold';
  const td = 'px-4 py-2.5';

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Mutual Funds</p>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <BadgeIndianRupee className="w-6 h-6" style={{ color: 'var(--accent)' }} /> Brokerage MIS
          </h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Trail &amp; upfront brokerage (ex-GST) from the CAMS WBR77 mailback, imported automatically. {isAdmin ? 'Whole book.' : 'Your clients only.'}
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ ...sel, color: 'var(--text-secondary)' }}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {error && <div className="p-3 rounded-xl text-sm text-c-red flex items-start gap-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}</div>}
      {notice && <div className="p-3 rounded-xl text-sm text-text-primary flex items-start gap-2" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)' }}><CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> {notice}</div>}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs" style={{ color: 'var(--text-muted)' }}>From
          <select value={fromMonth} onChange={(e) => setFromMonth(e.target.value)} className="block mt-1 px-3 py-2 rounded-lg text-sm text-text-primary" style={sel}>
            <option value="">Earliest</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
        <label className="text-xs" style={{ color: 'var(--text-muted)' }}>To
          <select value={toMonth} onChange={(e) => setToMonth(e.target.value)} className="block mt-1 px-3 py-2 rounded-lg text-sm text-text-primary" style={sel}>
            <option value="">Latest</option>{months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </label>
        <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Type
          <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} className="block mt-1 px-3 py-2 rounded-lg text-sm text-text-primary" style={sel}>
            <option value="all">Trail + upfront</option><option value="trail">Trail</option><option value="upfront">Upfront</option><option value="other">Other</option>
          </select>
        </label>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { l: 'Brokerage (ex-GST)', v: inr(kpi.total), s: `${kpi.lines} line(s) · ${kpi.clients} client(s)` },
          { l: 'Trail / Upfront', v: `${inr(kpi.trail)} / ${inr(kpi.upfront)}`, s: 'by brokerage type' },
          { l: 'GST on brokerage', v: inr(kpi.gst), s: 'pass-through, not revenue' },
          { l: 'Unmatched to a client', v: inr(kpi.unmatchedAmt), s: `${kpi.unmatched} line(s)${isAdmin ? '' : ' (admin resolves)'}` },
        ].map((k) => (
          <div key={k.l} className="rounded-2xl p-4" style={card}>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{k.l}</p>
            <p className="text-xl font-bold text-text-primary mt-1">{k.v}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{k.s}</p>
          </div>
        ))}
      </div>

      {/* Breakdown */}
      <div className="rounded-2xl overflow-hidden" style={card}>
        <div className="px-5 py-3 flex flex-wrap gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
          {GROUPS.map((g) => (
            <button key={g.key} onClick={() => setGroupBy(g.key)} className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={groupBy === g.key ? { background: 'var(--accent)', color: '#fff' } : { ...sel, color: 'var(--text-secondary)' }}>{g.label}</button>
          ))}
        </div>
        {loading ? <p className="px-5 py-6 text-sm" style={{ color: 'var(--text-muted)' }}>Loading…</p>
          : grouped.length === 0 ? <p className="px-5 py-6 text-sm" style={{ color: 'var(--text-muted)' }}>No brokerage for this selection yet. WBR77 files are picked up from the CAMS mailback daily, or can be uploaded on MF Feeds.</p>
          : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                <th className={th}>{GROUPS.find((g) => g.key === groupBy)?.label}</th>
                <th className={`${th} text-right`}>Lines</th><th className={`${th} text-right`}>Clients</th>
                <th className={`${th} text-right`}>Brokerage</th><th className={`${th} text-right`}>GST</th><th className={`${th} text-right`}>Share</th>
              </tr></thead>
              <tbody>
                {grouped.map((g) => (
                  <tr key={g.key} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className={`${td} text-text-primary`}>{g.label}</td>
                    <td className={`${td} text-right`} style={{ color: 'var(--text-secondary)' }}>{g.lines}</td>
                    <td className={`${td} text-right`} style={{ color: 'var(--text-secondary)' }}>{g.clients}</td>
                    <td className={`${td} text-right text-text-primary font-semibold`}>{inr(g.brokerage)}</td>
                    <td className={`${td} text-right`} style={{ color: 'var(--text-secondary)' }}>{inr(g.gst)}</td>
                    <td className={`${td} text-right`} style={{ color: 'var(--text-secondary)' }}>{kpi.total ? `${((g.brokerage / kpi.total) * 100).toFixed(1)}%` : '—'}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '2px solid var(--border)' }}>
                  <td className={`${td} font-bold text-text-primary`}>Total</td>
                  <td className={`${td} text-right text-text-primary`}>{kpi.lines}</td><td className={td} />
                  <td className={`${td} text-right font-bold text-text-primary`}>{inr(kpi.total)}</td>
                  <td className={`${td} text-right text-text-primary`}>{inr(kpi.gst)}</td><td className={td} />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isAdmin && (
        <>
          {/* Reconciliation */}
          <div className="rounded-2xl overflow-hidden" style={card}>
            <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-sm font-bold text-text-primary flex items-center gap-2"><Scale className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Computed vs received</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                Computed = WBR77 brokerage (ex-GST) per AMC per month. Received = the amount on the AMC's “brokerage payout” notice — enter it here.
                A notice amount that includes GST will show the GST as the difference.
              </p>
            </div>
            {recon.length === 0 ? <p className="px-5 py-6 text-sm" style={{ color: 'var(--text-muted)' }}>Nothing to reconcile yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    <th className={th}>Month</th><th className={th}>AMC</th><th className={`${th} text-right`}>Computed</th>
                    <th className={`${th} text-right`}>+ GST</th><th className={`${th} text-right`}>Received</th><th className={`${th} text-right`}>Difference</th><th className={th}>Status</th>
                  </tr></thead>
                  <tbody>
                    {recon.map((r) => {
                      const k = `${r.amc_code}|${r.month}`;
                      const diff = r.receipt ? r.receipt.amount - r.computed : null;
                      const ok = diff != null && (Math.abs(diff) < 0.01 || Math.abs(diff - r.gst) < 0.01);
                      return (
                        <tr key={k} style={{ borderTop: '1px solid var(--border)' }}>
                          <td className={td} style={{ color: 'var(--text-secondary)' }}>{monthLabel(r.month)}</td>
                          <td className={`${td} text-text-primary`}>{r.amc_name}</td>
                          <td className={`${td} text-right text-text-primary`}>{inr(r.computed)}</td>
                          <td className={`${td} text-right`} style={{ color: 'var(--text-secondary)' }}>{inr(r.computed + r.gst)}</td>
                          <td className={`${td} text-right`}>
                            <div className="flex justify-end gap-1">
                              <input value={draft[k] ?? (r.receipt ? String(r.receipt.amount) : '')} onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                                inputMode="decimal" placeholder="₹ paid" className="w-24 px-2 py-1 rounded-lg text-sm text-right text-text-primary" style={sel} />
                              {draft[k] != null && <button disabled={busy} onClick={() => saveReceipt(r.amc_code, r.month)} className="px-2 py-1 rounded-lg text-xs font-semibold text-on-accent disabled:opacity-50" style={{ background: 'var(--accent)' }}>Save</button>}
                            </div>
                          </td>
                          <td className={`${td} text-right`} style={{ color: diff == null ? 'var(--text-muted)' : ok ? 'var(--c-green)' : 'var(--c-red)' }}>{diff == null ? '—' : inr(diff)}</td>
                          <td className={td} style={{ color: diff == null ? 'var(--text-muted)' : ok ? 'var(--c-green)' : 'var(--c-red)' }}>
                            {diff == null ? 'Awaiting payout' : ok ? (Math.abs(diff) < 0.01 ? 'Matched' : 'Matched (incl. GST)') : diff < 0 ? 'Short-paid' : 'Over-paid'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* AUM without brokerage */}
          {latestMonth && (
            <div className="rounded-2xl overflow-hidden" style={card}>
              <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
                <h2 className="text-sm font-bold text-text-primary flex items-center gap-2"><AlertTriangle className="w-4 h-4" style={{ color: 'var(--accent)' }} /> CAMS AUM earning no brokerage — {monthLabel(latestMonth)}</h2>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Registrar holdings with no WBR77 line in the latest month: check the ARN/EUIN on the folio, a direct-plan switch, or a missing month.</p>
              </div>
              {noBrokerage.length === 0 ? <p className="px-5 py-6 text-sm" style={{ color: 'var(--text-muted)' }}>Every CAMS holding earned brokerage in {monthLabel(latestMonth)}.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                      <th className={th}>Folio</th><th className={th}>Scheme</th><th className={`${th} text-right`}>Value</th>
                    </tr></thead>
                    <tbody>
                      {noBrokerage.slice(0, 50).map((h, i) => (
                        <tr key={`${h.folio}-${i}`} style={{ borderTop: '1px solid var(--border)' }}>
                          <td className={`${td} font-mono text-xs text-text-primary`}>{h.folio}</td>
                          <td className={td} style={{ color: 'var(--text-secondary)' }}>{h.scheme_name ?? '—'}</td>
                          <td className={`${td} text-right text-text-primary`}>{inr(h.value)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Unmatched */}
          <div className="rounded-2xl overflow-hidden" style={card}>
            <div className="px-5 py-3 flex items-center justify-between flex-wrap gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-sm font-bold text-text-primary flex items-center gap-2"><Link2 className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Unmatched folios</h2>
              <button disabled={busy} onClick={rematch} className="px-3 py-1.5 rounded-lg text-xs font-semibold disabled:opacity-50" style={{ ...sel, color: 'var(--accent)' }}>Re-run folio match</button>
            </div>
            {unmatchedFolios.length === 0 ? <p className="px-5 py-6 text-sm" style={{ color: 'var(--text-muted)' }}>Every brokerage line is linked to a client.</p> : (
              <div className="p-3 space-y-2">
                {unmatchedFolios.map((u) => (
                  <div key={u.folio} className="flex flex-wrap items-center gap-2 rounded-xl p-2" style={{ background: 'var(--bg-raised)' }}>
                    <span className="flex-1 min-w-[200px] text-sm text-text-primary">
                      <span className="font-mono text-xs">{u.folio}</span> · {u.holder ?? '—'} <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({u.amc ?? '—'}, {u.lines} line(s), {inr(u.amount)})</span>
                    </span>
                    <SearchSelect value={assign[u.folio] ?? ''} onChange={(v) => setAssign((a) => ({ ...a, [u.folio]: v }))}
                      placeholder="Assign to client…" className="min-w-[220px] px-3 py-2 rounded-lg text-sm text-text-primary"
                      style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
                      options={clients.map((c) => ({ value: c.id, label: c.full_name, sub: c.client_code }))} />
                    <button onClick={() => assignFolio(u.folio)} disabled={!assign[u.folio] || busy} className="px-3 py-2 rounded-lg text-sm font-semibold text-on-accent disabled:opacity-50" style={{ background: 'var(--accent)' }}>Save</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Imports */}
          <div className="rounded-2xl overflow-hidden" style={card}>
            <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="text-sm font-bold text-text-primary flex items-center gap-2"><Database className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Brokerage &amp; scheme-master imports</h2>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Each WBR77 import is refused unless the stored lines add up to the file's own line count and brokerage total.</p>
            </div>
            {imports.length === 0 ? <p className="px-5 py-6 text-sm" style={{ color: 'var(--text-muted)' }}>No WBR77/WBR39 imported yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-xs uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    <th className={th}>When</th><th className={th}>Report</th><th className={`${th} text-right`}>Rows</th>
                    <th className={`${th} text-right`}>Matched</th><th className={`${th} text-right`}>File total</th><th className={th}>Result</th>
                  </tr></thead>
                  <tbody>
                    {imports.map((r) => (
                      <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                        <td className={td} style={{ color: 'var(--text-secondary)' }}>{new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                        <td className={`${td} text-text-primary`}>{r.report} <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{r.source}</span></td>
                        <td className={`${td} text-right text-text-primary`}>{r.rows_total ?? '—'}</td>
                        <td className={`${td} text-right`} style={{ color: 'var(--text-secondary)' }}>{r.report === 'WBR77' ? `${r.matched ?? 0}/${(r.matched ?? 0) + (r.unmatched ?? 0)}` : `${r.schemes_upserted ?? 0} schemes`}</td>
                        <td className={`${td} text-right text-text-primary`}>{r.amount_total != null ? inr(Number(r.amount_total)) : '—'}</td>
                        <td className={td} style={{ color: r.status === 'ok' ? 'var(--c-green)' : 'var(--c-red)' }}>
                          {r.status === 'ok' ? (r.report === 'WBR77' ? 'Reconciled' : 'OK') : (r.error ?? 'Error')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
