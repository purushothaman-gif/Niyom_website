// Shared CRM presentational primitives, styled with the CSS-variable theme so
// they track light/dark automatically. Mirrors the look of ClientOnboarding's
// Field/Input.
//
// Grew up inside the Leads module and was promoted here when HR & Payroll
// needed the same Field/Input/Modal/Drawer set -- cloning them would have meant
// two look-alikes drifting apart. `../leads/leadUi` still re-exports this file,
// so nothing in Leads had to change.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { statusRgb, priorityRgb } from '../leads/leadConstants';
import { scoreBandRgb } from '../leads/leadUtils';
import { LeadScoreBand } from '../leads/leadTypes';

export function Field({ label, required, children, hint }:
  { label: string; required?: boolean; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>
        {label}{required && <span className="ml-0.5" style={{ color: 'var(--accent)' }}>*</span>}
      </label>
      {children}
      {hint && <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{hint}</p>}
    </div>
  );
}

const fieldBase = 'w-full px-3.5 py-2.5 rounded-xl text-sm outline-none transition-all';

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const { onFocus, onBlur, style, ...rest } = props;
  const [focused, setFocused] = useState(false);
  return (
    <input
      {...rest}
      className={fieldBase}
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`, ...style }}
      onFocus={e => { setFocused(true); onFocus?.(e); }}
      onBlur={e => { setFocused(false); onBlur?.(e); }}
    />
  );
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { onFocus, onBlur, style, ...rest } = props;
  const [focused, setFocused] = useState(false);
  return (
    <textarea
      rows={3}
      {...rest}
      className={`${fieldBase} resize-none`}
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}`, ...style }}
      onFocus={e => { setFocused(true); onFocus?.(e); }}
      onBlur={e => { setFocused(false); onBlur?.(e); }}
    />
  );
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  const { style, ...rest } = props;
  return (
    <select
      {...rest}
      className={`${fieldBase} appearance-none cursor-pointer`}
      style={{ background: 'var(--bg-base)', color: 'var(--text-primary)', border: '1px solid var(--border)', ...style }}
    />
  );
}

export function StatusBadge({ status, small }: { status: string; small?: boolean }) {
  const rgb = statusRgb(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg font-semibold whitespace-nowrap ${small ? 'text-[11px] px-2 py-0.5' : 'text-xs px-2.5 py-1'}`}
      style={{ background: `rgba(${rgb},0.12)`, color: `rgb(${rgb})`, border: `1px solid rgba(${rgb},0.3)` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: `rgb(${rgb})` }} />
      {status}
    </span>
  );
}

export function PriorityBadge({ priority }: { priority: string }) {
  const rgb = priorityRgb(priority);
  return (
    <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-lg font-semibold capitalize"
      style={{ background: `rgba(${rgb},0.12)`, color: `rgb(${rgb})`, border: `1px solid rgba(${rgb},0.3)` }}>
      {priority}
    </span>
  );
}

export function ScoreBadge({ score, band }: { score: number; band: LeadScoreBand }) {
  const rgb = scoreBandRgb(band);
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] px-2 py-0.5 rounded-lg font-bold"
      style={{ background: `rgba(${rgb},0.12)`, color: `rgb(${rgb})`, border: `1px solid rgba(${rgb},0.3)` }}
      title={`Lead score ${score}/100`}>
      {band} · {score}
    </span>
  );
}

// Right-side drawer used for create/edit and detail. Locks body scroll.
export function Drawer({ open, onClose, title, subtitle, children, footer, width = 'max-w-2xl' }:
  { open: boolean; onClose: () => void; title: string; subtitle?: string;
    children: React.ReactNode; footer?: React.ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', onEsc); };
  }, [open, onClose]);
  if (!open) return null;
  // Portal to body so the overlay always anchors to the viewport, never trapped
  // inside a transformed/scrolling ancestor.
  return createPortal(
    <div className="fixed inset-0 z-[60] flex justify-end">
      <div className="absolute inset-0" style={{ background: 'var(--bg-overlay)' }} onClick={onClose} />
      <div className={`relative w-full ${width} h-full flex flex-col shadow-2xl`}
        style={{ background: 'var(--bg-surface)', borderLeft: '1px solid var(--border)' }}>
        <div className="flex items-start justify-between px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="min-w-0">
            <h2 className="text-base font-bold truncate" style={{ color: 'var(--text-primary)' }}>{title}</h2>
            {subtitle && <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-faint)' }}>{subtitle}</p>}
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg flex-shrink-0" style={{ color: 'var(--text-faint)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="px-6 py-4 flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// Centered modal for confirmations / smaller dialogs.
export function Modal({ open, onClose, title, children, width = 'max-w-md' }:
  { open: boolean; onClose: () => void; title: string; children: React.ReactNode; width?: string }) {
  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0" style={{ background: 'var(--bg-overlay)' }} onClick={onClose} />
      <div className={`relative w-full ${width} rounded-2xl shadow-2xl overflow-hidden`}
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h3>
          <button onClick={onClose} className="p-1 rounded-lg" style={{ color: 'var(--text-faint)' }}><X className="w-4 h-4" /></button>
        </div>
        <div className="px-5 py-4">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function PrimaryButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props}
      className={`px-5 py-2.5 rounded-xl text-sm font-bold text-on-accent disabled:opacity-50 transition-all ${props.className ?? ''}`}
      style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))', ...props.style }}>
      {children}
    </button>
  );
}

export function GhostButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...props}
      className={`px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-30 transition-all ${props.className ?? ''}`}
      style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)', ...props.style }}>
      {children}
    </button>
  );
}
