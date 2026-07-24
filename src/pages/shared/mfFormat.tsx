/**
 * Shared formatting helpers + risk badge for the MF Research page, fund detail
 * modal and compare panel, so returns render identically everywhere.
 */

export const fmtPct = (n: number | null | undefined) =>
  n == null ? '—' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;

export const returnColor = (n: number | null | undefined) =>
  n == null || n === 0
    ? 'var(--text-muted)'
    : n > 0
      ? 'rgb(var(--success-soft-rgb))'
      : 'rgb(var(--danger-soft-rgb))';

export const fmtNav = (n: number | null | undefined) =>
  n == null ? '—' : `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const fmtDate = (iso: string | null | undefined) =>
  !iso ? '—' : new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export function RiskBadge({ level }: { level: string | null }) {
  if (!level) return null;
  const map: Record<string, string> = { Low: 'success-soft', Moderate: 'warning-soft', High: 'danger-soft' };
  const token = map[level] ?? 'info-soft';
  return (
    <span
      className="inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: `rgba(var(--${token}-rgb),0.14)`, color: `rgb(var(--${token}-rgb))` }}
    >
      {level}
    </span>
  );
}
