/**
 * Allocation palette
 * -----------------------------------------------------------------------------
 * Vivid, theme-constant colors for allocation buckets that have no intrinsic
 * product color (category, AMC). Product breakdowns keep PRODUCT_CHART_COLORS;
 * these fill everything else. Kept literal (not CSS vars) so they also survive
 * in SVG/PDF contexts, matching the convention in crm/utils PRODUCT_CHART_COLORS.
 */
import type { AssetClass } from '../types';

export const ALLOCATION_PALETTE = [
  '#C8A45D', // niyom gold
  '#3B82F6', // blue
  '#10B981', // emerald
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#F59E0B', // amber
  '#8B5CF6', // violet
  '#F97316', // orange
  '#14B8A6', // teal
  '#EF4444', // red
];

/** Stable color for a bucket by its index within a dimension. */
export const paletteColor = (index: number): string =>
  ALLOCATION_PALETTE[index % ALLOCATION_PALETTE.length];

/** Fixed colors for the (small, closed) set of asset classes. */
export const ASSET_CLASS_COLOR: Record<AssetClass, string> = {
  Equity: '#3B82F6',
  Debt: '#10B981',
  Hybrid: '#8B5CF6',
  Insurance: '#F97316',
  Other: '#7688A4',
};
