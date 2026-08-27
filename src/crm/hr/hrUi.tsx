/**
 * Presentational pieces specific to HR & Payroll.
 *
 * Anything generic (Field, Input, Select, Modal, Drawer, buttons) comes from
 * ../ui/kit, which the Leads module already uses -- this file only adds the
 * shapes HR needs that nothing else did: stat tiles, the tab strip, status
 * pills for attendance and payroll states, skeletons and empty states.
 *
 * All colour goes through the CSS variables in src/theme/tokens.css, so every
 * screen tracks light/dark without a second palette.
 */

import React from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export { Field, Input, Textarea, Select, Modal, Drawer, PrimaryButton, GhostButton } from '../ui/kit';

/* ------------------------------------------------------------------ tiles */

export function StatTile({ label, value, sub, tone = 'neutral', icon: Icon, onClick }: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'accent';
  icon?: React.ElementType;
  onClick?: () => void;
}) {
  const rgb = toneRgb(tone);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={`text-left p-4 rounded-2xl transition-all w-full ${onClick ? 'hover:-translate-y-0.5' : 'cursor-default'}`}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{label}</p>
        {Icon && (
          <span className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: `rgba(${rgb},0.12)`, color: `rgb(${rgb})` }}>
            <Icon className="w-3.5 h-3.5" />
          </span>
        )}
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums" style={{ color: tone === 'neutral' ? 'var(--text-primary)' : `rgb(${rgb})` }}>
        {value}
      </p>
      {sub && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{sub}</p>}
    </button>
  );
}

function toneRgb(tone: string): string {
  switch (tone) {
    case 'good':   return '16,185,129';
    case 'warn':   return '245,158,11';
    case 'bad':    return '239,68,68';
    case 'accent': return 'var(--accent-soft-rgb)';
    default:       return '99,102,241';
  }
}

/* ------------------------------------------------------------------ cards */

