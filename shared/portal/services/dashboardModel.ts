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
