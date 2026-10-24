/**
 * Product access — which products a client or partner sees in their portal.
 *
 * Resolution lives in the database (nw_product_enabled: per-person override ->
 * audience default -> enabled). Keys are the portal nav keys, so a hidden key
 * removes the nav item and blocks its route with no mapping in between.
 */
import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database.types';

export type ProductAudience = 'client' | 'partner';

export interface ProductDef {
  key: string;
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

const EMPTY: ReadonlySet<string> = new Set();

/**
 * The signed-in caller's hidden products. Fails open (nothing hidden) on error:
 * the order triggers still refuse a switched-off product server-side.
 */
export function useHiddenProducts(
  db: SupabaseClient<Database>,
  audience: ProductAudience,
  enabled = true,
): ReadonlySet<string> {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(EMPTY);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    db.rpc('nw_my_products', { p_audience: audience }).then(({ data, error }) => {
      if (!alive || error || !data) return;
      setHidden(new Set(data.filter((r) => !r.enabled).map((r) => r.product)));
    });
    return () => {
      alive = false;
    };
  }, [db, audience, enabled]);
  return hidden;
}
