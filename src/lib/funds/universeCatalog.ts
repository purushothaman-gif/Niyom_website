/**
 * The AMFI scheme universe, read as CatalogFund rows.
 *
 * Shared by the CRM research screen and the client portal. They cannot share a
 * Supabase *client* — the portal's `clientSupabase` is the only instance with
 * detectSessionInUrl, and pulling it into the CRM bundle spawns a second GoTrue
 * that fights the employee session (this once blanked the whole CRM). So each
 * caller passes its own client and everything else lives here, which is what
 * stops the two screens drifting into showing different numbers for one fund.
 *
 * The client type is imported as a TYPE ONLY. That is load-bearing: a value
 * import of either instance would defeat the separation above.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { splitAmfiCategory } from './amfiCategory';
import { isDirectPlan } from '../../../supabase/functions/_shared/mfPlan';
import type { CatalogFund } from '../../portal/types/funds';

export const UNIVERSE_COLUMNS =
  'scheme_code, scheme_name, fund_house, amfi_category, current_nav, nav_date, ' +
  'return_6m, return_1y, return_3y, return_5y, return_si, launch_date, returns_synced_at';

/** PostgREST caps a page at 1000 rows. */
const PAGE = 1000;

export interface UniverseRow {
  scheme_code: string;
  scheme_name: string;
  fund_house: string | null;
  amfi_category: string | null;
  current_nav: number | string | null;
  nav_date: string | null;
  return_6m: number | string | null;
  return_1y: number | string | null;
  return_3y: number | string | null;
  return_5y: number | string | null;
  return_si: number | string | null;
  launch_date: string | null;
  returns_synced_at: string | null;
}

/** Postgres numerics arrive as strings over PostgREST; 0 is real, null is not. */
const n = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const parsed = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(parsed) ? parsed : null;
};

export function universeToCatalogFund(row: UniverseRow): CatalogFund {
  const { bucket, subCategory } = splitAmfiCategory(row.amfi_category);
  return {
    amfiCode: row.scheme_code,
    name: row.scheme_name,
    amc: row.fund_house || '—',
    category: bucket,
    subCategory,
    /*
     * No riskometer and no minimum: AMFI publishes neither. Both are scheme
     * document facts that vary by plan, so they stay null and render as an em
     * dash. Defaulting the minimum to ₹500, as the curated feed does for its
     * hand-checked rows, would put a number a client could act on in front of
     * them that nobody verified.
     */
    risk: null,
    nav: n(row.current_nav),
    navDate: row.nav_date,
    returns: {
      YTD: null,
      '6M': n(row.return_6m),
      '1Y': n(row.return_1y),
      '3Y': n(row.return_3y),
      '5Y': n(row.return_5y),
      SI: n(row.return_si),
    },
    minInvestment: null,
    launchDate: row.launch_date,
    updatedAt: row.returns_synced_at,
  };
}

/**
 * Every AMFI scheme we can show honestly, best 3-year return first.
 *
 * Two filters, both about not putting an unsupportable number on screen:
 *
 *   current_nav       a scheme AMFI did not price is not investable.
 *   returns_synced_at the rolling backfill has not reached it, so its returns
 *                     are unknown rather than absent. Including it would show a
 *                     row of em dashes and, worse, let it sit in a ranked shelf
 *                     as though it had no return.
 *   returns_error     the backfill reached it and found no usable history, so
 *                     it is stamped synced but every figure is null. Filtering
 *                     only on returns_synced_at let these through — 12 schemes
 *                     rendering as a full row of em dashes, which is the case
 *                     the line above claims to prevent.
 *
 * Paged rather than limited: PostgREST stops at 1000 and a silent truncation
 * would amputate the tail of every fund house past the cut. scheme_code is the
 * tie-breaker so paging stays stable across the many rows sharing a return.
 */
// deno-lint-ignore no-explicit-any
export async function listUniverseFunds(client: SupabaseClient<any>): Promise<CatalogFund[]> {
  const out: CatalogFund[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from('mf_scheme_cache')
      .select(UNIVERSE_COLUMNS)
      .not('current_nav', 'is', null)
      .not('returns_synced_at', 'is', null)
      .is('returns_error', null)
      .order('return_3y', { ascending: false, nullsFirst: false })
      .order('scheme_code', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as UniverseRow[];
    /*
     * Direct plans never reach a screen. mf-universe already builds the cache
     * from Regular plans only, so this should filter nothing — it is here
     * because that upstream rule is one edited line away from silently
     * reintroducing schemes NIYOM cannot legally sell, and a distributor
     * quoting Direct returns is not a bug anyone would notice by looking.
     * Filtered after paging so a page never comes back short and ends the loop
     * early.
     */
    out.push(...rows.filter((r) => !isDirectPlan(r.scheme_name)).map(universeToCatalogFund));
    if (rows.length < PAGE) break;
  }
  return out;
}
