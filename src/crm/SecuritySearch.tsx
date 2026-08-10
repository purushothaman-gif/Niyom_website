import React, { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { Search, Loader2, CheckCircle2, AlertCircle, Pencil, X } from 'lucide-react';

// Trading-terminal-style security lookup backed by the nsdl-search edge function
// (local cache first, NSDL on miss — never called directly from the browser).
// Selecting a result auto-fills Security Name + ISIN in the parent deal form.
// A manual-entry fallback ensures an employee is never trapped if NSDL can't
// find a security.

export interface SecurityResult {
  isin: string;
  name: string;
  security_name: string;
  security_type: string;
  isin_status: string;
  nsdl_id?: string;
}

interface Props {
  valueName: string;
  valueIsin: string;
  onSelect: (sec: SecurityResult) => void;
  onManualChange: (patch: { security_name?: string; isin?: string }) => void;
  /** Fires when the user enters/leaves manual entry. The parent uses this to
   *  unlock Product Type (which is otherwise auto-derived from the NSDL pick). */
  onManualToggle?: (manual: boolean) => void;
  disabled?: boolean;
}

const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';
const FN_URL = `${SUPABASE_URL}/functions/v1/nsdl-search`;

const DEBOUNCE_MS = 300;
const MIN_NAME_LEN = 2;

// Employee pastes something ISIN-shaped → search by ISIN, else by name.
const looksLikeIsin = (q: string) => /^[A-Z]{2}[A-Z0-9]{9,10}$/i.test(q.trim());

function statusStyle(status: string): { bg: string; color: string } {
  switch (status?.toUpperCase()) {
    case 'ACTIVE':    return { bg: 'rgba(16,185,129,0.12)', color: 'var(--success)' };
    case 'SUSPENDED': return { bg: 'rgba(245,158,11,0.12)', color: 'var(--warning)' };
    case 'DELETED':   return { bg: 'rgba(239,68,68,0.12)',  color: 'var(--danger)' };
    default:          return { bg: 'rgba(107,107,107,0.12)', color: 'var(--text-secondary)' };
  }
}

export default function SecuritySearch({ valueName, valueIsin, onSelect, onManualChange, onManualToggle, disabled }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SecurityResult[]>([]);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [manual, setManual] = useState(false);
  const [selected, setSelected] = useState<SecurityResult | null>(
    valueName || valueIsin
      ? { isin: valueIsin, name: valueName, security_name: valueName, security_type: '', isin_status: '' }
      : null,
  );

  const wrapRef = useRef<HTMLDivElement>(null);
  const reqIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef('');

  // Close on outside click (same pattern as the client autocomplete).
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const runSearch = useCallback(async (raw: string) => {
    const q = raw.trim();
    const mode = looksLikeIsin(q) ? 'isin' : 'name';
    if (mode === 'name' && q.length < MIN_NAME_LEN) {
      setResults([]); setLoading(false); setError(null);
      return;
    }
    // Skip a duplicate identical request.
    if (q === lastQueryRef.current) return;
    lastQueryRef.current = q;

    // Cancel any in-flight request.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const reqId = ++reqIdRef.current;

    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${session?.access_token || SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ query: q, mode, limit: 10 }),
        signal: controller.signal,
      });
      const payload = await res.json().catch(() => ({}));
      if (reqId !== reqIdRef.current) return; // a newer request superseded us
      if (!res.ok || payload?.source === 'degraded') {
        setResults(payload?.results ?? []);
        setError('Search service is temporarily unavailable. You can enter details manually.');
      } else {
        setResults(payload?.results ?? []);
      }
      setActiveIdx((payload?.results ?? []).length > 0 ? 0 : -1);
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return;
      if (reqId !== reqIdRef.current) return;
      setResults([]);
      setError('Search failed. Check your connection or enter details manually.');
    } finally {
      if (reqId === reqIdRef.current) setLoading(false);
    }
  }, []);

  // Debounced search on query change.
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => { runSearch(query); }, DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query, open, runSearch]);

  const choose = (sec: SecurityResult) => {
    setSelected(sec);
    onSelect(sec);
    setQuery('');
    setResults([]);
    setOpen(false);
    setError(null);
    lastQueryRef.current = '';
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      if (activeIdx >= 0 && results[activeIdx]) {
        e.preventDefault();
        choose(results[activeIdx]);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const clearSelection = () => {
    setSelected(null);
    onManualChange({ security_name: '', isin: '' });
    setQuery('');
    setOpen(true);
  };

  // Single place to flip manual mode so the parent is always told (to lock/unlock
  // the auto-derived Product Type).
  const switchManual = (v: boolean) => { setManual(v); onManualToggle?.(v); };

  return (
    <div className="space-y-4">
      {/* Search box */}
      <div ref={wrapRef} className="relative">
        <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
          Search Security (NSDL) <span style={{ color: 'var(--accent)' }}>*</span>
        </label>
        <div className="relative">
          {loading
            ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin" style={{ color: 'var(--accent)' }} />
            : <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-faint)' }} />}
          <input
            value={query}
            disabled={disabled}
            onChange={e => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Type a company name (e.g. AKARA) or paste an ISIN…"
            className="w-full pl-9 pr-4 py-2.5 rounded-xl text-sm text-text-primary outline-none"
            style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}
            autoComplete="off"
          />
        </div>

        {open && (query.trim().length > 0 || loading || error) && (
          <div className="absolute z-30 w-full mt-1 rounded-xl overflow-hidden shadow-2xl"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', maxHeight: 300, overflowY: 'auto' }}>
            {/* Loading */}
            {loading && results.length === 0 && (
              <div className="px-4 py-4 text-sm flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
                <Loader2 className="w-4 h-4 animate-spin" /> Searching NSDL…
              </div>
            )}
            {/* Error */}
            {!loading && error && (
              <div className="px-4 py-3 text-sm flex items-start gap-2" style={{ color: 'var(--warning)' }}>
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span style={{ color: 'var(--text-secondary)' }}>{error}</span>
              </div>
            )}
            {/* Empty */}
            {!loading && !error && results.length === 0 && query.trim().length >= MIN_NAME_LEN && (
              <div className="px-4 py-4 text-sm" style={{ color: 'var(--text-secondary)' }}>
                No securities found. Use <button type="button" onClick={() => { switchManual(true); setOpen(false); }} className="underline" style={{ color: 'var(--accent)' }}>manual entry</button>.
              </div>
            )}
            {/* Results */}
            {results.map((r, idx) => {
              const st = statusStyle(r.isin_status);
              return (
                <button
                  key={r.isin + r.nsdl_id}
                  type="button"
                  onClick={() => choose(r)}
                  onMouseEnter={() => setActiveIdx(idx)}
                  className="w-full text-left px-4 py-3 transition-colors"
                  style={{
                    borderBottom: '1px solid var(--bg-raised)',
                    background: idx === activeIdx ? 'rgba(var(--accent-rgb),0.10)' : 'transparent',
                  }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{r.name}</span>
                    {r.isin_status && (
                      <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0"
                        style={{ background: st.bg, color: st.color }}>{r.isin_status}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>{r.isin}</span>
                    {r.security_type && <span className="text-xs" style={{ color: 'var(--text-faint)' }}>· {r.security_type}</span>}
                  </div>
                  {r.security_name && r.security_name !== r.name && (
                    <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-faint)' }}>{r.security_name}</p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Selected security — auto-filled context (read-only) */}
      {selected && (selected.isin || selected.security_name) && !manual && (
        <div className="rounded-xl p-4" style={{ background: 'rgba(var(--accent-rgb),0.04)', border: '1px solid rgba(var(--accent-rgb),0.12)' }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" style={{ color: 'var(--success)' }} />
                <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-bright)' }}>
                  {selected.security_name || selected.name}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 pl-6">
                <span className="font-mono text-xs" style={{ color: 'var(--accent)' }}>{selected.isin || '—'}</span>
                {selected.security_type && <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{selected.security_type}</span>}
                {selected.isin_status && (
                  <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
                    style={statusStyle(selected.isin_status)}>{selected.isin_status}</span>
                )}
              </div>
            </div>
            <button type="button" onClick={clearSelection}
              className="text-xs flex items-center gap-1 shrink-0 px-2 py-1 rounded-lg"
              style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              <X className="w-3 h-3" /> Change
            </button>
          </div>
        </div>
      )}

      {/* Manual-entry fallback */}
      {!manual ? (
        !selected && (
          <button type="button" onClick={() => switchManual(true)}
            className="text-xs flex items-center gap-1.5" style={{ color: 'var(--text-secondary)' }}>
            <Pencil className="w-3 h-3" /> Can't find it? Enter manually
          </button>
        )
      ) : (
        <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>Manual Entry</p>
            <button type="button" onClick={() => switchManual(false)} className="text-xs underline" style={{ color: 'var(--accent)' }}>Back to search</button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>Security / Company Name</label>
              <input value={valueName} onChange={e => onManualChange({ security_name: e.target.value })}
                placeholder="e.g. Tata Motors Ltd"
                className="w-full px-3.5 py-2.5 rounded-xl text-sm text-text-primary outline-none"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }} />
            </div>
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>ISIN Number</label>
              <input value={valueIsin} onChange={e => onManualChange({ isin: e.target.value.toUpperCase() })}
                placeholder="INE001A01036" maxLength={12}
                className="w-full px-3.5 py-2.5 rounded-xl text-sm text-text-primary outline-none font-mono"
                style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
