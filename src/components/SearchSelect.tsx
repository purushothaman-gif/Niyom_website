/**
 * SearchSelect — a drop-in replacement for a long <select> (client pickers).
 * The trigger takes the host's own className/style so it looks like the
 * select it replaces; the list opens in a portal with a search box, so it is
 * never clipped by a scrolling modal.
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, ChevronDown, Check } from 'lucide-react';

export interface SearchSelectOption {
  value: string;
  label: string;
  /** Secondary text shown beside the label and searched too (e.g. client code). */
  sub?: string;
  /** Extra searchable text that is not displayed (phone, PAN, …). */
  keywords?: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SearchSelectOption[];
  /** Text on the trigger when nothing is selected. */
  placeholder?: string;
  /** A leading "no selection" row, e.g. { value: '', label: 'All Clients' }. */
  emptyOption?: SearchSelectOption;
  searchPlaceholder?: string;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

const MAX_ROWS = 200;
const norm = (s: string) => s.toLowerCase();
// Client codes exist both as NW-001-0025 and NW0010030; match ignoring separators.
const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

export function SearchSelect({
  value, onChange, options, placeholder = 'Select…', emptyOption,
  searchPlaceholder = 'Search by name or code', disabled, className, style,
}: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = (emptyOption && emptyOption.value === value ? emptyOption : null)
    ?? options.find(o => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim();
    const base = q
      ? options.filter(o => {
          const hay = `${o.label} ${o.sub ?? ''} ${o.keywords ?? ''}`;
          return norm(hay).includes(norm(q)) || (compact(q).length > 0 && compact(hay).includes(compact(q)));
        })
      : options;
    return emptyOption && !q ? [emptyOption, ...base] : base;
  }, [options, query, emptyOption]);
  const shown = filtered.slice(0, MAX_ROWS);

  const place = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom;
    const up = below < 320 && r.top > below;
    setRect({ left: r.left, top: up ? r.top : r.bottom, width: Math.max(r.width, 280), up });
  };

  useLayoutEffect(() => { if (open) place(); }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onMove = (e: Event) => {
      if (panelRef.current && e.target instanceof Node && panelRef.current.contains(e.target)) return;
      place();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('resize', onMove);
    window.addEventListener('scroll', onMove, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('resize', onMove);
      window.removeEventListener('scroll', onMove, true);
    };
  }, [open]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const openPanel = () => {
    if (disabled) return;
    setQuery('');
    const idx = filtered.findIndex(o => o.value === value);
    setActive(idx >= 0 ? idx : 0);
    setOpen(true);
  };
  const pick = (o: SearchSelectOption) => { onChange(o.value); setOpen(false); triggerRef.current?.focus(); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, shown.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) pick(shown[active]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); triggerRef.current?.focus(); }
  };

  return (
    <>
      <button ref={triggerRef} type="button" disabled={disabled}
        onClick={() => (open ? setOpen(false) : openPanel())}
        onKeyDown={e => { if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openPanel(); } }}
        className={`${className ?? ''} flex items-center gap-2 text-left`}
        style={{ ...style, ...(disabled ? { opacity: 0.65, cursor: 'not-allowed' } : null) }}
        aria-haspopup="listbox" aria-expanded={open}>
        <span className="flex-1 min-w-0 truncate" style={selected ? undefined : { color: 'var(--text-faint)' }}>
          {selected ? <>{selected.label}{selected.sub ? <span style={{ color: 'var(--text-faint)' }}> · {selected.sub}</span> : null}</> : placeholder}
        </span>
        <ChevronDown className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--text-faint)' }} />
      </button>

      {open && rect && createPortal(
        <div ref={panelRef} role="listbox" onKeyDown={onKey}
          className="fixed z-[1000] rounded-xl shadow-2xl overflow-hidden"
          style={{
            left: Math.min(rect.left, window.innerWidth - rect.width - 8), width: rect.width,
            ...(rect.up ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.top + 4 }),
            background: 'var(--bg-elevated)', border: '1px solid var(--border)',
          }}>
          <div className="p-2" style={{ borderBottom: '1px solid var(--border)' }}>
            <div className="relative">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: 'var(--text-faint)' }} />
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder={searchPlaceholder}
                className="w-full pl-8 pr-2 py-2 rounded-lg text-sm text-text-primary outline-none"
                style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }} />
            </div>
          </div>
          <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
            {shown.length === 0 ? (
              <p className="px-3 py-3 text-sm" style={{ color: 'var(--text-faint)' }}>No matches for “{query.trim()}”.</p>
            ) : shown.map((o, i) => {
              const on = o.value === value;
              return (
                <button key={`${o.value}-${i}`} type="button" data-idx={i}
                  onMouseEnter={() => setActive(i)} onClick={() => pick(o)}
                  className="w-full text-left px-3 py-2 text-sm flex items-center gap-2"
                  style={{ background: i === active ? 'rgba(var(--accent-rgb),0.1)' : 'transparent' }}>
                  <span className="flex-1 min-w-0 truncate text-text-primary">{o.label}</span>
                  {o.sub && <span className="text-xs font-mono flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{o.sub}</span>}
                  {on && <Check className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--accent)' }} />}
                </button>
              );
            })}
            {filtered.length > MAX_ROWS && (
              <p className="px-3 py-2 text-xs" style={{ color: 'var(--text-faint)' }}>
                Showing {MAX_ROWS} of {filtered.length} — type to narrow.
              </p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
