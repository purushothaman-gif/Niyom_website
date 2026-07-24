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
  aum: number;
  expense_ratio: number;
  return_1y: number;
  return_3y: number;
  return_5y: number;
  launch_date: string | null;
  risk_level: string | null;
  min_investment: number;
  fund_manager: string | null;
  updated_at: string | null;
}

export type MfSortKey = 'return_1y' | 'return_3y' | 'return_5y' | 'aum';

export interface MfSource {
  /** Top-level categories for filtering (first entry should be 'all'). */
  categories: string[];
  /** Fetch all funds. The page applies search/filter/sort in memory. */
  list(): Promise<MutualFund[]>;
  /** Trigger a server-side refresh of the fund dataset. */
  refresh(): Promise<{ updated: number }>;
}

export const MF_CATEGORIES = ['all', 'Equity', 'Debt', 'Hybrid'];

/** Default implementation backed by the `mutual_funds` table + `update-mutual-funds`. */
class SupabaseMfSource implements MfSource {
  categories = MF_CATEGORIES;

  async list(): Promise<MutualFund[]> {
    const { data, error } = await supabase
      .from('mutual_funds')
      .select('*')
      .order('return_1y', { ascending: false });
    if (error) throw error;
    return (data ?? []) as MutualFund[];
  }

  async refresh(): Promise<{ updated: number }> {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const res = await fetch(`${url}/functions/v1/update-mutual-funds`, { method: 'POST' });
    if (!res.ok) throw new Error(`Refresh failed (${res.status})`);
    const json = await res.json();
    return { updated: json.updated ?? 0 };
  }
}

export const mfSource: MfSource = new SupabaseMfSource();
