/**
 * Small controls shared across the console: buttons, segmented switches, the
 * sub-navigation rail, and the state blocks (loading / error / no-data).
 */
import type { ReactNode } from 'react';
import { AlertTriangle, Info, type LucideIcon } from 'lucide-react';
import { LogoLoader } from '../../components/LogoLoader';

export const fieldCls =
  'w-full rounded-token-md border border-border bg-bg-base px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-accent placeholder:text-text-faint disabled:opacity-50';

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled,
  type = 'button',
  icon: Icon,
  full,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
  disabled?: boolean;
  type?: 'button' | 'submit';
  icon?: LucideIcon;
  full?: boolean;
}) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-token-md px-3 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  const variants = {
    primary: 'bg-accent text-on-accent hover:bg-accent-strong',
    secondary: 'border border-border bg-bg-surface text-text-primary hover:border-border-strong',
    ghost: 'text-text-secondary hover:text-accent',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${variants[variant]} ${full ? 'w-full' : ''}`}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
}

/** Pill switch for mutually exclusive views (Portfolio / SIP / AUM, etc.). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="inline-flex rounded-token-md border border-border bg-bg-base p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-[calc(var(--radius-md)-2px)] px-3 py-1.5 text-[11px] font-semibold transition-colors ${
            value === o.value
              ? 'bg-accent text-on-accent'
              : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Left rail inside a section — the Reports/Calculators/Resources pattern. */
export function SubNav<T extends string>({
  value,
  onChange,
  items,
  heading,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { value: T; label: string; icon?: LucideIcon }[];
  heading?: string;
}) {
  return (
    <nav className="rounded-token-lg border border-border-subtle bg-card p-2">
      {heading && (
        <p className="px-2 pb-2 pt-1 text-[10px] font-bold uppercase tracking-wider text-text-faint">
          {heading}
        </p>
      )}
      <ul className="space-y-0.5">
        {items.map((it) => {
          const active = it.value === value;
          const Icon = it.icon;
          return (
            <li key={it.value}>
              <button
                type="button"
                onClick={() => onChange(it.value)}
                className={`flex w-full items-center gap-2.5 rounded-token-md px-2.5 py-2 text-left text-xs font-medium transition-colors ${
                  active
                    ? 'bg-accent/10 text-accent'
                    : 'text-text-secondary hover:bg-bg-surface hover:text-text-primary'
                }`}
              >
                {Icon && <Icon className="h-3.5 w-3.5 shrink-0" />}
                <span className="min-w-0 truncate">{it.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center gap-3">
      <LogoLoader size={44} />
      {label && <p className="text-xs text-text-faint">{label}</p>}
    </div>
  );
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-token-lg border border-danger-soft/20 bg-danger-soft/5 p-5">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger-soft" />
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary">Couldn’t load this from BSE</p>
          <p className="mt-1 break-words text-xs text-text-secondary">{message}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-token-md border border-border bg-bg-surface px-3 py-1.5 text-[11px] font-semibold text-text-primary hover:text-accent"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Used where BSE genuinely exposes nothing to our member tier. Names the API
 * that is blocked so staff can ask BSE for it, rather than implying the screen
 * is broken or — worse — filling it with numbers from somewhere else.
 */
export function NoData({
  title,
  reason,
  apis,
}: {
  title: string;
  reason: string;
  apis?: string[];
}) {
  return (
    <div className="rounded-token-lg border border-border-subtle bg-card px-6 py-12 text-center">
      <Info className="mx-auto mb-3 h-7 w-7 text-text-faint" />
      <h3 className="font-display text-base font-bold text-text-primary">{title}</h3>
      <p className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-text-secondary">{reason}</p>
      {apis && apis.length > 0 && (
        <div className="mx-auto mt-4 max-w-md rounded-token-md border border-border bg-bg-base p-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-text-faint">
            Blocked BSE endpoints
          </p>
          <p className="mt-1.5 font-mono text-[11px] text-text-secondary">{apis.join(' · ')}</p>
        </div>
      )}
    </div>
  );
}
