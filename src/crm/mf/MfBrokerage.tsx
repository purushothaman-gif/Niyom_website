import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { supabase } from '../../lib/supabase';
import { NWEmployee } from '../types';
import { fmt } from '../utils';
import { IndianRupee, Upload, RefreshCw, CheckCircle2, AlertTriangle, Link2 } from 'lucide-react';
import { parseBrokerageFile, normName, type ParsedBrokerage } from './brokerageImport';

interface Props { employee: NWEmployee; }

interface ClientLite { id: string; full_name: string; client_code: string; employee_id: string | null; }
interface LogRow { id: string; created_at: string; source_file: string | null; months_covered: string | null; rows_total: number; matched: number; unmatched: number; amount_total: number; }
interface BrokRow { raw_name: string; client_id: string | null; period_month: string; brokerage: number; }

const MAX_BYTES = 6 * 1024 * 1024;

export default function MfBrokerage({ employee }: Props) {
  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedBrokerage | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [clients, setClients] = useState<ClientLite[]>([]);
  const [existing, setExisting] = useState<BrokRow[]>([]);
  const [log, setLog] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const [cRes, bRes, lRes] = await Promise.all([
      supabase.from('nw_clients').select('id, full_name, client_code, employee_id').order('full_name'),
      supabase.from('mf_brokerage').select('raw_name, client_id, period_month, brokerage'),
      supabase.from('mf_brokerage_imports').select('*').order('created_at', { ascending: false }).limit(10),
    ]);
    setClients((cRes.data as ClientLite[]) ?? []);
    setExisting((bRes.data as BrokRow[]) ?? []);
    setLog((lRes.data as LogRow[]) ?? []);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  // name -> client(s). A unique normalised name auto-matches; blanks / duplicates
  // are left for a manual map so a wrong client is never credited silently.
  const byName = useMemo(() => {
    const m = new Map<string, ClientLite[]>();
    for (const c of clients) {
      const k = normName(c.full_name);
      (m.get(k) ?? m.set(k, []).get(k)!).push(c);
    }
    return m;
  }, [clients]);

  const matchOf = (rawName: string): ClientLite | 'ambiguous' | null => {
    const hits = byName.get(normName(rawName)) ?? [];
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return 'ambiguous';
    return null;
  };

  const preview = useMemo(() => {
    if (!parsed) return null;
    const names = parsed.clientNames;
    let matched = 0, unmatched = 0, ambiguous = 0;
    const unresolved: string[] = [];
    for (const n of names) {
      const m = matchOf(n);
      if (m === 'ambiguous') { ambiguous++; unresolved.push(n); }
      else if (m) matched++;
      else { unmatched++; unresolved.push(n); }
    }
    return { matched, unmatched: unmatched + ambiguous, ambiguous, unresolved };
  }, [parsed, byName]);

  const onChoose = async () => {
    setError(''); setResult(null); setParsed(null);
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('Choose the brokerage Excel first.'); return; }
    if (file.size > MAX_BYTES) { setError('That file is larger than 6 MB.'); return; }
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const p = await parseBrokerageFile(buf);
      if (!p.rows.length) throw new Error('No brokerage rows found in the file.');
      setParsed(p);
      setFileName(file.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read the file.');
    } finally {
      setBusy(false);
    }
  };

  const onImport = async () => {
    if (!parsed) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const nowIso = new Date().toISOString();
      const rows = parsed.rows.map((r) => {
        const m = matchOf(r.rawName);
        const client = m && m !== 'ambiguous' ? m : null;
        return {
          raw_name: r.rawName,
          client_id: client?.id ?? null,
          period_month: r.periodMonth,
          period_label: r.label,
          brokerage: r.brokerage,
          gst: r.gst,
          source_file: fileName,
          imported_by: employee.id,
          matched_at: client ? nowIso : null,
          updated_at: nowIso,
        };
      });
      const { error: upErr } = await supabase.from('mf_brokerage').upsert(rows, { onConflict: 'raw_name,period_month' });
      if (upErr) throw new Error(upErr.message);

      const matched = new Set(parsed.clientNames.filter((n) => { const x = matchOf(n); return x && x !== 'ambiguous'; })).size;
      await supabase.from('mf_brokerage_imports').insert({
        source_file: fileName,
        months_covered: parsed.months.map((m) => m.label).join(', '),
        rows_total: rows.length,
        matched,
        unmatched: parsed.clientNames.length - matched,
        amount_total: parsed.totalBrokerage,
        imported_by: employee.id,
      });
      setResult(`Imported ${rows.length} rows across ${parsed.months.length} month(s) · ${matched}/${parsed.clientNames.length} clients matched.`);
      setParsed(null);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  // Manual map: assign every row of an unmatched name to a client.
  const [mapName, setMapName] = useState<string | null>(null);
  const [mapClientId, setMapClientId] = useState('');
  const doMap = async () => {
    if (!mapName || !mapClientId) return;
    setBusy(true);
    const { error: e } = await supabase.from('mf_brokerage')
      .update({ client_id: mapClientId, matched_at: new Date().toISOString() })
      .eq('raw_name', mapName);
    setBusy(false);
    if (e) { setError(e.message); return; }
    setMapName(null); setMapClientId('');
    await load();
  };

  const stats = useMemo(() => {
    const total = existing.reduce((s, r) => s + Number(r.brokerage || 0), 0);
    const unmatchedNames = [...new Set(existing.filter((r) => !r.client_id).map((r) => r.raw_name))];
    const months = [...new Set(existing.map((r) => r.period_month))].sort();
    return { total, unmatchedNames, months };
  }, [existing]);

  const card: CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border)' };

  if (!isAdmin) {
    return <div className="rounded-2xl p-6 text-sm" style={card}><p style={{ color: 'var(--text-muted)' }}>MF Brokerage is available to admins only.</p></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Mutual Funds</p>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <IndianRupee className="w-6 h-6" style={{ color: 'var(--accent)' }} /> MF Brokerage
          </h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Upload the client-wise month-on-month brokerage report. Amounts (ex-GST) are credited to each client's RM and flow into MIS as mutual-fund revenue.
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold" style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl p-4" style={card}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Brokerage on record (ex-GST)</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{fmt(stats.total)}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{stats.months.length} month(s) loaded</p>
        </div>
        <div className="rounded-2xl p-4" style={card}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Unmatched names</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{stats.unmatchedNames.length}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Not credited until mapped</p>
        </div>
        <div className="rounded-2xl p-4" style={card}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Clients</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{clients.length.toLocaleString('en-IN')}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Matched by name</p>
        </div>
      </div>

      {/* Upload */}
      <div className="rounded-2xl p-5" style={card}>
        <h2 className="text-lg font-bold text-text-primary mb-3">Upload brokerage</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Brokerage Excel (.xlsx)</label>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={onChoose}
              className="block w-full text-sm text-text-primary file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:cursor-pointer" />
          </div>
          <button onClick={onImport} disabled={busy || !parsed}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>
            <Upload className={`w-4 h-4 ${busy ? 'animate-pulse' : ''}`} /> {busy ? 'Working…' : 'Import'}
          </button>
        </div>

        {error && <div className="mt-4 p-3 rounded-xl text-sm text-c-red flex items-start gap-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}</div>}
        {result && <div className="mt-4 p-4 rounded-xl text-sm" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)' }}><p className="font-semibold text-text-primary flex items-center gap-2"><CheckCircle2 className="w-4 h-4" style={{ color: 'var(--c-green, #16a34a)' }} /> {result}</p></div>}

        {parsed && preview && (
          <div className="mt-4 p-4 rounded-xl text-sm space-y-2" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}>
            <p className="text-text-primary font-semibold">Preview — {fileName}</p>
            <p style={{ color: 'var(--text-secondary)' }}>
              Months: {parsed.months.map((m) => m.label).join(', ')} · {parsed.clientNames.length} clients · total {fmt(parsed.totalBrokerage)} (ex-GST)
            </p>
            <p style={{ color: 'var(--text-secondary)' }}>
              <span style={{ color: 'var(--c-green, #16a34a)' }}>{preview.matched} will match</span> ·{' '}
              <span style={{ color: preview.unmatched ? 'var(--c-red)' : 'var(--text-muted)' }}>{preview.unmatched} unmatched</span>
              {preview.ambiguous > 0 && ` (incl. ${preview.ambiguous} duplicate-name)`} — unmatched rows import but aren't credited until you map them below.
            </p>
            {preview.unresolved.length > 0 && (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Unmatched: {preview.unresolved.slice(0, 12).join(', ')}{preview.unresolved.length > 12 ? '…' : ''}</p>
            )}
          </div>
        )}
      </div>

      {/* Unmatched mapping */}
      {stats.unmatchedNames.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={card}>
          <div className="px-5 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <Link2 className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <h2 className="text-sm font-bold text-text-primary">Map unmatched names</h2>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>— credit these to a client</span>
          </div>
          <div className="p-3 space-y-2">
            {stats.unmatchedNames.map((n) => (
              <div key={n} className="flex flex-wrap items-center gap-2 rounded-xl p-2" style={{ background: 'var(--bg-raised)' }}>
                <span className="flex-1 min-w-[160px] text-sm text-text-primary">{n}</span>
                {mapName === n ? (
                  <>
                    <select value={mapClientId} onChange={(e) => setMapClientId(e.target.value)} className="px-3 py-2 rounded-lg text-sm text-text-primary" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
                      <option value="">Select client…</option>
                      {clients.map((c) => <option key={c.id} value={c.id}>{c.full_name} ({c.client_code})</option>)}
                    </select>
                    <button onClick={doMap} disabled={!mapClientId || busy} className="px-3 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: 'var(--accent)' }}>Save</button>
                    <button onClick={() => { setMapName(null); setMapClientId(''); }} className="px-3 py-2 rounded-lg text-sm" style={{ color: 'var(--text-secondary)' }}>Cancel</button>
                  </>
                ) : (
                  <button onClick={() => { setMapName(n); setMapClientId(''); }} className="px-3 py-2 rounded-lg text-sm font-semibold" style={{ background: 'var(--bg-elevated)', color: 'var(--accent)', border: '1px solid var(--border)' }}>Map</button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Import history */}
      <div className="rounded-2xl overflow-hidden" style={card}>
        <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border)' }}><h2 className="text-sm font-bold text-text-primary">Recent uploads</h2></div>
        {log.length === 0 ? (
          <p className="px-5 py-6 text-sm" style={{ color: 'var(--text-muted)' }}>No brokerage uploaded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr style={{ color: 'var(--text-muted)' }} className="text-left text-xs uppercase tracking-wider">
                <th className="px-5 py-2 font-semibold">When</th><th className="px-5 py-2 font-semibold">File</th><th className="px-5 py-2 font-semibold">Months</th>
                <th className="px-5 py-2 font-semibold text-right">Rows</th><th className="px-5 py-2 font-semibold text-right">Matched</th><th className="px-5 py-2 font-semibold text-right">Total</th>
              </tr></thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-5 py-2.5" style={{ color: 'var(--text-secondary)' }}>{new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td className="px-5 py-2.5 text-text-primary"><span className="text-xs font-mono truncate max-w-[180px] block">{r.source_file ?? '—'}</span></td>
                    <td className="px-5 py-2.5" style={{ color: 'var(--text-secondary)' }}>{r.months_covered ?? '—'}</td>
                    <td className="px-5 py-2.5 text-right text-text-primary">{r.rows_total}</td>
                    <td className="px-5 py-2.5 text-right text-text-primary">{r.matched}/{r.matched + r.unmatched}</td>
                    <td className="px-5 py-2.5 text-right text-text-primary">{fmt(Number(r.amount_total))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
