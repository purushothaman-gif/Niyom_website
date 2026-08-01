/**
 * MfCatalogService
 * -----------------------------------------------------------------------------
 * The discovery-side fund catalog: real trailing returns, real NAVs, real
 * categories — everything the BSE scheme master does not carry.
 *
 * Source of truth is the `mutual_funds` table, which `update-mutual-funds`
 * rebuilds from AMFI NAV history (mfapi.in), plus the `mf-detail` edge function
 * for a single fund's NAV series. Both are published market data, readable by
 * any signed-in user; nothing here is client-scoped.
 *
 * Reads go through `clientSupabase` — the portal's own auth instance — so a
 * client session is the one that runs, never a CRM session that happens to
 * share the browser (see the auth-isolation note in lib/supabase.ts).
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import type {
  CatalogFund,
  CatalogFundDetail,
  CatalogNavPoint,
  FundCategory,
  FundRecommendation,
} from '../types/funds';

interface MutualFundRow {
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

/** Numerics arrive as strings over PostgREST; 0 is a real value, null is not. */
const n = (v: number | string | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : null;
};

const CATEGORIES: FundCategory[] = ['Equity', 'Debt', 'Hybrid'];

function toCatalogFund(row: MutualFundRow): CatalogFund {
  const category = CATEGORIES.find((c) => c === row.category) ?? 'Other';
  return {
    amfiCode: row.fund_code ?? '',
    name: row.fund_name,
    amc: row.fund_house ?? '—',
    category,
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

function fnUrl(name: string): string {
  return `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`;
}

export const MfCatalogService = {
  /** The whole curated catalog. Small (tens of rows) — filtered in memory. */
  async list(): Promise<CatalogFund[]> {
    const { data, error } = await supabase
      .from('mutual_funds')
      .select(
        'fund_name, fund_code, category, sub_category, fund_house, risk_level, current_nav, ' +
          'nav_date, return_ytd, return_6m, return_1y, return_3y, return_5y, return_si, ' +
          'min_investment, launch_date, updated_at',
      )
      .order('return_3y', { ascending: false, nullsFirst: false });
    if (error) throw error;
    // A row with no AMFI code cannot be charted or ordered — drop it rather
    // than render a card that dead-ends.
    return (data ?? [])
      .map((r) => toCatalogFund(r as unknown as MutualFundRow))
      .filter((f) => f.amfiCode);
  },

  /**
   * Staff picks for the "Recommended by Niyom" shelf, in display order. An
   * empty list is the normal state until someone curates one — the section
   * hides itself rather than inventing a recommendation.
   */
  async recommendations(): Promise<FundRecommendation[]> {
    const { data, error } = await supabase
      .from('nw_mf_recommendations')
      .select('amfi_code, fund_name, headline, rationale')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data ?? []).map((r) => ({
      amfiCode: r.amfi_code as string,
      fundName: r.fund_name as string,
      headline: (r.headline as string | null) ?? null,
      rationale: (r.rationale as string | null) ?? null,
    }));
  },

  /**
   * NAV history + 52-week band for one fund. `mf-detail` serves this from its
   * own cache (verify_jwt=false, so the anon key is the credential).
   */
  async detail(amfiCode: string): Promise<CatalogFundDetail> {
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
    const res = await fetch(fnUrl('mf-detail'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(anon ? { apikey: anon, Authorization: `Bearer ${anon}` } : {}),
      },
      body: JSON.stringify({ code: amfiCode }),
    });
    if (!res.ok) throw new Error(`Fund detail unavailable (${res.status})`);
    const json = (await res.json()) as {
      success?: boolean;
      error?: string;
      metrics?: { high_52w?: number; low_52w?: number };
      meta?: { launch_date?: string | null };
      navHistory?: CatalogNavPoint[];
    };
    if (!json.success) throw new Error(json.error ?? 'Fund detail unavailable');
    return {
      navHistory: json.navHistory ?? [],
      high52w: json.metrics?.high_52w ?? null,
      low52w: json.metrics?.low_52w ?? null,
      launchDate: json.meta?.launch_date ?? null,
    };
  },
};
