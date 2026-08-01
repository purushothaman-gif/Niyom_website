import { supabase } from '../../lib/supabase';

/**
 * Mutual-fund research data-source abstraction.
 *
 * The MF Research page depends only on the `MfSource` interface, never on
 * Supabase directly. To integrate a real MF data API (e.g. AMFI/registrar
 * feeds) later, implement `MfSource` against it and export it as `mfSource` —
 * the page requires no changes.
 */

export interface MutualFund {
  id: string;
  fund_name: string;
  fund_code: string | null;
  category: string | null;
  sub_category: string | null;
  fund_house: string | null;
  /*
   * Null where the fund's NAV history does not reach back over that period —
   * a young fund has no 5Y figure and never will have had one. Rendered as an
   * em dash, never as 0.00%, which would read as a flat year.
   */
  return_ytd: number | null;
  return_6m: number | null;
  return_1y: number | null;
  return_3y: number | null;
  return_5y: number | null;
  return_si: number | null;
  current_nav: number;
  nav_date: string | null;
  risk_level: string | null;
  min_investment: number;
  launch_date: string | null;
  updated_at: string | null;
}

/** A hit from the AMFI universe search (fund need not be in the curated table). */
export interface MfSchemeHit {
  scheme_code: string;
  scheme_name: string;
  fund_house: string | null;
}

/** Full metric spread for one scheme, computed server-side from NAV history. */
export interface MfMetrics {
  current_nav: number;
  nav_date: string | null;
  /** Null for periods the NAV history cannot cover — see MutualFund above. */
  return_ytd: number | null;
  return_6m: number | null;
  return_1y: number | null;
  return_3y: number | null;
  return_5y: number | null;
  return_si: number | null;
  high_52w: number;
  low_52w: number;
}

export interface MfNavPoint {
  date: string; // "dd-mm-yyyy" as returned by mfapi.in
  nav: number;
}

/** On-demand detail for a single fund (drives the detail view + NAV chart). */
export interface MfDetail {
  meta: {
    scheme_name: string;
    scheme_category: string | null;
    scheme_type: string | null;
    fund_house: string | null;
    launch_date: string | null;
  };
  metrics: MfMetrics;
  navHistory: MfNavPoint[];
}

export type MfSortKey = 'return_ytd' | 'return_1y' | 'return_3y' | 'return_5y' | 'return_si';

export interface MfSource {
  /** Top-level categories for filtering (first entry should be 'all'). */
  categories: string[];
  /** Fetch all curated funds. The page applies search/filter/sort in memory. */
  list(): Promise<MutualFund[]>;
  /** Trigger a server-side refresh of the curated fund dataset. */
  refresh(): Promise<{ updated: number }>;
  /** Search the full AMFI scheme universe by name. */
  search(query: string): Promise<MfSchemeHit[]>;
  /** Fetch on-demand detail (metrics + NAV history) for one scheme code. */
  detail(schemeCode: string): Promise<MfDetail>;
}

export const MF_CATEGORIES = ['all', 'Equity', 'Debt', 'Hybrid'];

/** Default implementation backed by Supabase tables + edge functions. */
class SupabaseMfSource implements MfSource {
  categories = MF_CATEGORIES;

  private fnUrl(name: string): string {
    const base = import.meta.env.VITE_SUPABASE_URL;
    return `${base}/functions/v1/${name}`;
  }

  /** Anon-key headers so the edge functions accept public (unauthenticated) calls. */
  private headers(): Record<string, string> {
    const anon = import.meta.env.VITE_SUPABASE_ANON_KEY;
    return {
      'Content-Type': 'application/json',
      ...(anon ? { apikey: anon, Authorization: `Bearer ${anon}` } : {}),
    };
  }

  async list(): Promise<MutualFund[]> {
    const { data, error } = await supabase
      .from('mutual_funds')
      .select('*')
      .order('return_1y', { ascending: false });
    if (error) throw error;
    return (data ?? []) as MutualFund[];
  }

  async refresh(): Promise<{ updated: number }> {
    const res = await fetch(this.fnUrl('update-mutual-funds'), {
      method: 'POST',
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
    const json = await res.json();
    return { updated: json.updated ?? 0 };
  }

  async search(query: string): Promise<MfSchemeHit[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    const res = await fetch(this.fnUrl('mf-universe'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ action: 'search', q }),
    });
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    const json = await res.json();
    return (json.results ?? []) as MfSchemeHit[];
  }

  async detail(schemeCode: string): Promise<MfDetail> {
    const res = await fetch(this.fnUrl('mf-detail'), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ code: schemeCode }),
    });
    if (!res.ok) throw new Error(`Detail failed (${res.status})`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error ?? 'Detail unavailable');
    return json as MfDetail;
  }
}

export const mfSource: MfSource = new SupabaseMfSource();
