/**
 * Surfaces and page furniture for the console.
 *
 * The console is a dense, data-first tool — closer to a trading terminal than
 * a marketing page — so these lean on tight spacing, hairline borders and a
 * single elevation step rather than heavy shadows.
 */
import type { ReactNode } from 'react';
import { type LucideIcon } from 'lucide-react';

/** A plain content panel. `flush` removes padding for tables that draw their own. */
export function Panel({
  children,
  className = '',
  flush = false,
}: {
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section
      className={`rounded-token-lg border border-border-subtle bg-card ${flush ? '' : 'p-4 sm:p-5'} ${className}`}
    >
      {children}
    </section>
  );
}

/** Panel heading with an optional right-hand slot for filters or actions. */
export function PanelHead({
  title,
  hint,
  icon: Icon,
  action,
}: {
  title: string;
  hint?: string;
  icon?: LucideIcon;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 font-display text-sm font-bold tracking-tight text-text-primary">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-accent" />}
          {title}
        </h2>
        {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-text-faint">{hint}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/**
 * Page title block. Sits above the content of every screen so the console has
 * one consistent entry point per view.
 */
export function PageHead({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="font-display text-xl font-bold tracking-tight text-text-primary sm:text-2xl">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-xs text-text-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * A single headline figure.
 *
 * `value` is a string so callers format with the money helpers and this stays
 * dumb. When the underlying source genuinely has no data, pass `unavailable`
 * with the reason — the console never invents a number to fill a tile.
 */
export function StatTile({
  label,
  value,
  sub,
  tone = 'default',
  icon: Icon,
  unavailable,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'default' | 'positive' | 'negative' | 'warning';
  icon?: LucideIcon;
  unavailable?: string;
}) {
  const toneCls =
    tone === 'positive'
      ? 'text-success'
      : tone === 'negative'
        ? 'text-danger'
        : tone === 'warning'
          ? 'text-warning'
          : 'text-text-primary';

  return (
    <div className="rounded-token-lg border border-border-subtle bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-faint">
          {label}
        </span>
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-text-faint" />}
      </div>
      {unavailable ? (
        <>
          <p className="mt-2 font-display text-lg font-bold text-text-faint">—</p>
          <p className="mt-0.5 text-[11px] leading-snug text-text-faint">{unavailable}</p>
        </>
      ) : (
        <>
          <p className={`mt-2 font-display text-xl font-bold tabular-nums sm:text-2xl ${toneCls}`}>
            {value}
          </p>
          {sub && <p className="mt-0.5 text-[11px] text-text-secondary">{sub}</p>}
        </>
      )}
    </div>
  );
}

/** Small status chip. Tone maps to BSE lifecycle states across the console. */
export function Chip({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
}) {
  const cls = {
    neutral: 'border-border bg-bg-surface text-text-secondary',
    success: 'border-success/25 bg-success/10 text-success',
    warning: 'border-warning/25 bg-warning/10 text-warning',
    danger: 'border-danger/25 bg-danger/10 text-danger-soft',
    info: 'border-accent/25 bg-accent/10 text-accent',
  }[tone];
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cls}`}
    >
      {children}
    </span>
  );
}

/**
 * Map a BSE status string onto a chip tone. Kept in one place because the same
 * vocabulary shows up in the order book, SXP book, UCC book and dashboard.
 */
export function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  const s = (status || '').toLowerCase();
  if (/(active|allot|success|done|complete|approved|paid)/.test(s)) return 'success';
  if (/(reject|fail|cancel|error|expired)/.test(s)) return 'danger';
  if (/(pending|await|received|process|match)/.test(s)) return 'warning';
  return 'neutral';
}
