/**
 * Dates as people in India type them. The app keeps a date field as
 * DD/MM/YYYY text while it is being edited and converts on save.
 */

export function isoToDmy(iso: string | null | undefined): string {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}

/** "DD/MM/YYYY" → "YYYY-MM-DD"; null when blank or not a real past date. */
export function dmyToIso(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) return null;
  if (date.getTime() > Date.now() || Number(y) < 1900) return null;
  return `${y}-${mo}-${d}`;
}

/** Typing digits fills the slashes in. */
export function maskDmy(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter(Boolean).join('/');
}
