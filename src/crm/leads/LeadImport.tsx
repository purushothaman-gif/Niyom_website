import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { NWEmployee } from '../types';
import {
  ArrowLeft, Upload, FileSpreadsheet, Download, CheckCircle2, AlertCircle,
  Users, Inbox, Shuffle, Loader2,
} from 'lucide-react';
import { PrimaryButton, GhostButton } from './leadUi';
import {
  ParsedRow, parseLeadFile, downloadTemplate, roundRobinBuckets,
} from './leadImportUtils';
import { formatMoney } from './leadUtils';
import { LeadCategory } from './leadTypes';
import { LEAD_CATEGORIES } from './leadConstants';

interface Props { employee: NWEmployee; category: LeadCategory; onBack: () => void; onDone: () => void; }
type Step = 'upload' | 'preview' | 'result';
type Dist = 'pool' | 'round_robin';

interface Result { imported: number; skippedDup: number; skippedError: number; assigned: number; }

export default function LeadImport({ employee, category, onBack, onDone }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [importCategory, setImportCategory] = useState<LeadCategory>(category);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [dist, setDist] = useState<Dist>('pool');
  const [selectedEmps, setSelectedEmps] = useState<string[]>([]);
  const [employees, setEmployees] = useState<{ id: string; full_name: string; employee_code: string }[]>([]);
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    supabase.from('nw_employees').select('id, full_name, employee_code').eq('status', 'active').order('full_name')
      .then(({ data }) => setEmployees(data || []));
  }, []);

  const stats = useMemo(() => {
    const errors = rows.filter(r => r.errors.length > 0).length;
    const dups = rows.filter(r => r.errors.length === 0 && r.duplicate).length;
    const valid = rows.filter(r => r.errors.length === 0 && !r.duplicate).length;
    return { errors, dups, valid, total: rows.length };
  }, [rows]);

  const handleFile = async (file: File) => {
    setError(''); setParsing(true); setFileName(file.name);
    try {
      const parsed = await parseLeadFile(file);
      if (parsed.length === 0) { setError('The file has no data rows.'); setParsing(false); return; }

      // In-file duplicates: keep the first occurrence, flag the rest.
      const seen = new Set<string>();
      // Cross-CRM duplicate check (one round-trip).
      const mobiles = parsed.map(r => r.data.mobile).filter(Boolean);
      const emails = parsed.map(r => r.data.email).filter(Boolean);
      const pans = parsed.map(r => r.data.pan).filter(Boolean);
      const { data: dupData } = await supabase.rpc('nw_check_lead_duplicates_bulk', {
        p_mobiles: mobiles, p_emails: emails, p_pans: pans,
      });
      const dupSet = { mobile: new Set<string>(), email: new Set<string>(), pan: new Set<string>() };
      (dupData as { kind: string; value: string }[] | null)?.forEach(d => {
        if (d.kind === 'mobile') dupSet.mobile.add(d.value);
        if (d.kind === 'email') dupSet.email.add(d.value.toLowerCase());
        if (d.kind === 'pan') dupSet.pan.add(d.value.toUpperCase());
      });

      const marked = parsed.map(r => {
        const key = r.data.mobile || r.data.email || r.data.pan;
        let duplicate = r.duplicate;
        if (r.data.mobile && dupSet.mobile.has(r.data.mobile)) duplicate = { matched_on: 'mobile', owner_name: null, status: 'exists in CRM' };
        else if (r.data.email && dupSet.email.has(r.data.email)) duplicate = { matched_on: 'email', owner_name: null, status: 'exists in CRM' };
        else if (r.data.pan && dupSet.pan.has(r.data.pan)) duplicate = { matched_on: 'pan', owner_name: null, status: 'exists in CRM' };
        else if (key && seen.has(key)) duplicate = { matched_on: 'file', owner_name: null, status: 'duplicate row in file' };
        if (key) seen.add(key);
        return { ...r, duplicate };
      });
      setRows(marked); setStep('preview');
    } catch (e: any) {
      setError(e.message || 'Could not read the file. Use the provided template (.xlsx or .csv).');
    } finally {
      setParsing(false);
    }
  };

  const toggleEmp = (id: string) => setSelectedEmps(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);

  const runImport = async () => {
    const importable = rows.filter(r => r.errors.length === 0 && !r.duplicate);
    if (importable.length === 0) { setError('Nothing to import — all rows are errors or duplicates.'); return; }
    if (dist === 'round_robin' && selectedEmps.length === 0) { setError('Select at least one employee for round-robin.'); return; }
    setImporting(true); setError('');
    try {
      const payload = importable.map(r => ({
        ...r.data,
        lead_origin: 'admin_upload' as const,
        lead_category: importCategory,
        created_by_employee_id: employee.id,
        owner_employee_id: null,          // land in Admin Pool; round-robin assigns below
        status: 'New' as const,
      }));

      // Insert in chunks so large files don't hit request limits.
      const inserted: { id: string }[] = [];
      for (let i = 0; i < payload.length; i += 500) {
        const chunk = payload.slice(i, i + 500);
        const { data, error: e } = await supabase.from('nw_leads').insert(chunk).select('id');
        if (e) throw e;
        inserted.push(...((data as { id: string }[]) || []));
      }

      let assigned = 0;
      if (dist === 'round_robin' && inserted.length > 0) {
        const buckets = roundRobinBuckets(inserted.map(x => x.id), selectedEmps.length);
        for (let i = 0; i < selectedEmps.length; i++) {
          if (buckets[i].length === 0) continue;
          const { data: n } = await supabase.rpc('nw_assign_leads', {
            p_lead_ids: buckets[i], p_to_employee: selectedEmps[i], p_reason: 'Round-robin from bulk import',
          });
          assigned += (n as number) ?? buckets[i].length;
        }
      }

      setResult({ imported: inserted.length, skippedDup: stats.dups, skippedError: stats.errors, assigned });
      setStep('result');
    } catch (e: any) {
      setError(e.message || 'Import failed.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-10">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
          <ArrowLeft className="w-4 h-4" /> Back to Leads
        </button>
      </div>
      <div>
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Lead Management</p>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Bulk Import Leads</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>Upload an Excel or CSV file. Duplicates are detected and skipped automatically.</p>
      </div>

      {/* Stepper */}
      <div className="flex items-center gap-2 text-sm">
        {(['upload', 'preview', 'result'] as Step[]).map((s, i) => {
          const active = step === s;
          const done = (['upload', 'preview', 'result'] as Step[]).indexOf(step) > i;
          return (
            <div key={s} className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                style={{ background: active ? 'rgba(var(--accent-rgb),0.15)' : done ? 'rgba(16,185,129,0.15)' : 'var(--bg-raised)', color: active ? 'var(--accent)' : done ? 'var(--success)' : 'var(--text-faint)', border: `1px solid ${active ? 'var(--accent)' : done ? 'var(--success)' : 'var(--border)'}` }}>
                {done ? '✓' : i + 1}
              </span>
              <span className="capitalize font-medium" style={{ color: active ? 'var(--accent)' : 'var(--text-faint)' }}>{s}</span>
              {i < 2 && <span className="w-6 h-px" style={{ background: 'var(--border)' }} />}
            </div>
          );
        })}
      </div>

      {error && (
        <div className="p-3 rounded-xl flex items-center gap-2.5" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--danger)' }} />
          <p className="text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
        </div>
      )}

      {/* STEP 1 — upload */}
      {step === 'upload' && (
        <div className="space-y-4">
          <div className="rounded-2xl p-8 text-center" style={{ background: 'var(--bg-elevated)', border: '2px dashed var(--border)' }}>
            {parsing ? (
              <div className="py-6"><Loader2 className="w-8 h-8 animate-spin mx-auto" style={{ color: 'var(--accent)' }} /><p className="text-sm mt-3" style={{ color: 'var(--text-secondary)' }}>Reading & checking {fileName}…</p></div>
            ) : (
              <label className="cursor-pointer block">
                <div className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3" style={{ background: 'rgba(var(--accent-rgb),0.1)' }}>
                  <Upload className="w-7 h-7" style={{ color: 'var(--accent)' }} />
                </div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Click to upload Excel or CSV</p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>.xlsx, .xls or .csv · first sheet is used</p>
                <input type="file" className="hidden" accept=".xlsx,.xls,.csv"
                  onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
              </label>
            )}
          </div>
          <div className="flex items-center justify-between rounded-xl p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2.5">
              <FileSpreadsheet className="w-5 h-5" style={{ color: 'var(--accent)' }} />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Need the format?</p>
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Download the template with the exact columns.</p>
              </div>
            </div>
            <button onClick={() => downloadTemplate()} className="flex items-center gap-2 text-sm font-semibold px-3 py-2 rounded-lg"
              style={{ background: 'rgba(var(--accent-rgb),0.1)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.25)' }}>
              <Download className="w-4 h-4" /> Template
            </button>
          </div>
        </div>
      )}

      {/* STEP 2 — preview */}
      {step === 'preview' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard label="Total rows" value={stats.total} />
            <StatCard label="Will import" value={stats.valid} tone="success" />
            <StatCard label="Duplicates (skip)" value={stats.dups} tone="warning" />
            <StatCard label="Errors (skip)" value={stats.errors} tone="danger" />
          </div>

          {/* Dataset — which list these leads go into */}
          <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Import into</p>
            <div className="grid grid-cols-2 gap-3">
              {LEAD_CATEGORIES.map(c => (
                <button key={c.value} onClick={() => setImportCategory(c.value)}
                  className="px-3 py-2.5 rounded-xl text-sm font-bold transition-all"
                  style={{ background: importCategory === c.value ? 'linear-gradient(135deg, var(--accent), var(--accent-strong))' : 'var(--bg-base)', color: importCategory === c.value ? 'var(--text-on-accent)' : 'var(--text-secondary)', border: `1px solid ${importCategory === c.value ? 'var(--accent)' : 'var(--border)'}` }}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* Distribution */}
          <div className="rounded-2xl p-4 space-y-3" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--accent)' }}>Distribution</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <DistCard active={dist === 'pool'} onClick={() => setDist('pool')} icon={Inbox}
                title="Admin Pool" desc="Import unassigned. Distribute later from the pool." />
              <DistCard active={dist === 'round_robin'} onClick={() => setDist('round_robin')} icon={Shuffle}
                title="Auto Round-Robin" desc="Split evenly across the employees you pick." />
            </div>
            {dist === 'round_robin' && (
              <div>
                <p className="text-xs font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
                  <Users className="w-3.5 h-3.5" /> Select employees ({selectedEmps.length})
                </p>
                <div className="flex flex-wrap gap-2 max-h-40 overflow-y-auto">
                  {employees.map(e => {
                    const on = selectedEmps.includes(e.id);
                    return (
                      <button key={e.id} onClick={() => toggleEmp(e.id)}
                        className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all"
                        style={{ background: on ? 'rgba(var(--accent-rgb),0.12)' : 'var(--bg-base)', color: on ? 'var(--accent)' : 'var(--text-secondary)', border: `1px solid ${on ? 'var(--accent)' : 'var(--border)'}` }}>
                        {on && '✓ '}{e.full_name}
                      </button>
                    );
                  })}
                </div>
                {selectedEmps.length > 0 && (
                  <p className="text-[11px] mt-2" style={{ color: 'var(--text-faint)' }}>
                    ≈ {Math.ceil(stats.valid / selectedEmps.length)} leads each.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Preview table */}
          <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <div className="overflow-x-auto max-h-96">
              <table className="w-full text-sm">
                <thead className="sticky top-0" style={{ background: 'var(--bg-elevated)' }}>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['#', 'Verdict', 'Name', 'Mobile', 'Email', 'City', 'Product', 'Investment'].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--text-faint)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 500).map(r => {
                    const bad = r.errors.length > 0;
                    const dup = !bad && r.duplicate;
                    return (
                      <tr key={r.rowNumber} style={{ borderBottom: '1px solid var(--border-subtle)', opacity: bad || dup ? 0.6 : 1 }}>
                        <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-faint)' }}>{r.rowNumber}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          {bad ? <Verdict tone="danger" text={r.errors[0]} />
                            : dup ? <Verdict tone="warning" text={`Dup · ${r.duplicate!.matched_on}`} />
                            : <Verdict tone="success" text="Import" />}
                        </td>
                        <td className="px-3 py-2 text-xs font-medium truncate max-w-[160px]" style={{ color: 'var(--text-primary)' }}>{r.data.lead_name || '—'}</td>
                        <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{r.data.mobile || '—'}</td>
                        <td className="px-3 py-2 text-xs truncate max-w-[160px]" style={{ color: 'var(--text-secondary)' }}>{r.data.email || '—'}</td>
                        <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{r.data.city || '—'}</td>
                        <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>{r.data.interested_product || '—'}</td>
                        <td className="px-3 py-2 text-xs whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{formatMoney(r.data.investment_capacity)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length > 500 && <p className="text-[11px] px-3 py-2" style={{ color: 'var(--text-faint)' }}>Showing first 500 of {rows.length} rows. All valid rows will be imported.</p>}
          </div>

          <div className="flex items-center justify-between">
            <GhostButton onClick={() => { setStep('upload'); setRows([]); }}>Choose different file</GhostButton>
            <PrimaryButton onClick={runImport} disabled={importing || stats.valid === 0}>
              {importing ? 'Importing…' : `Import ${stats.valid} lead${stats.valid === 1 ? '' : 's'}`}
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* STEP 3 — result */}
      {step === 'result' && result && (
        <div className="rounded-2xl p-8 text-center space-y-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto" style={{ background: 'rgba(16,185,129,0.12)' }}>
            <CheckCircle2 className="w-8 h-8" style={{ color: 'var(--success)' }} />
          </div>
          <div>
            <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Import complete</h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              {result.imported} lead{result.imported === 1 ? '' : 's'} imported
              {result.assigned > 0 ? ` · ${result.assigned} auto-assigned` : ' into the Admin Pool'}.
            </p>
          </div>
          <div className="flex items-center justify-center gap-3 text-xs">
            <span className="px-3 py-1.5 rounded-lg" style={{ background: 'rgba(16,185,129,0.1)', color: 'var(--success)' }}>Imported {result.imported}</span>
            <span className="px-3 py-1.5 rounded-lg" style={{ background: 'rgba(251,191,36,0.1)', color: 'rgb(var(--warning-soft-rgb))' }}>Skipped dup {result.skippedDup}</span>
            <span className="px-3 py-1.5 rounded-lg" style={{ background: 'rgba(239,68,68,0.1)', color: 'var(--danger)' }}>Skipped error {result.skippedError}</span>
          </div>
          <div className="flex items-center justify-center gap-2 pt-2">
            <GhostButton onClick={() => { setStep('upload'); setRows([]); setResult(null); }}>Import another</GhostButton>
            <PrimaryButton onClick={onDone}>Go to Leads</PrimaryButton>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone?: 'success' | 'warning' | 'danger' }) {
  const rgb = tone === 'success' ? '16,185,129' : tone === 'warning' ? '251,191,36' : tone === 'danger' ? '239,68,68' : null;
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: rgb ? `rgb(${rgb})` : 'var(--text-primary)' }}>{value}</p>
    </div>
  );
}

function Verdict({ tone, text }: { tone: 'success' | 'warning' | 'danger'; text: string }) {
  const rgb = tone === 'success' ? '16,185,129' : tone === 'warning' ? '251,191,36' : '239,68,68';
  return (
    <span className="text-[11px] font-semibold px-2 py-0.5 rounded" style={{ background: `rgba(${rgb},0.12)`, color: `rgb(${rgb})` }}>{text}</span>
  );
}

function DistCard({ active, onClick, icon: Icon, title, desc }: { active: boolean; onClick: () => void; icon: any; title: string; desc: string }) {
  return (
    <button onClick={onClick} className="text-left p-4 rounded-xl transition-all"
      style={{ background: active ? 'rgba(var(--accent-rgb),0.08)' : 'var(--bg-base)', border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}` }}>
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4" style={{ color: active ? 'var(--accent)' : 'var(--text-muted)' }} />
        <p className="text-sm font-bold" style={{ color: active ? 'var(--accent)' : 'var(--text-primary)' }}>{title}</p>
      </div>
      <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{desc}</p>
    </button>
  );
}
