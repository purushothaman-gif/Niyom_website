import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { supabase } from '../../lib/supabase';
import { NWEmployee } from '../types';
import { fmt, fmtDate } from '../utils';
import { Database, Upload, RefreshCw, CheckCircle2, AlertTriangle, FileWarning } from 'lucide-react';

interface Props { employee: NWEmployee; }

interface ImportSummary {
  ok: boolean;
  registrar?: string;
  report?: string;
  sourceFile?: string | null;
  snapshotDate?: string | null;
  rowsTotal?: number;
  foliosUpserted?: number;
  holdingsUpserted?: number;
  matched?: number;
  unmatched?: number;
  error?: string;
}

interface LogRow {
  id: string;
  created_at: string;
  registrar: string | null;
  report: string | null;
  source_file: string | null;
  snapshot_date: string | null;
  rows_total: number;
  matched: number;
  unmatched: number;
  status: string;
  error: string | null;
}

interface UnmatchedFolio {
  id: string;
  registrar: string;
  folio: string;
  holder_name: string | null;
  pan: string | null;
  amc_code: string | null;
}

const MAX_BYTES = 8 * 1024 * 1024;

export default function MfFeeds({ employee }: Props) {
  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';
  const [registrar, setRegistrar] = useState<'CAMS' | 'KFINTECH'>('CAMS');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [error, setError] = useState('');
  const [log, setLog] = useState<LogRow[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedFolio[]>([]);
  const [stats, setStats] = useState({ folios: 0, matched: 0, value: 0 });
  const [loading, setLoading] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    setLoading(true);
    const [logRes, unmatchedRes, folioCount, matchedCount, holdingsRes] = await Promise.all([
      supabase.from('mf_rta_import_log').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('mf_rta_folios').select('id, registrar, folio, holder_name, pan, amc_code')
        .is('client_id', null).order('last_seen_at', { ascending: false }).limit(50),
      supabase.from('mf_rta_folios').select('id', { count: 'exact', head: true }),
      supabase.from('mf_rta_folios').select('id', { count: 'exact', head: true }).not('client_id', 'is', null),
      supabase.from('mf_rta_holdings').select('rta_value'),
    ]);
    setLog((logRes.data as LogRow[]) ?? []);
    setUnmatched((unmatchedRes.data as UnmatchedFolio[]) ?? []);
    const value = ((holdingsRes.data as { rta_value: number | null }[]) ?? [])
      .reduce((s, h) => s + (h.rta_value ?? 0), 0);
    setStats({ folios: folioCount.count ?? 0, matched: matchedCount.count ?? 0, value });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const onImport = async () => {
    setError('');
    setResult(null);
    const file = fileRef.current?.files?.[0];
    if (!file) { setError('Choose a mailback ZIP first.'); return; }
    if (file.size > MAX_BYTES) { setError('That file is larger than 8 MB.'); return; }

    setBusy(true);
    try {
      const dataBase64: string = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error('Could not read the file.'));
        reader.readAsDataURL(file);
      });

      const { data, error: fnErr } = await supabase.functions.invoke('mf-rta-import', {
        body: { fileName: file.name, dataBase64, registrar },
      });
      if (fnErr) {
        // The function returns a JSON { error } body on failure; surface it.
        let msg = fnErr.message;
        try {
          const ctx = (fnErr as unknown as { context?: Response }).context;
          if (ctx && typeof ctx.json === 'function') {
            const body = await ctx.json();
            if (body?.error) msg = body.error;
          }
        } catch { /* keep fnErr.message */ }
        throw new Error(msg);
      }
      const summary = data as ImportSummary;
      if (!summary?.ok) throw new Error(summary?.error || 'Import failed.');
      setResult(summary);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  const card: CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border)' };

  // Defence in depth: the page is already admin-gated in CRM routing, but the
  // feed carries the whole book's PANs and contacts, so refuse here too.
  if (!isAdmin) {
    return (
      <div className="rounded-2xl p-6 text-sm" style={card}>
        <p style={{ color: 'var(--text-muted)' }}>MF Feeds is available to admins only.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Mutual Funds</p>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <Database className="w-6 h-6" style={{ color: 'var(--accent)' }} /> MF Feeds
          </h1>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            Import the registrar mailback feed (CAMS WBR9 / CRMS) to populate client MF holdings.
            Folios are matched to clients by PAN.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold"
          style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl p-4" style={card}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Folios imported</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{stats.folios.toLocaleString('en-IN')}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{stats.matched.toLocaleString('en-IN')} matched to a client</p>
        </div>
        <div className="rounded-2xl p-4" style={card}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Unmatched folios</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{unmatched.length.toLocaleString('en-IN')}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>No client with this PAN yet</p>
        </div>
        <div className="rounded-2xl p-4" style={card}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>MF value (registrar)</p>
          <p className="text-2xl font-bold text-text-primary mt-1">{fmt(stats.value)}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Latest snapshot across all folios</p>
        </div>
      </div>

      {/* Upload */}
      <div className="rounded-2xl p-5" style={card}>
        <h2 className="text-lg font-bold text-text-primary mb-3">Import a feed</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Registrar</label>
            <select
              value={registrar}
              onChange={(e) => setRegistrar(e.target.value as 'CAMS' | 'KFINTECH')}
              className="px-3 py-2.5 rounded-xl text-sm text-text-primary outline-none"
              style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}
            >
              <option value="CAMS">CAMS (WBR9)</option>
              <option value="KFINTECH">KFintech</option>
            </select>
          </div>
          <div className="flex-1 min-w-[220px]">
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>Mailback ZIP</label>
            <input
              ref={fileRef}
              type="file"
              accept=".zip"
              className="block w-full text-sm text-text-primary file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:cursor-pointer"
            />
          </div>
          <button
            onClick={onImport}
            disabled={busy}
            className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
            style={{ background: 'var(--accent)' }}
          >
            <Upload className={`w-4 h-4 ${busy ? 'animate-pulse' : ''}`} /> {busy ? 'Importing…' : 'Import'}
          </button>
        </div>

        {registrar === 'KFINTECH' && (
          <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
            KFintech layouts are added once a feed with data is available; CAMS WBR9 is supported today.
          </p>
        )}

        {error && (
          <div className="mt-4 p-3 rounded-xl text-sm text-c-red flex items-start gap-2" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </div>
        )}

        {result?.ok && (
          <div className="mt-4 p-4 rounded-xl text-sm" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)' }}>
            <p className="font-semibold text-text-primary flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--c-green, #16a34a)' }} />
              Imported {result.sourceFile ?? 'feed'}{result.snapshotDate ? ` · snapshot ${fmtDate(result.snapshotDate)}` : ''}
            </p>
            <p className="mt-1" style={{ color: 'var(--text-secondary)' }}>
              {result.foliosUpserted ?? 0} folios · {result.holdingsUpserted ?? 0} holdings ·
              {' '}{result.matched ?? 0} newly matched · {result.unmatched ?? 0} unmatched
            </p>
          </div>
        )}
      </div>

      {/* Unmatched folios */}
      {unmatched.length > 0 && (
        <div className="rounded-2xl overflow-hidden" style={card}>
          <div className="px-5 py-3 flex items-center gap-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <FileWarning className="w-4 h-4" style={{ color: 'var(--accent)' }} />
            <h2 className="text-sm font-bold text-text-primary">Unmatched folios</h2>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>— no client has this PAN yet</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--text-muted)' }} className="text-left text-xs uppercase tracking-wider">
                  <th className="px-5 py-2 font-semibold">Folio</th>
                  <th className="px-5 py-2 font-semibold">Holder</th>
                  <th className="px-5 py-2 font-semibold">PAN</th>
                  <th className="px-5 py-2 font-semibold">AMC</th>
                  <th className="px-5 py-2 font-semibold">Registrar</th>
                </tr>
              </thead>
              <tbody>
                {unmatched.map((f) => (
                  <tr key={f.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-5 py-2.5 text-text-primary font-mono text-xs">{f.folio}</td>
                    <td className="px-5 py-2.5 text-text-primary">{f.holder_name ?? '—'}</td>
                    <td className="px-5 py-2.5" style={{ color: 'var(--text-secondary)' }}>{f.pan ?? '—'}</td>
                    <td className="px-5 py-2.5" style={{ color: 'var(--text-secondary)' }}>{f.amc_code ?? '—'}</td>
                    <td className="px-5 py-2.5" style={{ color: 'var(--text-secondary)' }}>{f.registrar}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import history */}
      <div className="rounded-2xl overflow-hidden" style={card}>
        <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
          <h2 className="text-sm font-bold text-text-primary">Recent imports</h2>
        </div>
        {log.length === 0 ? (
          <p className="px-5 py-6 text-sm" style={{ color: 'var(--text-muted)' }}>No feeds imported yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: 'var(--text-muted)' }} className="text-left text-xs uppercase tracking-wider">
                  <th className="px-5 py-2 font-semibold">When</th>
                  <th className="px-5 py-2 font-semibold">Feed</th>
                  <th className="px-5 py-2 font-semibold">Snapshot</th>
                  <th className="px-5 py-2 font-semibold text-right">Rows</th>
                  <th className="px-5 py-2 font-semibold text-right">Matched</th>
                  <th className="px-5 py-2 font-semibold text-right">Unmatched</th>
                  <th className="px-5 py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {log.map((r) => (
                  <tr key={r.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td className="px-5 py-2.5" style={{ color: 'var(--text-secondary)' }}>
                      {new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                    </td>
                    <td className="px-5 py-2.5 text-text-primary">
                      {r.registrar ?? '—'} {r.report ?? ''}
                      <span className="block text-xs font-mono truncate max-w-[200px]" style={{ color: 'var(--text-muted)' }}>{r.source_file ?? ''}</span>
                    </td>
                    <td className="px-5 py-2.5" style={{ color: 'var(--text-secondary)' }}>{r.snapshot_date ? fmtDate(r.snapshot_date) : '—'}</td>
                    <td className="px-5 py-2.5 text-right text-text-primary">{r.rows_total}</td>
                    <td className="px-5 py-2.5 text-right text-text-primary">{r.matched}</td>
                    <td className="px-5 py-2.5 text-right text-text-primary">{r.unmatched}</td>
                    <td className="px-5 py-2.5">
                      {r.status === 'ok' ? (
                        <span className="text-xs font-semibold" style={{ color: 'var(--c-green, #16a34a)' }}>OK</span>
                      ) : (
                        <span className="text-xs font-semibold text-c-red" title={r.error ?? ''}>Error</span>
                      )}
                    </td>
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
