// Fund catalog read for the CRM.
//
// WHY THIS EXISTS RATHER THAN REUSING MfCatalogService
// The portal's service imports `clientSupabase` — the client-portal auth
// instance, which is the only client in the app configured with
// detectSessionInUrl: true and carries its own storage key. Importing it into
// the CRM bundle instantiates a second GoTrue client alongside the employee
// one; the two then contend over auth state and the CRM fails to mount.
// The portal's session isolation is deliberate (see src/lib/supabase.ts), so
// the fix is for each surface to read through its own client, not to relax it.
//
// This reads the AMFI scheme universe (mf_scheme_cache) rather than the curated
// `mutual_funds` the portal shows — ~2,500 live schemes across 52 fund houses,
// against a hand-picked 36. Returns for both are computed by the same
// mfReturns.computeAll, so a fund on both screens shows the same numbers.

import { supabase } from '../../../lib/supabase';
import { splitAmfiCategory } from '../../../lib/funds/amfiCategory';
import type { CatalogFund, CatalogNavPoint } from '../../../portal/types/funds';

/** Postgres numerics arrive as strings over PostgREST. */
const n = (v: number | string | null): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const num = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(num) ? num : null;
};

/**
 * NAV history for one scheme, via the mf-detail edge function.
 *
 * Deliberately a bare fetch with the anon key rather than supabase.functions
 * .invoke(): it matches what the portal does, and it keeps this module free of
 * any auth client — the mistake that blanked the CRM was pulling an auth
 * instance across the portal/CRM boundary.
 *
 * Points come back oldest-first with dates as "dd-mm-yyyy" (mfapi's format),
 * roughly monthly over the scheme's life.
 */
export async function fetchNavHistory(amfiCode: string): Promise<{
  navHistory: CatalogNavPoint[];
  high52w: number | null;
  low52w: number | null;
}> {
  const base = import.meta.env.VITE_SUPABASE_URL;
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
  const res = await fetch(`${base}/functions/v1/mf-detail`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(anon ? { apikey: anon, Authorization: `Bearer ${anon}` } : {}),
    },
    body: JSON.stringify({ code: amfiCode }),
  });
  if (!res.ok) throw new Error(`NAV history unavailable (${res.status})`);
  const json = (await res.json()) as {
    success?: boolean;
    error?: string;
    navHistory?: CatalogNavPoint[];
    metrics?: { high_52w?: number; low_52w?: number };
  };
  if (!json.success) throw new Error(json.error ?? 'NAV history unavailable');
  return {
    navHistory: json.navHistory ?? [],
    high52w: json.metrics?.high_52w ?? null,
    low52w: json.metrics?.low_52w ?? null,
  };
}

const UNIVERSE_COLUMNS =
  'scheme_code, scheme_name, fund_house, amfi_category, current_nav, nav_date, ' +
  'return_6m, return_1y, return_3y, return_5y, return_si, launch_date, returns_synced_at';

/** PostgREST caps a page at 1000 rows. */
const PAGE = 1000;

interface UniverseRow {
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

function universeToCatalogFund(row: UniverseRow): CatalogFund {
  const { bucket, subCategory } = splitAmfiCategory(row.amfi_category);
  return {
    amfiCode: row.scheme_code,
    name: row.scheme_name,
    amc: row.fund_house || '—',
    category: bucket,
    subCategory,
    /*
     * The universe carries no riskometer or minimum. AMFI's file does not
     * publish either, and both are scheme-document facts that change per plan —
     * so they stay null and the UI renders an em dash. Defaulting the minimum to
     * ₹500, as the curated feed does for its hand-checked rows, would be a
     * number a client could act on and we never verified.
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
 * Every AMFI scheme we can show honestly — ~2,500 across 52 fund houses.
 *
 * Two filters, both about not showing a number we cannot stand behind:
 *
 *   current_nav      a scheme AMFI did not price is not investable.
 *   returns_synced_at the rolling backfill has not reached it yet, so its
 *                    returns are unknown rather than absent. Including it would
 *                    put a full row of em dashes on screen and, worse, let it
 *                    sit in a "Top performers" list ranked as if it had no
 *                    return. A scheme appears once its figures exist.
 *
 * Paged rather than limited: PostgREST stops at 1000 and a silent truncation
 * here would quietly amputate the tail of every fund house past the cut.
 * The rows are then filtered in memory by the screen, which is what keeps
 * search, collections and the house browse working off one fetch.
 */
export async function listUniverseFunds(): Promise<CatalogFund[]> {
  const out: CatalogFund[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('mf_scheme_cache')
      .select(UNIVERSE_COLUMNS)
      .not('current_nav', 'is', null)
      .not('returns_synced_at', 'is', null)
      .order('return_3y', { ascending: false, nullsFirst: false })
      .order('scheme_code', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as unknown as UniverseRow[];
    out.push(...rows.map(universeToCatalogFund));
    if (rows.length < PAGE) break;
  }
  return out;
}
