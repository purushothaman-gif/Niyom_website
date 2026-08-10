/**
 * Which mutual-fund plan NIYOM may show and sell.
 *
 * NIYOM is an ARN distributor. A distributor cannot transact a Direct plan at
 * all — Direct exists precisely to cut the distributor out — so a Direct scheme
 * on any catalog, comparison, factsheet or order screen is something we could
 * never actually execute, quoted at returns the client could never earn through
 * us. Direct's lower expense ratio also makes it look strictly better than the
 * Regular plan of the same fund, so showing it is not a neutral mistake: it
 * flatters every number on the page against what the client would really get.
 *
 * This is the single definition. Both the Deno edge functions and the React app
 * import THIS file — the app through a relative path — so the rule cannot drift
 * between the job that builds the catalog and the screen that renders it.
 *
 * SCOPE — this governs what we OFFER. It deliberately says nothing about what a
 * client already OWNS: a client may hold Direct units bought elsewhere, and
 * their portfolio, CAS import and capital-gains statement must keep reporting
 * those truthfully. Filtering there would corrupt their records, not protect
 * them.
 */

/**
 * True when a scheme name is a Direct plan.
 *
 * Word-boundary matched so a fund whose name merely contains the letters
 * (there is no such scheme today, but names change and this is a
 * never-show rule) is not caught by accident.
 */
export function isDirectPlan(schemeName: string): boolean {
  return /\bdirect\b/i.test(schemeName);
}

/** True for the income-distribution variants, which are not the Growth option. */
export function isIdcwPlan(schemeName: string): boolean {
  return /\b(idcw|dividend)\b/i.test(schemeName);
}

/**
 * True for the one plan/option we may put in front of a client: Regular Growth.
 *
 * Regular is identified by the ABSENCE of "direct", never by the presence of
 * "regular". Around a thousand live schemes predate the 2013 Direct/Regular
 * split and simply never say which they are — "HDFC Banking and PSU Debt Fund -
 * Growth Option", "ICICI Prudential ... Retail Growth". Those are Regular
 * plans. Requiring the word would silently drop them from the catalog, which is
 * how a fund quietly goes missing rather than loudly breaking.
 */
export function isRegularGrowth(schemeName: string): boolean {
  return (
    /\bgrowth\b/i.test(schemeName) && !isDirectPlan(schemeName) && !isIdcwPlan(schemeName)
  );
}
