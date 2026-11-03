import { inr, num } from '../../../lib/money';

/** Signed rupees: +₹1,240 / −₹310. */
export function signedInr(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const s = inr(Math.abs(v));
  if (Math.abs(v) < 0.5) return s;
  return `${v > 0 ? '+' : '−'}${s}`;
}

/** Signed percent with 2dp; null → em dash. */
export function signedPct(v: number | null | undefined, dp = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}%`;
}

export function toneOf(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v) || Math.abs(v) < 1e-9) return 'text-text-secondary';
  return v > 0 ? 'text-success' : 'text-danger';
}

export function units(v: number | null | undefined): string {
  if (v == null) return '—';
  return num(v, Number.isInteger(v) ? 0 : 3);
}

export function price(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return inr(v, v < 1000);
}

export function shortDay(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** A coloured value with its signed % beneath — the Groww "returns" cell. */
export function ChangeCell({
  amount,
  percent,
  empty = '—',
  align = 'right',
}: {
  amount: number | null;
  percent: number | null;
  empty?: string;
  align?: 'left' | 'right';
}) {
  if (amount == null) {
    return <span className={`block text-sm text-text-faint ${align === 'right' ? 'text-right' : ''}`}>{empty}</span>;
  }
  return (
    <span className={`block ${align === 'right' ? 'text-right' : ''}`}>
      <span className="block text-sm font-semibold tabular-nums text-text-primary">{signedInr(amount)}</span>
      <span className={`block text-xs font-medium tabular-nums ${toneOf(percent ?? amount)}`}>
        {signedPct(percent)}
      </span>
    </span>
  );
}
