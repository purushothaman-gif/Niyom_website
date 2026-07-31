/**
 * Portal UI kit.
 *
 * Deliberately softer and roomier than the admin console's kit: this surface is
 * read by investors on a phone, not by staff scanning a book of orders. Bigger
 * numerals, more air, fewer borders.
 *
 * Shares the money helpers in lib/money with the console so a figure is
 * formatted identically wherever it appears.
 */
import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, type LucideIcon } from 'lucide-react';

/** Content surface. `flush` drops padding for lists that draw their own. */
export function Tile({
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

export function TileHead({
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
        <h2 className="flex items-center gap-2 font-display text-[15px] font-bold tracking-tight text-text-primary">
          {Icon && <Icon className="h-4 w-4 shrink-0 text-accent" />}
          {title}
        </h2>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-text-faint">{hint}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

export function ScreenHead({
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
        <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * A figure with an optional gain/loss. `delta` is a signed number; the arrow
 * and colour follow its sign, so callers never pick the colour themselves and
 * a loss can't accidentally render green.
 */
export function Figure({
  label,
  value,
  delta,
  deltaLabel,
  size = 'md',
}: {
  label: string;
  value: string;
  delta?: number;
  deltaLabel?: string;
  size?: 'md' | 'lg';
}) {
  const up = (delta ?? 0) >= 0;
  return (
    <div>
      <p className="text-xs font-medium text-text-faint">{label}</p>
      <p
        className={`mt-1 font-display font-bold tabular-nums text-text-primary ${
          size === 'lg' ? 'text-3xl sm:text-4xl' : 'text-xl'
        }`}
      >
        {value}
      </p>
      {delta !== undefined && (
        <p
          className={`mt-1 inline-flex items-center gap-1 text-xs font-semibold tabular-nums ${
            up ? 'text-success' : 'text-danger'
          }`}
        >
          {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
          {deltaLabel}
        </p>
      )}
    </div>
  );
}

/** Small labelled figure for a row of secondary stats. */
export function MiniStat({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'positive' | 'negative';
}) {
  const cls =
    tone === 'positive' ? 'text-success' : tone === 'negative' ? 'text-danger' : 'text-text-primary';
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] text-text-faint">{label}</p>
      <p className={`mt-0.5 truncate font-semibold tabular-nums ${cls}`}>{value}</p>
    </div>
  );
}

export function Pill({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  const cls = {
    neutral: 'border-border bg-bg-surface text-text-secondary',
    success: 'border-success/25 bg-success/10 text-success',
    warning: 'border-warning/25 bg-warning/10 text-warning',
    danger: 'border-danger/25 bg-danger/10 text-danger-soft',
    accent: 'border-accent/25 bg-accent/10 text-accent',
  }[tone];
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-1 text-[11px] font-semibold ${cls}`}
    >
      {children}
    </span>
  );
}

export function PortalButton({
  children,
  onClick,
  variant = 'secondary',
  disabled,
  icon: Icon,
  full,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  icon?: LucideIcon;
  full?: boolean;
}) {
  const variants = {
    primary: 'bg-accent text-on-accent hover:bg-accent-strong',
    secondary: 'border border-border bg-bg-surface text-text-primary hover:border-border-strong',
    ghost: 'text-text-secondary hover:text-accent',
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-token-md px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${full ? 'w-full' : ''}`}
    >
      {Icon && <Icon className="h-4 w-4" />}
      {children}
    </button>
  );
}

/**
 * Empty state written for an investor rather than an operator: says what will
 * appear here and what to do, never "no data".
 */
export function Blank({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-6 py-12 text-center">
      <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-token-xl bg-bg-surface">
        <Icon className="h-5 w-5 text-text-faint" />
      </span>
      <p className="font-display text-base font-bold text-text-primary">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-text-secondary">{body}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
