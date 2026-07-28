// Small shared presentational pieces for the Content Creation module.

import { useEffect, useState } from 'react';
import { AlertTriangle, Clock } from 'lucide-react';
import { ContentStatus } from '../marketingTypes';
import { LintFinding } from '../marketingConstants';

// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<ContentStatus, { label: string; bg: string; fg: string }> = {
  draft:    { label: 'Draft',    bg: 'rgba(142,160,181,0.16)', fg: 'var(--text-muted)' },
  approved: { label: 'Approved', bg: 'rgba(34,197,94,0.16)',   fg: '#22c55e' },
  rejected: { label: 'Rejected', bg: 'rgba(239,68,68,0.16)',   fg: '#ef4444' },
  archived: { label: 'Archived', bg: 'rgba(148,163,184,0.16)', fg: '#94a3b8' },
};

export function StatusPill({ status }: { status: ContentStatus }) {
  const s = STATUS_STYLES[status] ?? STATUS_STYLES.draft;
  return (
    <span className="px-2 py-0.5 rounded-md text-xs font-semibold"
      style={{ background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}

// ---------------------------------------------------------------------------

/**
 * Live countdown to expiry. Approved content is only visible for 48h, so
 * employees need to see at a glance how long they have left — and the card must
 * stop claiming time remains the moment it runs out.
 */
export function ExpiryCountdown({ expiresAt, compact }: { expiresAt: string | null; compact?: boolean }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (!expiresAt) return null;

  const msLeft = new Date(expiresAt).getTime() - now;

  if (msLeft <= 0) {
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: '#ef4444' }}>
        <Clock className="w-3 h-3" /> Expired
      </span>
    );
  }

  const hours = Math.floor(msLeft / 3_600_000);
  const minutes = Math.floor((msLeft % 3_600_000) / 60_000);
  const urgent = hours < 6;
  const text = hours >= 1 ? `${hours}h ${minutes}m left` : `${minutes}m left`;

  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold"
      style={{ color: urgent ? '#f59e0b' : 'var(--text-muted)' }}>
      <Clock className="w-3 h-3" />
      {compact ? text : `Expires in ${hours >= 1 ? `${hours}h ${minutes}m` : `${minutes}m`}`}
    </span>
  );
}

// ---------------------------------------------------------------------------

/** Compliance warnings on a draft. Blocks approval while non-empty. */
export function LintBadges({ findings }: { findings: LintFinding[] }) {
  if (!findings.length) return null;

  return (
    <div className="rounded-xl p-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
      <p className="text-xs font-bold flex items-center gap-1.5 mb-2" style={{ color: '#ef4444' }}>
        <AlertTriangle className="w-3.5 h-3.5" />
        {findings.length} compliance {findings.length === 1 ? 'issue' : 'issues'} — fix before approving
      </p>
      <ul className="space-y-1">
        {findings.map((f, i) => (
          <li key={i} className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span className="font-semibold">{f.field}</span>
            {': '}
            <span style={{ color: '#ef4444' }}>&ldquo;{f.phrase}&rdquo;</span>
            <span style={{ color: 'var(--text-faint)' }}> — {f.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------

export function EmptyState({ icon: Icon, title, message, action }: {
  icon: React.ElementType;
  title: string;
  message: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl p-12 flex flex-col items-center justify-center text-center"
      style={{ background: 'var(--bg-surface)', border: '1px dashed var(--border)' }}>
      <Icon className="w-8 h-8 mb-3" style={{ color: 'var(--accent-soft)' }} />
      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</p>
      <p className="text-xs mt-1 max-w-sm" style={{ color: 'var(--text-muted)' }}>{message}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------

export function Field({ label, hint, children }: {
  label: string; hint?: string; children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
        {label}
      </span>
      {hint && <span className="text-xs ml-2" style={{ color: 'var(--text-faint)' }}>{hint}</span>}
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

export const inputStyle: React.CSSProperties = {
  background: 'var(--bg-base)',
  border: '1px solid var(--border)',
  color: 'var(--text-primary)',
};

export const inputClass =
  'w-full px-3 py-2 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[var(--accent-soft)] transition';

/** Primary gold button, matching CRM convention. */
export function PrimaryButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`px-4 py-2 rounded-xl text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${props.className ?? ''}`}
      style={{ background: 'var(--accent)', color: 'var(--text-on-accent)', ...props.style }}>
      {children}
    </button>
  );
}

export function GhostButton({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      {...props}
      className={`px-4 py-2 rounded-xl text-sm font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${props.className ?? ''}`}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-primary)', ...props.style }}>
      {children}
    </button>
  );
}

/** Copy-to-clipboard with a transient confirmation. */
export function useCopyFeedback(resetMs = 1800) {
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), resetMs);
    return () => clearTimeout(t);
  }, [copied, resetMs]);

  const copy = async (key: string, text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      return true;
    } catch {
      // Clipboard API needs a secure context and permission; fall back so the
      // employee can still get their caption out.
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopied(key);
        return true;
      } catch {
        return false;
      }
    }
  };

  return { copied, copy };
}
