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
// The query and row mapping mirror MfCatalogService.list() exactly, so both
// surfaces present identical numbers for the same fund. If the shape of
// mutual_funds changes, both need updating — the duplication is the price of
// keeping the two auth contexts apart.

import { supabase } from '../../../lib/supabase';
import type { CatalogFund, CatalogNavPoint, FundCategory } from '../../../portal/types/funds';

const COLUMNS =
  'fund_name, fund_code, category, sub_category, fund_house, risk_level, current_nav, ' +
  'nav_date, return_ytd, return_6m, return_1y, return_3y, return_5y, return_si, ' +
  'min_investment, launch_date, updated_at';

const CATEGORIES: FundCategory[] = ['Equity', 'Debt', 'Hybrid'];

interface Row {
  fund_name: string;
  fund_code: string | null;
  category: string | null;
  sub_category: string | null;
  fund_house: string | null;
  risk_level: string | null;
  current_nav: number | string | null;
  nav_date: string | null;
  return_ytd: number | string | null;
  return_6m: number | string | null;
  return_1y: number | string | null;
  return_3y: number | string | null;
  return_5y: number | string | null;
  return_si: number | string | null;
  min_investment: number | string | null;
  launch_date: string | null;
  updated_at: string | null;
}

/** Postgres numerics arrive as strings over PostgREST. */
const n = (v: number | string | null): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const num = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(num) ? num : null;
};

function toCatalogFund(row: Row): CatalogFund {
  return {
    amfiCode: row.fund_code ?? '',
    name: row.fund_name,
    amc: row.fund_house ?? '—',
    category: CATEGORIES.find(c => c === row.category) ?? 'Other',
    subCategory: row.sub_category ?? '',
    risk: row.risk_level,
    nav: n(row.current_nav),
    navDate: row.nav_date,
    returns: {
      YTD: n(row.return_ytd),
      '6M': n(row.return_6m),
      '1Y': n(row.return_1y),
      '3Y': n(row.return_3y),
      '5Y': n(row.return_5y),
      SI: n(row.return_si),
    },
    minInvestment: n(row.min_investment),
    launchDate: row.launch_date,
    updatedAt: row.updated_at,
  };
}

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

/** The whole curated catalog — tens of rows, filtered in memory by the UI. */
export async function listCatalogFunds(): Promise<CatalogFund[]> {
  const { data, error } = await supabase
    .from('mutual_funds')
    .select(COLUMNS)
    .order('return_3y', { ascending: false, nullsFirst: false });
  if (error) throw error;
  // A row with no AMFI code cannot be identified — drop it rather than render
  // a card that dead-ends, matching the portal's behaviour.
  return (data ?? [])
    .map(r => toCatalogFund(r as unknown as Row))
    .filter(f => f.amfiCode);
}
