/**
 * Product access — which products a client or partner may see.
 *
 * The platform-neutral half of src/lib/productAccess.ts, so the mobile app can
 * resolve the same list. Resolution lives in the database (nw_my_products:
 * per-person override -> audience default -> enabled). Keys are the portal nav
 * keys.
 */
import type { NiyomDb } from '../platform/db';

export type ProductAudience = 'client' | 'partner';

export type ProductKey =
  | 'mutual-funds'
  | 'bonds'
  | 'unlisted-shares'
  | 'fixed-deposits'
  | 'insurance';

export interface ProductDef {
  key: ProductKey;
  label: string;
  audiences: ProductAudience[];
}

export const PRODUCTS: ProductDef[] = [
  { key: 'mutual-funds', label: 'Mutual Funds', audiences: ['client', 'partner'] },
  { key: 'bonds', label: 'Bonds', audiences: ['client', 'partner'] },
  { key: 'unlisted-shares', label: 'Unlisted Shares', audiences: ['client', 'partner'] },
  { key: 'fixed-deposits', label: 'Fixed Deposits', audiences: ['client'] },
  { key: 'insurance', label: 'Insurance', audiences: ['client'] },
];

export const productsFor = (audience: ProductAudience) =>
  PRODUCTS.filter((p) => p.audiences.includes(audience));

export const NO_HIDDEN_PRODUCTS: ReadonlySet<string> = new Set();

/**
 * The signed-in caller's switched-off products. Fails open (nothing hidden) on
 * any error: the order triggers still refuse a switched-off product server-side.
 */
export async function fetchHiddenProducts(
  db: NiyomDb,
  audience: ProductAudience,
): Promise<ReadonlySet<string>> {
  try {
    const { data, error } = await db.rpc('nw_my_products', { p_audience: audience });
    if (error || !data) return NO_HIDDEN_PRODUCTS;
    return new Set(data.filter((r) => !r.enabled).map((r) => r.product));
  } catch {
    return NO_HIDDEN_PRODUCTS;
  }
}
