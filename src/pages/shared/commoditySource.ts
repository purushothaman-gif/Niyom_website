import { supabase } from '../../lib/supabase';

/**
 * Commodity-price data-source abstraction for the Learning page's gold/silver
 * widget. The page depends only on `commoditySource`, so a live MCX/spot-price
 * API can replace the Supabase-backed source without UI changes.
 */

export type Commodity = 'gold' | 'silver';

export interface CommodityPrice {
  commodity: Commodity;
  price: number;
  price_date: string;
}

export interface CommoditySnapshot {
  /** Most recent price for the commodity, or null if none. */
  latest: CommodityPrice | null;
  /** Absolute change vs. the previous available reading. */
  change: number;
  /** Percentage change vs. the previous available reading. */
  changePct: number;
  /** Recent readings, oldest → newest (for a sparkline). */
  series: CommodityPrice[];
}

export interface CommoditySource {
  snapshot(commodity: Commodity, withinDays?: number): Promise<CommoditySnapshot>;
}

class SupabaseCommoditySource implements CommoditySource {
  async snapshot(commodity: Commodity, withinDays = 30): Promise<CommoditySnapshot> {
    const since = new Date();
    since.setDate(since.getDate() - withinDays);

    const { data, error } = await supabase
      .from('commodity_prices')
      .select('commodity, price, price_date')
      .eq('commodity', commodity)
      .gte('price_date', since.toISOString().slice(0, 10))
      .order('price_date', { ascending: true });

    if (error) throw error;

    const series = ((data ?? []) as CommodityPrice[]).map((r) => ({ ...r, price: Number(r.price) }));
    const latest = series.length ? series[series.length - 1] : null;
    const prev = series.length > 1 ? series[series.length - 2] : null;
    const change = latest && prev ? latest.price - prev.price : 0;
    const changePct = latest && prev && prev.price ? (change / prev.price) * 100 : 0;

    return { latest, change, changePct, series };
  }
}

export const commoditySource: CommoditySource = new SupabaseCommoditySource();
