/**
 * DataTable — the console's one table.
 *
 * Most screens here are "a list of things from BSE", so they share one
 * implementation rather than each hand-rolling markup: consistent density,
 * sorting, sticky header, right-aligned numerics, and — the part that matters
 * most in this console — one honest empty state instead of a blank grid.
 *
 * Deliberately not virtualised: BSE pages cap out in the hundreds of rows, and
 * virtualisation would break Cmd-F, which staff actually use.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { ArrowUpDown, Inbox, Search } from 'lucide-react';

export interface Column<T> {
  key: string;
  header: string;
  /** Cell renderer. Omit to render `String(row[key])`. */
  render?: (row: T) => ReactNode;
  /** Value used for sorting and search. Omit to make the column inert. */
  value?: (row: T) => string | number;
  align?: 'left' | 'right';
  /** Tabular figures + right alignment for money and counts. */
  numeric?: boolean;
  width?: string;
}

interface Props<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Shown when there are no rows at all. Say WHY it is empty, not just "no data". */
  empty: { title: string; hint?: string };
  searchable?: boolean;
  searchPlaceholder?: string;
  onRowClick?: (row: T) => void;
  /** Right-hand toolbar slot — filters, segmented controls, export. */
  toolbar?: ReactNode;
  maxHeight?: string;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  empty,
  searchable = true,
  searchPlaceholder = 'Search…',
  onRowClick,
  toolbar,
  maxHeight,
}: Props<T>) {
  const [term, setTerm] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  const filtered = useMemo(() => {
    const q = term.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      columns.some((c) => {
        if (!c.value) return false;
        return String(c.value(r)).toLowerCase().includes(q);
      }),
    );
  }, [rows, columns, term]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.value) return filtered;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = col.value!(a);
      const bv = col.value!(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, sort, columns]);

  const toggleSort = (key: string) =>
    setSort((s) =>
      s?.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : null) : { key, dir: 'asc' },
    );

  return (
    <div className="rounded-token-lg border border-border-subtle bg-card">
      {(searchable || toolbar) && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3">
          {searchable && (
            <div className="flex min-w-[200px] flex-1 items-center gap-2 rounded-token-md border border-border bg-bg-base px-2.5 py-1.5">
              <Search className="h-3.5 w-3.5 shrink-0 text-text-faint" />
              <input
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder={searchPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-faint"
              />
              {term && (
                <span className="shrink-0 text-[10px] tabular-nums text-text-faint">
                  {sorted.length}
                </span>
              )}
            </div>
          )}
          {toolbar}
        </div>
      )}

      {sorted.length === 0 ? (
        <div className="px-6 py-14 text-center">
          <Inbox className="mx-auto mb-3 h-7 w-7 text-text-faint" />
          <p className="text-sm font-semibold text-text-primary">
            {term ? 'Nothing matches that search' : empty.title}
          </p>
          {(term ? 'Clear the search to see everything.' : empty.hint) && (
            <p className="mx-auto mt-1 max-w-sm text-xs leading-relaxed text-text-faint">
              {term ? 'Clear the search to see everything.' : empty.hint}
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto" style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}>
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-card">
              <tr className="border-b border-border-subtle">
                {columns.map((c) => (
                  <th
                    key={c.key}
                    style={c.width ? { width: c.width } : undefined}
                    className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-text-faint ${
                      c.numeric || c.align === 'right' ? 'text-right' : 'text-left'
                    }`}
                  >
                    {c.value ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(c.key)}
                        className={`inline-flex items-center gap-1 hover:text-text-secondary ${
                          sort?.key === c.key ? 'text-accent' : ''
                        }`}
                      >
                        {c.header}
                        <ArrowUpDown className="h-3 w-3 opacity-60" />
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={`border-b border-border-subtle/60 last:border-0 ${
                    onRowClick ? 'cursor-pointer hover:bg-bg-surface/60' : ''
                  }`}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={`px-4 py-3 align-middle text-xs text-text-secondary ${
                        c.numeric ? 'text-right tabular-nums' : c.align === 'right' ? 'text-right' : ''
                      }`}
                    >
                      {c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
