/**
 * Table primitives for the one screen that still hand-rolls its markup
 * (the audit log, whose rows have a shape DataTable doesn't fit).
 * Everything else uses ui/DataTable.
 */
import type { ReactNode } from 'react';

export function TableScroll({ children }: { children: ReactNode }) {
  return <div className="-mx-2 overflow-x-auto px-2">{children}</div>;
}

export const TH = ({ children, right }: { children: ReactNode; right?: boolean }) => (
  <th
    className={`whitespace-nowrap border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted ${
      right ? 'text-right' : 'text-left'
    }`}
  >
    {children}
  </th>
);

export const TD = ({ children, right }: { children: ReactNode; right?: boolean }) => (
  <td
    className={`whitespace-nowrap border-b border-border/60 px-3 py-2.5 text-xs text-text-primary ${
      right ? 'text-right' : ''
    }`}
  >
    {children}
  </td>
);
