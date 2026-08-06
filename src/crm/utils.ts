import { ProductType } from './types';

export function fmt(amount: number): string {
  if (!amount && amount !== 0) return '₹0';
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)} Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(2)} L`;
  return `${sign}₹${abs.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

export function fmtFull(amount: number): string {
  return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

/*
 * Accepts null and undefined because the body already handles them — the guard
 * below has been returning '—' since it was written, while the signature
 * claimed a non-null string. Generated schema types surfaced the mismatch:
 * plenty of date columns are nullable.
 */
export function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function timeAgo(d: string | null | undefined): string {
  /*
   * Unlike fmtDate this had no guard, and its callers now pass nullable
   * timestamp columns. `new Date(null)` is the epoch and `new Date(undefined)`
   * is Invalid Date, so without this a null created_at rendered "56y ago" or
   * "NaN ago" rather than admitting it did not know.
   */
  if (!d) return '—';
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return fmtDate(d);
}

export const PRODUCT_LABELS: Record<ProductType, string> = {
  unlisted_share: 'Unlisted Share',
  secondary_bond: 'Secondary Bond',
  primary_bond: 'Primary Bond',
  mutual_fund: 'Mutual Fund',
  fixed_deposit: 'Fixed Deposit',
  insurance: 'Insurance',
};

export const PRODUCT_COLORS: Record<ProductType, string> = {
  unlisted_share: 'text-c-amber bg-c-amber/10 border-c-amber/20',
  secondary_bond: 'text-c-emerald bg-c-emerald/10 border-c-emerald/20',
  primary_bond: 'text-c-blue bg-c-blue/10 border-c-blue/20',
  mutual_fund: 'text-c-pink bg-c-pink/10 border-c-pink/20',
  fixed_deposit: 'text-c-cyan bg-c-cyan/10 border-c-cyan/20',
  insurance: 'text-c-orange bg-c-orange/10 border-c-orange/20',
};

// Category/chart colors are intentionally theme-CONSTANT (vivid, consistent in
// both themes) and are also embedded in print/PDF export HTML where CSS
// variables do not resolve — so these stay literal hex.
export const PRODUCT_CHART_COLORS: Record<ProductType, string> = {
  unlisted_share: '#F59E0B',
  secondary_bond: '#10B981',
  primary_bond: '#3B82F6',
  mutual_fund: '#EC4899',
  fixed_deposit: '#06B6D4',
  insurance: '#F97316',
};

// Products where qty × price = consolidated_amount
export const AUTO_CALC_PRODUCTS: ProductType[] = ['unlisted_share', 'secondary_bond', 'primary_bond', 'mutual_fund'];

export const TXN_LABELS: Record<string, string> = {
  buy: 'Buy',
  sell: 'Sell',
  transfer_in: 'Transfer In',
  transfer_out: 'Transfer Out',
};

export const TXN_COLORS: Record<string, string> = {
  buy: 'text-c-emerald bg-c-emerald/10',
  sell: 'text-c-red bg-c-red/10',
  transfer_in: 'text-c-blue bg-c-blue/10',
  transfer_out: 'text-c-orange bg-c-orange/10',
};

export const VERIFICATION_LABELS: Record<string, string> = {
  pending: 'Pending',
  partial: 'Partial',
  verified: 'Verified',
  rejected: 'Rejected',
};

export const VERIFICATION_COLORS: Record<string, string> = {
  pending: 'text-c-amber bg-c-amber/10 border-c-amber/20',
  partial: 'text-c-blue bg-c-blue/10 border-c-blue/20',
  verified: 'text-c-emerald bg-c-emerald/10 border-c-emerald/20',
  rejected: 'text-c-red bg-c-red/10 border-c-red/20',
};