export function SectionCard({ title, subtitle, actions, children, padded = true }: {
  title?: string; subtitle?: string; actions?: React.ReactNode;
  children: React.ReactNode; padded?: boolean;
}) {
  return (
    <section className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      {(title || actions) && (
        <header className="px-5 py-4 flex items-start justify-between gap-3 flex-wrap"
          style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div>
            {title && <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h3>}
            {subtitle && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------- tabs */

export function Tabs<K extends string>({ tabs, active, onChange }: {
  tabs: { key: K; label: string; count?: number }[];
  active: K;
  onChange: (k: K) => void;
}) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1 -mx-1 px-1" role="tablist">
      {tabs.map(t => {
        const on = t.key === active;
        return (
          <button key={t.key} role="tab" aria-selected={on} onClick={() => onChange(t.key)}
            className="px-3.5 py-2 rounded-xl text-sm font-semibold whitespace-nowrap transition-all flex items-center gap-2"
            style={{
              background: on ? 'rgba(var(--accent-soft-rgb),0.14)' : 'transparent',
              color: on ? 'var(--accent-soft)' : 'var(--text-muted)',
              border: `1px solid ${on ? 'rgba(var(--accent-soft-rgb),0.3)' : 'transparent'}`,
            }}>
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className="px-1.5 py-0.5 rounded-md text-[10px] font-bold"
                style={{ background: on ? 'rgba(var(--accent-soft-rgb),0.2)' : 'var(--bg-base)', color: 'inherit' }}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ----------------------------------------------------------------- status */

const ATTENDANCE_TONE: Record<string, [string, string]> = {
  present:      ['16,185,129', 'Present'],
  half_day:     ['245,158,11', 'Half Day'],
  absent:       ['239,68,68',  'Absent'],
  weekly_off:   ['148,163,184','Weekly Off'],
  holiday:      ['139,92,246', 'Holiday'],
  paid_leave:   ['59,130,246', 'Paid Leave'],
  unpaid_leave: ['239,68,68',  'Unpaid Leave'],
  on_duty:      ['16,185,129', 'On Duty'],
  not_joined:   ['148,163,184','Not Joined'],
  exited:       ['148,163,184','Exited'],
  // Undecided days. Blue rather than green: they are not attendance yet, and
  // grey would read as "nothing expected here" like a weekly off.
  working:      ['59,130,246', 'Working'],
  upcoming:     ['148,163,184','Upcoming'],
};

const PAYROLL_TONE: Record<string, [string, string]> = {
  draft:      ['148,163,184','Draft'],
  processing: ['59,130,246', 'Processing'],
  review:     ['245,158,11', 'In Review'],
  approved:   ['16,185,129', 'Approved'],
  locked:     ['139,92,246', 'Locked'],
  paid:       ['16,185,129', 'Paid'],
  cancelled:  ['239,68,68',  'Cancelled'],
};

const GENERIC_TONE: Record<string, [string, string]> = {
  pending:       ['245,158,11', 'Pending'],
  approved:      ['16,185,129', 'Approved'],
  auto_approved: ['16,185,129', 'Auto approved'],
  rejected:      ['239,68,68',  'Rejected'],
  cancelled:     ['148,163,184','Cancelled'],
  active:        ['16,185,129', 'Active'],
  inactive:      ['148,163,184','Inactive'],
  office:        ['16,185,129', 'Office network'],
  off_network:   ['245,158,11', 'Off network'],
  unknown:       ['148,163,184','Unknown network'],
};

export function Pill({ value, kind = 'generic', small }: {
  value: string; kind?: 'attendance' | 'payroll' | 'generic'; small?: boolean;
}) {
  const table = kind === 'attendance' ? ATTENDANCE_TONE : kind === 'payroll' ? PAYROLL_TONE : GENERIC_TONE;
  const [rgb, label] = table[value] ?? ['148,163,184', humanise(value)];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg font-semibold whitespace-nowrap ${small ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1'}`}
      style={{ background: `rgba(${rgb},0.12)`, color: `rgb(${rgb})`, border: `1px solid rgba(${rgb},0.28)` }}>
      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: `rgb(${rgb})` }} />
      {label}
    </span>
  );
}

function humanise(v: string): string {
  return v.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/* ------------------------------------------------------------- feedback  */

export function EmptyState({ icon: Icon, title, message, action }: {
  icon?: React.ElementType; title: string; message?: string; action?: React.ReactNode;
}) {
  return (
    <div className="py-14 text-center">
      {Icon && (
        <div className="w-12 h-12 rounded-2xl mx-auto mb-3 flex items-center justify-center"
          style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
          <Icon className="w-5 h-5" style={{ color: 'var(--text-faint)' }} />
        </div>
      )}
      <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{title}</p>
      {message && <p className="text-xs mt-1 max-w-sm mx-auto" style={{ color: 'var(--text-faint)' }}>{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Skeleton({ rows = 5, height = 44 }: { rows?: number; height?: number }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="rounded-xl hr-shimmer" style={{ height, background: 'var(--bg-base)' }} />
      ))}
    </div>
  );
}

export function Toast({ msg, ok, onClose }: { msg: string; ok: boolean; onClose?: () => void }) {
  const rgb = ok ? '16,185,129' : '239,68,68';
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <div className="fixed bottom-6 right-6 z-[60] px-4 py-3 rounded-xl shadow-2xl flex items-start gap-2.5 max-w-sm"
      role="status"
      style={{ background: 'var(--bg-elevated)', border: `1px solid rgba(${rgb},0.35)` }}>
      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: `rgb(${rgb})` }} />
      <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{msg}</p>
      {onClose && (
        <button onClick={onClose} className="flex-shrink-0" aria-label="Dismiss" style={{ color: 'var(--text-faint)' }}>
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = 'info', title, children }: {
  tone?: 'info' | 'warn' | 'bad' | 'good'; title?: string; children: React.ReactNode;
}) {
  const rgb = tone === 'warn' ? '245,158,11' : tone === 'bad' ? '239,68,68' : tone === 'good' ? '16,185,129' : '59,130,246';
  const Icon = tone === 'info' ? Info : tone === 'good' ? CheckCircle2 : AlertTriangle;
  return (
    <div className="rounded-xl px-4 py-3 flex items-start gap-2.5"
      style={{ background: `rgba(${rgb},0.08)`, border: `1px solid rgba(${rgb},0.25)` }}>
      <Icon className="w-4 h-4 flex-shrink-0 mt-0.5" style={{ color: `rgb(${rgb})` }} />
      <div className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {title && <p className="font-bold mb-0.5" style={{ color: `rgb(${rgb})` }}>{title}</p>}
        {children}
      </div>
    </div>
  );
}

/** Destructive / irreversible actions always go through this. */
export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', tone = 'bad', busy, onConfirm, onCancel, children }: {
  open: boolean; title: string; message?: string; confirmLabel?: string;
  tone?: 'bad' | 'accent'; busy?: boolean;
  onConfirm: () => void; onCancel: () => void; children?: React.ReactNode;
}) {
  if (!open) return null;
  const rgb = tone === 'bad' ? '239,68,68' : 'var(--accent-soft-rgb)';
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.75)' }}>
      <div className="w-full max-w-md rounded-2xl overflow-hidden"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <div className="px-6 py-5">
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
          {message && <p className="text-xs mt-2 leading-relaxed" style={{ color: 'var(--text-muted)' }}>{message}</p>}
          {children && <div className="mt-4">{children}</div>}
        </div>
        <div className="px-6 py-4 flex items-center justify-end gap-2" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onCancel} disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            Cancel
          </button>
          <button onClick={onConfirm} disabled={busy}
            className="px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-60"
            style={{ background: `rgba(${rgb},0.15)`, color: `rgb(${rgb})`, border: `1px solid rgba(${rgb},0.4)` }}>
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ table */

export function TableWrap({ children }: { children: React.ReactNode }) {
  // Wide HR tables (a monthly register is 31 columns) scroll inside their own
  // container so the page body never scrolls sideways on a phone.
  return (
    <div className="overflow-x-auto -mx-5 px-5">
      <table className="nw-table w-full text-sm" style={{ minWidth: 560 }}>{children}</table>
    </div>
  );
}

