/**
 * The fund list used by collections and search results: a sortable 1Y/3Y/5Y
 * table on desktop, and the same rows as cards on a phone (a five-column table
 * at 375px is unreadable, and this is a screen people open on a phone).
 */
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { CatalogFund } from '../../../types/funds';
import { Card } from '../../../components/Card';
import { fmtRet, retColor, FundIdentity, RETURNS_FOOTNOTE } from './catalogBits';
import { byReturn, ret, type ReturnKey } from './collections';

const COLUMNS: ReturnKey[] = ['1Y', '3Y', '5Y'];

interface Props {
  funds: CatalogFund[];
  sortBy: ReturnKey;
  onSort: (key: ReturnKey) => void;
  onOpen: (amfiCode: string) => void;
}

export function FundTable({ funds, sortBy, onSort, onOpen }: Props) {
  const rows = [...funds].sort(byReturn(sortBy));

  return (
    <div className="space-y-3">
      <Card padding="none" className="overflow-hidden">
        {/* Header — desktop only; the cards carry their own labels. */}
        <div className="hidden border-b border-border-subtle px-5 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_repeat(3,88px)] sm:gap-3">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-text-faint">
            Fund name
          </span>
          {COLUMNS.map((c) => {
            const active = c === sortBy;
            return (
              <button
                key={c}
                type="button"
                onClick={() => onSort(c)}
                className={`flex items-center justify-end gap-1 text-[11px] font-semibold uppercase tracking-wide transition-colors ${
                  active ? 'text-accent' : 'text-text-faint hover:text-text-primary'
                }`}
                aria-pressed={active}
              >
                {c}
                {active ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3 opacity-40" />}
              </button>
            );
          })}
        </div>

        <ul className="divide-y divide-border-subtle">
          {rows.map((f) => (
            <li key={f.amfiCode}>
              <button
                type="button"
                onClick={() => onOpen(f.amfiCode)}
                className="w-full px-4 py-3.5 text-left transition-colors hover:bg-bg-surface sm:grid sm:grid-cols-[minmax(0,1fr)_repeat(3,88px)] sm:items-center sm:gap-3 sm:px-5"
              >
                <FundIdentity fund={f} />

                {/* Phone: a labelled returns strip under the name. */}
                <div className="mt-2.5 flex gap-5 pl-[52px] sm:hidden">
                  {COLUMNS.map((c) => (
                    <div key={c}>
                      <p className="text-[10px] uppercase tracking-wide text-text-faint">{c}</p>
                      <p className="text-xs font-bold" style={{ color: retColor(ret(f, c)) }}>
                        {fmtRet(ret(f, c))}
                      </p>
                    </div>
                  ))}
                </div>

                {/* Desktop: one column each. */}
                {COLUMNS.map((c) => (
                  <span
                    key={c}
                    className="hidden text-right text-sm font-bold sm:block"
                    style={{ color: retColor(ret(f, c)) }}
                  >
                    {fmtRet(ret(f, c))}
                  </span>
                ))}
              </button>
            </li>
          ))}
        </ul>
      </Card>

      <p className="px-1 text-[11px] leading-relaxed text-text-faint">{RETURNS_FOOTNOTE}</p>
    </div>
  );
}
