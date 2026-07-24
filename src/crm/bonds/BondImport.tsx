// Daily price upload — reads ONLY ISIN / Bond Name / Price from the vendor Excel,
// previews, then create-or-price-updates the master. New ISINs are queued for
// automatic enrichment (Phase 1).

import { useRef, useState } from 'react';
import { ArrowLeft, UploadCloud, FileSpreadsheet, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { parsePriceFile } from './excelImport';
import { ParsedImportRow, ImportRow, ImportSummary } from './bondTypes';
import { useImportPrices, enrichPendingLoop, recomputeAllActive } from './bondClient';

interface Props { onBack: () => void; onDone: () => void; }
type Phase = 'select' | 'parsing' | 'preview' | 'done';

export default function BondImport({ onBack, onDone }: Props) {
  const [phase, setPhase] = useState<Phase>('select');
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ParsedImportRow[]>([]);
  const [matched, setMatched] = useState({ isin: false, name: false, price: false });
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [enrich, setEnrich] = useState<{ running: boolean; done: number; total: number } | null>(null);
  const [refresh, setRefresh] = useState<{ running: boolean; done: number; total: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const importMut = useImportPrices();

  const handleFile = async (file: File) => {
    setFileName(file.name); setError(null); setPhase('parsing');
    try {
      const res = await parsePriceFile(file);
      if (res.rows.length === 0) { setError(res.message ?? 'No rows found.'); setPhase('select'); return; }
      setRows(res.rows); setMatched(res.matchedHeaders); setPhase('preview');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to read the file.'); setPhase('select');
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files?.[0]; if (f) handleFile(f);
  };

  const valid = rows.filter(r => r.valid);
  const invalid = rows.length - valid.length;

  const doImport = async () => {
    setError(null);
    const payload: ImportRow[] = valid.map(r => ({ isin: r.isin, bond_name: r.bond_name, price: r.price, extra: r.extra }));
    try {
      const res = await importMut.mutateAsync(payload);
      setSummary(res); setPhase('done');
      // 1) Master any new / still-pending bonds, then 2) refresh yields & cashflows
      // on every active bond so they reflect today's price (price changed on update).
      (async () => {
        if (res.created > 0) {
          setEnrich({ running: true, done: 0, total: res.created });
          try { const done = await enrichPendingLoop(d => setEnrich(e => e ? { ...e, done: d } : e)); setEnrich({ running: false, done, total: Math.max(res.created, done) }); }
          catch { setEnrich(e => e ? { ...e, running: false } : e); }
        }
        setRefresh({ running: true, done: 0, total: 0 });
        try { const n = await recomputeAllActive((done, total) => setRefresh({ running: true, done, total })); setRefresh({ running: false, done: n, total: n }); }
        catch { setRefresh(r => r ? { ...r, running: false } : r); }
      })();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    }
  };

  if (phase === 'done' && summary) {
    return (
      <div className="max-w-lg mx-auto text-center py-16">
        <CheckCircle2 className="w-12 h-12 mx-auto mb-4" style={{ color: 'rgb(16,185,129)' }} />
        <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Prices imported</h1>
        <div className="flex items-center justify-center gap-6 my-6 flex-wrap">
          {([['Updated', summary.updated], ['New bonds', summary.created], ['Removed', summary.removed], ['Skipped', summary.skipped]] as const).map(([label, n]) => (
            <div key={label}>
              <p className="text-3xl font-extrabold" style={{ color: 'var(--text-primary)' }}>{n}</p>
              <p className="text-xs uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{label}</p>
            </div>
          ))}
        </div>
        {enrich && (
          <div className="mb-6 rounded-xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-center gap-2 mb-1">
              {enrich.running && <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />}
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {enrich.running ? 'Mastering bond data…' : 'Mastering complete'}
              </span>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {enrich.done} of {enrich.total} bonds fetched &amp; analytics computed{enrich.running ? '' : ' ✓'}
            </p>
            {enrich.running && (
              <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-base)' }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (enrich.done / Math.max(1, enrich.total)) * 100)}%`, background: 'var(--accent)' }} />
              </div>
            )}
          </div>
        )}
        {refresh && (
          <div className="mb-6 rounded-xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
            <div className="flex items-center justify-center gap-2 mb-1">
              {refresh.running && <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />}
              <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {refresh.running ? 'Refreshing yields to today’s price…' : 'Yields refreshed'}
              </span>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {refresh.done}{refresh.total ? ` of ${refresh.total}` : ''} bonds recomputed{refresh.running ? '' : ' ✓'}
            </p>
          </div>
        )}
        <button onClick={onDone} className="px-5 py-2.5 rounded-xl text-sm font-bold text-on-accent" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>Back to master</button>
      </div>
    );
  }

  if (phase === 'select' || phase === 'parsing') {
    return (
      <div className="max-w-3xl mx-auto">
        <button onClick={onBack} className="flex items-center gap-2 text-sm font-semibold mb-5" style={{ color: 'var(--text-secondary)' }}>
          <ArrowLeft className="w-4 h-4" /> Back to master
        </button>
        <h1 className="text-2xl font-bold mb-1" style={{ color: 'var(--text-primary)' }}>Upload Daily Price File</h1>
        <p className="text-sm mb-6" style={{ color: 'var(--text-faint)' }}>Only <strong>ISIN</strong>, <strong>Bond Name</strong> and <strong>Price</strong> are read — every other column is ignored. Columns are matched by header name, so vendor layout changes are fine.</p>
        {error && <p className="text-sm mb-4" style={{ color: 'rgb(239,68,68)' }}>{error}</p>}
        <div onDragOver={e => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className="rounded-2xl border-2 border-dashed p-12 text-center cursor-pointer transition-all"
          style={{ borderColor: dragOver ? 'var(--accent)' : 'var(--border)', background: dragOver ? 'rgba(var(--accent-soft-rgb),0.06)' : 'var(--bg-surface)' }}>
          {phase === 'parsing' ? (
            <><Loader2 className="w-8 h-8 mx-auto mb-3 animate-spin" style={{ color: 'var(--accent)' }} /><p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Reading {fileName}…</p></>
          ) : (
            <><UploadCloud className="w-8 h-8 mx-auto mb-3" style={{ color: 'var(--text-faint)' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Drop the Excel here, or click to browse</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>.xlsx / .xls / .csv</p></>
          )}
          <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
        </div>
      </div>
    );
  }

  // preview
  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button onClick={onBack} className="flex items-center gap-2 text-sm font-semibold mb-2" style={{ color: 'var(--text-secondary)' }}>
            <ArrowLeft className="w-4 h-4" /> Cancel
          </button>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Preview</h1>
          <div className="flex items-center gap-2 mt-1.5 flex-wrap text-xs">
            <span className="flex items-center gap-1" style={{ color: 'var(--text-faint)' }}><FileSpreadsheet className="w-3.5 h-3.5" />{fileName}</span>
            <span style={{ color: 'var(--text-faint)' }}>·</span>
            <span style={{ color: 'var(--text-secondary)' }}>{valid.length} valid</span>
            {invalid > 0 && <><span style={{ color: 'var(--text-faint)' }}>·</span><span className="font-semibold" style={{ color: 'rgb(245,158,11)' }}>{invalid} skipped</span></>}
          </div>
          <div className="flex items-center gap-2 mt-2 text-[11px]">
            {(['isin', 'name', 'price'] as const).map(k => (
              <span key={k} className="px-2 py-0.5 rounded-lg font-semibold" style={{ background: matched[k] ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)', color: matched[k] ? 'rgb(16,185,129)' : 'rgb(239,68,68)' }}>
                {k.toUpperCase()} {matched[k] ? 'found' : 'missing'}
              </span>
            ))}
          </div>
        </div>
        <button disabled={valid.length === 0 || importMut.isPending} onClick={doImport}
          className="px-5 py-2.5 rounded-xl text-sm font-bold text-on-accent disabled:opacity-40 flex items-center gap-2"
          style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
          {importMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          Import {valid.length} Bond{valid.length === 1 ? '' : 's'}
        </button>
      </div>

      {!matched.price && (
        <div className="p-3 rounded-xl flex items-start gap-2 text-xs" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)' }}>
          <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: 'rgb(245,158,11)' }} />
          <span style={{ color: 'var(--text-secondary)' }}>No price column was detected — bonds will be created/kept without a price update.</span>
        </div>
      )}
      {error && <p className="text-sm" style={{ color: 'rgb(239,68,68)' }}>{error}</p>}

      <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0" style={{ background: 'var(--bg-surface)' }}>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['#', 'ISIN', 'Bond Name', 'Price', ''].map(h => (
                  <th key={h} className="px-3 py-2 text-left font-bold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border-subtle)', opacity: r.valid ? 1 : 0.5 }}>
                  <td className="px-3 py-1.5" style={{ color: 'var(--text-faint)' }}>{r.rowNumber}</td>
                  <td className="px-3 py-1.5 font-mono" style={{ color: 'var(--text-secondary)' }}>{r.isin}</td>
                  <td className="px-3 py-1.5 max-w-[360px] truncate" style={{ color: 'var(--text-primary)' }}>{r.bond_name || '—'}</td>
                  <td className="px-3 py-1.5 text-right" style={{ color: 'var(--text-secondary)' }}>{r.price === null ? '—' : r.price}</td>
                  <td className="px-3 py-1.5">{!r.valid && <span className="text-[11px]" style={{ color: 'rgb(245,158,11)' }}>{r.issue}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
