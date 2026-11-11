/**
 * DematPortfolioService — the client's demat holdings, as their eCAS stated.
 *
 * The sibling of CasPortfolioService for the other overlay source. It reads the
 * demat_* tables (filled by the droplet's /cas/demat import) under the client's
 * own RLS and maps each holding into the PortalHolding shape the board already
 * speaks — so equities, bonds, G-secs, AIFs and NPS appear alongside mutual
 * funds with no change to the board itself.
 *
 * ## Two deliberate exclusions
 *
 *   demat_mf  Mutual funds held in demat also arrive through the CAMS/KFintech
 *             CAS (cas_*), which carries their cost and transactions. Showing
 *             both would double the money, so demat MFs are dropped here and the
 *             CAS copy wins.
 *
 *   cost/gain An eCAS is a holdings SNAPSHOT with no transaction ledger, so
 *             there is no cost basis. invested is left equal to value (gain 0)
 *             rather than invented — the board shows what is held, not a return
 *             the statement cannot support.
 */
import type { ProductType } from '../../crm/types';
import { clientSupabase as supabase } from '../../lib/supabase';
import type { AssetClass } from '../types';
import type { DematHoldingMeta, PortalHolding } from '../types/cas';

/** How each stored asset_class presents on the board. */
interface Display {
  productType: string; // distinct allocation-bucket key (not a real CRM product)
  label: string;
  color: string;
  assetClass: AssetClass;
}

const DISPLAY: Record<string, Display> = {
  equity: { productType: 'listed_equity', label: 'Stocks', color: '#2E9E8F', assetClass: 'Equity' },
  etf: { productType: 'etf', label: 'ETFs', color: '#3E7CB1', assetClass: 'Equity' },
  corporate_bond: { productType: 'corporate_bond', label: 'Corporate Bonds', color: '#C08A2D', assetClass: 'Debt' },
  gsec: { productType: 'gsec', label: 'Government Securities', color: '#6B7A99', assetClass: 'Debt' },
  aif: { productType: 'aif', label: 'AIFs', color: '#8E6FB3', assetClass: 'Other' },
  nps: { productType: 'nps', label: 'NPS', color: '#4C8C6B', assetClass: 'Other' },
  other: { productType: 'demat_other', label: 'Other Securities', color: '#7688A4', assetClass: 'Other' },
};

interface DematImportRow {
  id: string;
  statement_date: string | null;
  created_at: string;
}
interface DematHoldingRow {
  id: string;
  import_id: string;
  asset_class: string;
  isin: string | null;
  name: string;
  units: number | null;
  value: number | null;
  extra: Record<string, unknown> | null;
  demat_accounts?: { depository: string | null } | null;
}

export interface DematPortfolio {
  holdings: PortalHolding[];
  statementDate: string | null;
  importedAt: string;
  totalValue: number;
}

/** A short secondary line, from whatever the class carries. */
function metaLine(assetClass: string, isin: string | null, extra: Record<string, unknown> | null): string | undefined {
  const coupon = extra?.coupon ?? extra?.coupon_rate;
  if ((assetClass === 'corporate_bond' || assetClass === 'gsec') && coupon != null) return `${coupon}% coupon`;
  const pran = extra?.pran;
  if (assetClass === 'nps' && pran) return `PRAN ${String(pran)}`;
  return isin ?? undefined;
}

export const DematPortfolioService = {
  /** The client's most recent parsed eCAS, as board-ready holdings. Null if none. */
  async getPortfolio(clientId: string): Promise<DematPortfolio | null> {
    const { data: imports } = await supabase
      .from('demat_imports')
      .select('id,statement_date,created_at')
      .eq('client_id', clientId)
      .eq('status', 'parsed')
      .order('created_at', { ascending: false })
      .limit(1);

    const latest = (imports?.[0] as DematImportRow) ?? null;
    if (!latest) return null;

    const { data: rows } = await supabase
      .from('demat_holdings')
      .select('id,import_id,asset_class,isin,name,units,value,extra,demat_accounts(depository)')
      .eq('import_id', latest.id)
      .order('value', { ascending: false });

    const holdings: PortalHolding[] = [];
    let total = 0;
    for (const r of (rows as DematHoldingRow[] | null) ?? []) {
      // Demat-held MFs are the CAS's job; dropping them here avoids double count.
      if (r.asset_class === 'demat_mf') continue;
      const d = DISPLAY[r.asset_class] ?? DISPLAY.other;
      const value = Number(r.value) || 0;
      const units = Number(r.units) || 0;
      total += value;

      const demat: DematHoldingMeta = {
        source: 'demat',
        importId: latest.id,
        importedAt: latest.created_at,
        statementDate: latest.statement_date,
        isin: r.isin,
        depository: r.demat_accounts?.depository ?? null,
        assetClass: d.assetClass,
        label: d.label,
        color: d.color,
        meta: metaLine(r.asset_class, r.isin, r.extra ?? null),
      };

      holdings.push({
        id: r.id,
        client_id: clientId,
        // A distinct grouping key per class, never a real CRM product_type.
        product_type: d.productType as ProductType,
        product_name: r.name,
        quantity: units,
        // No cost in an eCAS: invested = value so the row shows zero gain
        // rather than a fabricated one.
        avg_cost: units > 0 ? value / units : 0,
        current_value: value,
        invested_amount: value,
        maturity_date: '',
        notes: '',
        created_at: latest.created_at,
        updated_at: latest.created_at,
        isin: r.isin,
        demat,
      });
    }

    if (holdings.length === 0) return null;
    return {
      holdings,
      statementDate: latest.statement_date,
      importedAt: latest.created_at,
      totalValue: total,
    };
  },
};
