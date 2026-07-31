/**
 * Formatting helpers for the console.
 *
 * Indian money formatting throughout — lakh/crore grouping is what staff read,
 * and a distributor console showing "12,380,000" instead of "₹1.24 Cr" is
 * harder to scan, not more precise.
 */

/** Full rupee amount, e.g. ₹1,07,969. */
export function inr(n: number, paise = false): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: paise ? 2 : 0,
    maximumFractionDigits: paise ? 2 : 0,
  });
}

/** Compact rupees for tiles: ₹1.24 Cr, ₹12.4 L, ₹9,500. */
export function inrCompact(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return inr(n);
}

/** Plain grouped number, no currency. */
export function num(n: number, dp = 0): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

/** Signed percentage, e.g. +12.40% — for returns. */
export function pct(n: number, dp = 2): string {
  if (!Number.isFinite(n)) return '—';
  return `${n > 0 ? '+' : ''}${n.toFixed(dp)}%`;
}

/** dd MMM yyyy from an ISO-ish string. Returns an em dash for anything unparseable. */
export function shortDate(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** dd MMM, HH:mm — for order timestamps where the time matters for cut-off. */
export function dateTime(v: string | null | undefined): string {
  if (!v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}, ${d.toLocaleTimeString(
    'en-IN',
    { hour: '2-digit', minute: '2-digit', hour12: false },
  )}`;
}

/**
 * Title-case a BSE status/enum for display: `payment_pending` -> `Payment pending`.
 * BSE returns snake_case in a dozen shapes; this keeps tables readable without
 * a lookup table per field.
 */
export function humanise(v: string | null | undefined): string {
  if (!v) return '—';
  const s = String(v).replace(/[_-]+/g, ' ').trim().toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Initials for an avatar chip, max 2 letters. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
}
