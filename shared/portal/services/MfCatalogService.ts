/**
 * MfCatalogService
 * -----------------------------------------------------------------------------
 * The discovery-side fund catalog: real trailing returns, real NAVs, real
 * categories — everything the BSE scheme master does not carry.
 *
 * Source of truth is `mf_scheme_cache`, the full AMFI universe: every live
 * scheme across all 52 fund houses, priced nightly from AMFI's own file with
 * trailing returns computed by the same code as the CRM's research screen. It
 * replaced the curated `mutual_funds` table, which was 36 funds from a
 * hardcoded list — so a client searching for anything outside it found nothing.
 * `mf-detail` still serves a single fund's NAV series. All published market
 * data, readable by any signed-in user; nothing here is client-scoped.
 *
 * NOTE ON PLANS: these are DIRECT-plan schemes, one canonical row per fund, so
 * the NAV and returns shown are Direct-plan figures. NIYOM distributes Regular
 * plans, whose returns are lower by the distributor commission built into their
 * expense ratio. The screen says so rather than letting a client assume the
 * number quoted is the one they would earn through us.
 *
 * Reads go through `clientSupabase` — the portal's own auth instance — so a
 * client session is the one that runs, never a CRM session that happens to
 * share the browser (see the auth-isolation note in lib/supabase.ts).
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import { listUniverseFunds } from '../../lib/funds/universeCatalog';
import type {
  CatalogFund,
  CatalogFundDetail,
  CatalogNavPoint,
  FundRecommendation,
} from '../types/funds';
import { getEnv } from '../../platform/env';
import { isDemoClientSession } from '../demo/demoClient';
import { demoCatalogFunds, demoRecommendations, demoFundDetail } from '../demo/demoClientMarket';

function fnUrl(name: string): string {
  return `${getEnv().supabaseUrl}/functions/v1/${name}`;
}

export const MfCatalogService = {
  /**
   * The whole investable universe, best 3-year return first.
   *
   * ~1,700 rows rather than the old 36, fetched once and filtered in memory by
   * the Explore screen — which is what keeps search, collections, the fund
   * houses shelf and compare working off a single read.
   */
  list(): Promise<CatalogFund[]> {
    if (isDemoClientSession()) return Promise.resolve(demoCatalogFunds);
    return listUniverseFunds(supabase);
  },

  /**
   * Staff picks for the "Recommended by Niyom" shelf, in display order. An
   * empty list is the normal state until someone curates one — the section
   * hides itself rather than inventing a recommendation.
   */
  async recommendations(): Promise<FundRecommendation[]> {
    if (isDemoClientSession()) return demoRecommendations;
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
    if (isDemoClientSession()) return demoFundDetail(amfiCode);
    const anon = getEnv().supabaseAnonKey;
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
