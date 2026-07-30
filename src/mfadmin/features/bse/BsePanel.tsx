/**
 * Shared chrome for the console's live-BSE views: loading, error, the
 * "not configured" notice, and an empty state — so each view only has to
 * render its table.
 */
import type { ReactNode } from 'react';
import { AlertTriangle, PlugZap, RefreshCw, type LucideIcon } from 'lucide-react';
import { Card } from '../../../portal/components/Card';
import { SectionHeader } from '../../../portal/components/SectionHeader';
import { EmptyState } from '../../../portal/components/EmptyState';
import { LogoLoader } from '../../../components/LogoLoader';
import { isBseConfigured } from '../../services/BseOpsService';

interface Props {
  title: string;
  icon: LucideIcon;
  loading: boolean;
  error: string | null;
  isEmpty: boolean;
  emptyText: string;
  onRefresh: () => void;
  children: ReactNode;
}

export function BsePanel({
  title,
  icon: Icon,
  loading,
  error,
  isEmpty,
  emptyText,
  onRefresh,
  children,
}: Props) {
  // Never imply BSE data when the proxy isn't wired — say so plainly.
  if (!isBseConfigured()) {
    return (
      <Card padding="lg" className="mx-auto max-w-lg text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-token-xl bg-accent/10">
          <PlugZap className="h-6 w-6 text-accent" />
        </span>
        <h2 className="font-display text-xl font-bold text-text-primary">{title}</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-text-secondary">
          Live data isn’t connected in this environment yet. Set{' '}
          <code className="rounded bg-bg-base px-1 py-0.5 text-[11px]">VITE_BSE_PROXY_URL</code> to
          point the console at the NIYOM BSE proxy.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <SectionHeader title={title} icon={Icon} />
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-token-md border border-border bg-bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary hover:text-accent disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {loading && (
        <div className="flex min-h-[240px] items-center justify-center">
          <LogoLoader size={44} />
        </div>
      )}

      {!loading && error && (
        <div className="flex items-start gap-2 rounded-token-md border border-danger-soft/20 bg-danger-soft/10 p-3 text-xs text-danger-soft">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            <p className="font-semibold">Couldn’t load from BSE.</p>
            <p className="mt-0.5 opacity-90">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && isEmpty && <EmptyState icon={Icon} title={emptyText} compact />}
      {!loading && !error && !isEmpty && children}
    </Card>
  );
}

/** Horizontally scrollable table wrapper — wide tables must not scroll the page. */
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
