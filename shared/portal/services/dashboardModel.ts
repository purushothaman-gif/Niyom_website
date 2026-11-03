/**
 * dashboardModel
 * -----------------------------------------------------------------------------
 * Pure assembly of the Wealth Dashboard view model from a client snapshot.
 *
 * Everything here now comes from the client's real holdings and transactions.
 * The placeholders that used to fill this model out were removed rather than
 * left behind a "sample data" chip: this screen shows someone their own money,
 * and a plausible invented number is worse than an absent one.
 *
 * What went and why:
 *   - dailyChange   needs NAV history. BSE serves NAVs via nav_master_list,
 *                   which the proxy does not expose yet, so there is no source.
 *   - goals         needs a goals table and a client who has set one. Neither
 *                   exists.
 *   - marketUpdates needs an index feed we do not subscribe to.
 *   - notices       needed an editorial source; there was none.
 *   - upcomingSips  now comes from real BSE registrations on the SIP screen
 *                   rather than a guess derived from holdings.
 */
import type { ClientWealthSnapshot } from './HoldingService';
import { PortfolioService } from './PortfolioService';
import { portfolioXirr } from './xirr';
import type { DashboardData } from '../types';

export function buildDashboardData(snapshot: ClientWealthSnapshot): DashboardData {
  const { holdings, transactions, casFlows, mfSource, historyComplete } = snapshot;
  const summary = PortfolioService.buildSummary(holdings);

  /*
   * Cash flows must line up with the holdings they produced, or the return is
   * measured against the wrong money.
   *
   * Once a statement supplies the mutual funds, its ledger supplies their flows
   * — every purchase since inception, not just the handful we recorded — and
   * the mutual fund rows in nw_transactions have to come out, because the same
   * purchase is now present in both and would be counted twice.
   */
  const otherTxns =
    mfSource === 'cas' ? transactions.filter((t) => t.product_type !== 'mutual_fund') : transactions;

  return {
    summary,
    mutualFunds: PortfolioService.buildMutualFundSummary(holdings),
    // The visible activity list stays as we recorded it: it is what the client
    // did WITH US, and a since-inception statement ledger would bury it.
    recentTransactions: PortfolioService.buildRecentTransactions(transactions),
    // Real money-weighted return from the client's own cash flows. Null when it
    // cannot be computed — too few flows, or nothing realised yet — and the UI
    // then shows nothing rather than 0%, which would read as "flat".
    /*
     * Suppressed outright when the statement begins mid-history. The flows then
     * describe only part of the client's investing, while the closing value
     * describes all of it, and the rate that reconciles those two is meaningless
     * — one real client saw 198,502%. Null says "unknown", which is true.
     */
    xirrPercent: historyComplete ? portfolioXirr(otherTxns, summary.netWorth, casFlows) : null,
  };
}

import type { PortfolioSummary } from '../types';
import { PRODUCT_CHART_COLORS, PRODUCT_LABELS } from '../../crm/utils';

/**
 * Fold the registrar-fed mutual-fund value into a portfolio summary.
 *
 * When mutual funds run on the platform, the in-house book (nw_holdings) no
 * longer carries them, so the client's real MF sits only in the registrar feed
 * (mf_rta_*). This adds that value to net worth and to the allocation ring so
 * the Dashboard reflects what the client actually holds instead of ₹0.
 *
 * The registrar reports a value but no cost basis, so invested is set equal to
 * the MF value — the MF part contributes no fabricated gain, and the overall
 * return stays honest rather than inventing one.
 */
export function augmentSummaryWithMf(
  summary: PortfolioSummary,
  mfValue: number,
  mfHoldings: number,
): PortfolioSummary {
  if (mfValue <= 0) return summary;
  const netWorth = summary.netWorth + mfValue;
  const invested = summary.invested + mfValue;
  const gain = netWorth - invested;

  const existingMf = summary.allocation.find((a) => a.productType === 'mutual_fund');
  const others = summary.allocation.filter((a) => a.productType !== 'mutual_fund');
  const mfSlice = {
    productType: 'mutual_fund' as const,
    label: PRODUCT_LABELS.mutual_fund,
    color: PRODUCT_CHART_COLORS.mutual_fund,
    value: (existingMf?.value ?? 0) + mfValue,
    percent: 0,
    holdings: (existingMf?.holdings ?? 0) + mfHoldings,
  };
  const allocation = [...others, mfSlice]
    .map((s) => ({ ...s, percent: netWorth > 0 ? (s.value / netWorth) * 100 : 0 }))
    .sort((a, b) => b.value - a.value);

  return {
    netWorth,
    invested,
    gain,
    gainPercent: invested > 0 ? (gain / invested) * 100 : 0,
    holdingsCount: summary.holdingsCount + mfHoldings,
    productCount: summary.productCount + (existingMf ? 0 : 1),
    allocation,
  };
}
