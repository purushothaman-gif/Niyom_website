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

/**
 * Rupees in words, Indian numbering: "Rupees Twenty-Five Thousand ... Only".
 *
 * Lives here rather than in dsaDebitNote because three documents need it -- the
 * debit note, the payment receipt and the payslip -- and that module imports
 * html2pdf at module scope, which wants a browser. A pure formatter should not
 * drag a PDF renderer into everything that spells out an amount.
 */
export function amountInWords(amount: number): string {
  const num = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - num) * 100);

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
    'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const twoDigit = (n: number): string => {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  };

  const threeDigit = (n: number): string => {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    let s = '';
    if (h) s += ones[h] + ' Hundred';
    if (rest) s += (h ? ' ' : '') + twoDigit(rest);
    return s;
  };

  if (num === 0) {
    return paise ? `${twoDigit(paise)} Paise Only` : 'Zero Only';
  }

  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const hundred = num % 1000;

  const parts: string[] = [];
  if (crore) parts.push(twoDigit(crore) + ' Crore');
  if (lakh) parts.push(twoDigit(lakh) + ' Lakh');
  if (thousand) parts.push(twoDigit(thousand) + ' Thousand');
  if (hundred) parts.push(threeDigit(hundred));

  let words = parts.join(' ').trim();
  if (amount < 0) words = 'Minus ' + words;
  words = 'Rupees ' + words;
  if (paise) words += ` and ${twoDigit(paise)} Paise`;
  return words + ' Only';
}
