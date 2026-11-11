/**
 * Number formatting for the investments board — the app's twin of the website's
 * `src/portal/features/investments/format.tsx`, minus its JSX cell.
 *
 * Null means UNKNOWN throughout and renders as an em dash. That matters for
 * registrar-fed mutual funds, whose purchase cost the registrar does not
 * report: their return is unknown, which is a different statement from 0%.
 */
const rupees = (v: number, paise = false): string =>
  `₹${v.toLocaleString('en-IN', {
    minimumFractionDigits: paise ? 2 : 0,
    maximumFractionDigits: paise ? 2 : 0,
  })}`;

/** Whole rupees: ₹1,24,000. */
export function inr(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return v < 0 ? `−${rupees(Math.abs(v))}` : rupees(v);
}

/** Signed rupees: +₹1,240 / −₹310. */
export function signedInr(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const s = rupees(Math.abs(v));
  if (Math.abs(v) < 0.5) return s;
  return `${v > 0 ? '+' : '−'}${s}`;
}

/** Signed percent; null → em dash. */
export function signedPct(v: number | null | undefined, dp = 2): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}%`;
}

export function units(v: number | null | undefined): string {
  if (v == null) return '—';
  return v.toLocaleString('en-IN', { maximumFractionDigits: Number.isInteger(v) ? 0 : 3 });
}

/** A unit price — paise shown below ₹1,000, where they matter. */
export function price(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return rupees(v, v < 1000);
}

export function shortDay(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** -1 / 0 / +1 for a figure; 0 also covers "unknown". */
export function signOf(v: number | null | undefined): -1 | 0 | 1 {
  if (v == null || !Number.isFinite(v) || Math.abs(v) < 1e-9) return 0;
  return v > 0 ? 1 : -1;
}
