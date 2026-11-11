/** Display helpers shared by the three partner unlisted-share screens. */

/** A per-share rupee price, always to paise: ₹1,234.50. */
export function rupee2(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  return `₹${Number(v).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function pctLabel(v: number | null | undefined): string {
  return v == null ? '—' : `${Number(v).toFixed(2)}%`;
}

export function sharesLabel(n: number): string {
  return `${n} share${n === 1 ? '' : 's'}`;
}
