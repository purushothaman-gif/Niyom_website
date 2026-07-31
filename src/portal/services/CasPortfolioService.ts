/**
 * CasPortfolioService — the client's mutual funds, as their own statement states
 * them.
 *
 * ## Why this supersedes nw_holdings for mutual funds
 *
 * nw_holdings is hand-maintained by staff and only ever contained what we sold.
 * A CAS contains everything the client holds, including funds bought elsewhere,
 * so once a reconciled statement exists it is both more complete and more
 * current than anything we typed in.
 *
 * They are therefore alternatives, never a union: a fund we sold appears in
 * BOTH, and merging would show it twice and double its value. HoldingService
 * swaps one for the other rather than combining them.
 *
 * ## What is deliberately NOT read from here
 *
 * Only mutual funds. Bonds, insurance, fixed deposits and unlisted shares stay
 * with nw_holdings — a CAS knows nothing about them, and they carry DSA pricing
 * and trail fields no statement could supply.
 *
 * ## Only reconciled imports
 *
 * `status = 'reconciled'` means the parse matched the totals printed on the
 * statement itself. Anything else is stored for diagnosis and must never reach
 * a screen: a portfolio that is quietly short is worse than one that is absent.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import type { NWHolding } from '../../crm/types';

/** A cash flow as the investor experienced it: negative paid in, positive received. */
export interface CasCashFlow {
  amount: number;
  date: string;
}

export interface CasPortfolio {
  importId: string;
  /** The date the statement was drawn up to — everything here is as of then. */
  statementTo: string | null;
  importedAt: string;
  holdings: NWHolding[];
  flows: CasCashFlow[];
}

interface SchemeRow {
  id: string;
  client_id: string | null;
  name: string;
  units: number | null;
  nav: number | null;
  nav_date: string | null;
  value: number | null;
  cost: number | null;
  isin: string | null;
  advisor_code: string | null;
  is_ours: boolean | null;
  cas_folios: { folio_number: string; amc: string | null; registrar: string | null } | null;
}

export interface TxnRow {
  txn_date: string;
  txn_type: string | null;
  amount: number | null;
  units: number | null;
}

/**
 * Which ledger entries are money entering or leaving the INVESTOR's pocket.
 *
 * A CAS prints amounts from the fund's point of view, so the sign has to be
 * decided per type rather than flipped wholesale:
 *
 *   purchases and charges   the investor pays        -> negative
 *   redemptions             the investor receives    -> positive
 *   dividend PAYOUTS        the investor receives    -> positive
 *
 * Two kinds are excluded on purpose. A switch moves money between schemes
 * without any of it reaching the investor, so counting both legs would add
 * noise to a portfolio-level return that they cancel out of anyway. And a
 * dividend carrying units is a REINVESTMENT — no cash changed hands, which is
 * exactly what distinguishes it from a payout.
 */
export function toFlow(t: TxnRow): CasCashFlow | null {
  const amount = Math.abs(Number(t.amount) || 0);
  if (!amount || !t.txn_date) return null;
  switch (t.txn_type) {
    case 'PURCHASE':
    case 'STT':
    case 'STAMP_DUTY':
      return { amount: -amount, date: t.txn_date };
    case 'REDEMPTION':
      return { amount, date: t.txn_date };
    case 'DIVIDEND':
      return Number(t.units) ? null : { amount, date: t.txn_date };
    default:
      return null;
  }
}

/**
 * A CAS scheme in the shape the rest of the portal already speaks.
 *
 * Mapping into NWHolding rather than introducing a parallel type means every
 * aggregate, breakdown and table keeps working untouched — the portfolio screen
 * does not need to know where a holding came from.
 */
function toHolding(s: SchemeRow, clientId: string, importedAt: string): NWHolding {
  const units = Number(s.units) || 0;
  const value = Number(s.value) || 0;
  const cost = Number(s.cost) || 0;
  return {
    id: s.id,
    client_id: clientId,
    product_type: 'mutual_fund',
    product_name: s.name,
    quantity: units,
    avg_cost: units > 0 ? cost / units : 0,
    current_value: value,
    invested_amount: cost,
    maturity_date: '',
    notes: '',
    created_at: importedAt,
    updated_at: importedAt,
    folio_number: s.cas_folios?.folio_number ?? undefined,
    // Only a DETAILED statement names the AMC; a summary does not, and guessing
    // it from the scheme name would put funds under the wrong house.
    fund_house: s.cas_folios?.amc ?? undefined,
    // A CAS never states a scheme category. Left empty so the classifier falls
    // back to the scheme name instead of inventing one.
    scheme_type: undefined,
    isin: s.isin,
    nav_date: s.nav_date,
    current_nav: Number(s.nav) || null,
  };
}

export const CasPortfolioService = {
  /**
   * The client's most recent reconciled statement, or null if they have none.
   *
   * Newest wins outright rather than being merged with older imports: each CAS
   * is a complete picture as of its own date, so combining two would double
   * every fund that appears in both.
   */
  async getPortfolio(clientId: string): Promise<CasPortfolio | null> {
    const { data: imp } = await supabase
      .from('cas_imports')
      .select('id,statement_to,created_at')
      .eq('client_id', clientId)
      .eq('status', 'reconciled')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!imp) return null;

    const importId = imp.id as string;
    const importedAt = (imp.created_at as string) ?? new Date().toISOString();

    const [schemeRes, txnRes] = await Promise.all([
      supabase
        .from('cas_schemes')
        .select('id,client_id,name,units,nav,nav_date,value,cost,isin,advisor_code,is_ours,cas_folios(folio_number,amc,registrar)')
        .eq('import_id', importId)
        .order('value', { ascending: false }),
      supabase
        .from('cas_transactions')
        .select('txn_date,txn_type,amount,units')
        .eq('import_id', importId)
        .order('txn_date', { ascending: true }),
    ]);

    const schemes = (schemeRes.data ?? []) as unknown as SchemeRow[];
    const txns = (txnRes.data ?? []) as TxnRow[];

    return {
      importId,
      statementTo: (imp.statement_to as string) ?? null,
      importedAt,
      // Fully exited funds are kept in the statement because they carry realised
      // gains, but they are not holdings and must not appear on a holdings list.
      holdings: schemes
        .filter((s) => (Number(s.value) || 0) > 0 || (Number(s.units) || 0) > 0)
        .map((s) => toHolding(s, clientId, importedAt)),
      flows: txns.map(toFlow).filter((f): f is CasCashFlow => f !== null),
    };
  },
};
