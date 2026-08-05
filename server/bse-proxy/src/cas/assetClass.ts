/**
 * What a scheme IS, for tax — equity-oriented, debt, or neither.
 *
 * Capital gains on a mutual fund are taxed by what the fund HOLDS, not by what
 * it is called. An equity-oriented fund (>=65% domestic equity) is long-term
 * after 12 months; anything else takes 24; and a debt fund bought on or after
 * 01-Apr-2023 is never long-term at all. Get the class wrong and every rate,
 * every threshold and every holding period downstream is wrong with it.
 *
 * ## Where the answer comes from
 *
 * AMFI's NAVAll.txt is grouped under category headings — the same file the NAV
 * refresh already downloads and, until now, threw away:
 *
 *   Open Ended Schemes(Equity Scheme - Large Cap Fund)
 *   119551;INF209KA12Z1;INF209KA13Z9;Aditya Birla ...;100.7401;31-Jul-2026
 *
 * That heading covers every scheme from every AMC, keyed by the same ISIN a CAS
 * carries, and costs one extra regex on a file we already fetch. `cas_schemes`
 * has no category of its own — it is blank on all 120 rows — so this is the only
 * source we have that does not involve asking a human about every fund.
 *
 * ## Why some are deliberately left undecided
 *
 * SEBI's category does not always determine the equity percentage:
 *
 *   Multi Asset Allocation   min 10% in each of three assets — equity may be
 *                            anywhere from 10% to 80%
 *   Balanced Advantage       usually held above 65% with arbitrage, but that is
 *                            a choice each AMC makes, not a rule
 *   FoF Domestic             taxed on what the UNDERLYING funds hold
 *   Other Scheme - Index     AMFI files debt index funds here too
 *
 * Fourteen of the 82 schemes our clients actually hold fall in that set. Picking
 * a side for them would produce a confident, wrong tax figure on a real
 * portfolio, so they are marked `ambiguous` and resolved by a human once, per
 * ISIN. The GAIN is still computed and shown — only the tax treatment waits.
 * That split matters: a gain is arithmetic and always knowable, a tax rate is a
 * fact about the fund that we may simply not have.
 */

/**
 * The classes that decide a holding period and a rate.
 *
 * `debt` means a "specified mutual fund" under s.50AA — more than 65% in debt
 * and money market instruments. `other` is everything that is neither: gold,
 * silver, overseas funds, balanced hybrids. They are taxed differently enough
 * (a debt fund bought after 01-Apr-2023 has no long-term treatment at all,
 * while `other` becomes long-term at 24 months) that merging them would be
 * wrong for both.
 */
export type AssetClass = 'equity' | 'debt' | 'other';

export interface Classification {
  /** The heading verbatim, so a wrong call can always be traced to its source. */
  amfiCategory: string;
  /** Best reading of the category. Meaningless on its own when `ambiguous`. */
  assetClass: AssetClass;
  /** True when the category cannot decide and a human must. */
  ambiguous: boolean;
}

/**
 * A category heading, and only a heading.
 *
 * Anchored on the three scheme-type prefixes rather than on a bare "(", because
 * one AMC name in the file — `IL&FS Mutual Fund (IDF)` — also carries brackets
 * and would otherwise be read as a category, silently reclassifying every
 * scheme printed under it.
 */
const CATEGORY_HEADING = /^(?:Open Ended|Close Ended|Interval Fund)\s+Schemes?\s*\(\s*(.+?)\s*\)\s*$/i;

/** Pull the category from a heading line, or null if the line is not one. */
export function readCategoryHeading(line: string): string | null {
  const m = CATEGORY_HEADING.exec(line.trim());
  // AMFI writes both "Equity Scheme -" and "Equity Schemes -", and pads the
  // brackets inconsistently between the daily and historical files. Collapsing
  // whitespace here keeps one spelling per category in the table.
  return m ? m[1].replace(/\s+/g, ' ').trim() : null;
}

/**
 * Rules read in order, first match wins.
 *
 * Ordered most specific first: the hybrid and index entries have to be tested
 * before the broad /equity/ and /debt/ sweeps, or "Index Funds - Debt Funds"
 * would be caught by the equity rule on the word "Funds" and a debt index fund
 * would be taxed as equity.
 */
const RULES: { match: RegExp; assetClass: AssetClass; ambiguous?: boolean }[] = [
  /* ---- ambiguous: the category genuinely does not fix the equity share ---- */
  {
    // 10% minimum in each of three asset classes says nothing about the split.
    match: /multi\s*asset/i,
    assetClass: 'other',
    ambiguous: true,
  },
  {
    // Kept above 65% by most AMCs using arbitrage — a practice, not a mandate.
    match: /balanced\s*advantage|dynamic\s*asset\s*allocation/i,
    assetClass: 'equity',
    ambiguous: true,
  },
  {
    // Taxed on what the underlying funds hold, which the heading never says.
    match: /fund\s*of\s*funds?\s*(scheme)?\s*\(?\s*domestic|fof\s*domestic/i,
    assetClass: 'other',
    ambiguous: true,
  },
  {
    // AMFI files debt index funds under this heading alongside equity ones.
    match: /^other\s+scheme\s*-\s*index\s+funds?$/i,
    assetClass: 'equity',
    ambiguous: true,
  },
  {
    // Some retirement and children's plans are equity-oriented, others hybrid.
    match: /solution\s*oriented|life\s*cycle/i,
    assetClass: 'equity',
    ambiguous: true,
  },
  {
    // A legacy bucket from before SEBI's 2018 categorisation — equity growth
    // schemes, mostly, but the heading carries nothing to confirm it.
    match: /^(growth)$/i,
    assetClass: 'equity',
    ambiguous: true,
  },

  /* ------------------------------- decided: equity-oriented (>=65% equity) -- */
  // Structurally equity-oriented hybrids. Arbitrage funds hold equity fully
  // hedged, and equity savings must keep 65% in equity and equity-related
  // instruments; both are built to qualify.
  { match: /aggressive\s*hybrid|arbitrage|equity\s*savings/i, assetClass: 'equity' },
  { match: /index\s*funds?\s*-\s*equity|equity\s*etf/i, assetClass: 'equity' },
  // ELSS is 80% equity by statute, wherever AMFI files it.
  { match: /elss/i, assetClass: 'equity' },
  { match: /^equity\s+schemes?\s*-/i, assetClass: 'equity' },

  /* ------------------- decided: NOT equity-oriented, and not debt-dominated -- */
  // 40-60% equity: too little to be equity-oriented, too much to be a
  // specified fund.
  { match: /balanced\s*hybrid/i, assetClass: 'other' },
  { match: /gold|silver|overseas|fof\s*overseas/i, assetClass: 'other' },
  { match: /other\s*etfs?/i, assetClass: 'other' },

  /* -------------------------------- decided: debt / specified mutual fund --- */
  // 75-90% debt, so past the 65% bar that defines a specified fund.
  { match: /conservative\s*hybrid/i, assetClass: 'debt' },
  { match: /index\s*funds?\s*-\s*debt|debt\s*etf/i, assetClass: 'debt' },
  { match: /^debt\s+schemes?\s*-|income\s*\/\s*debt\s*oriented/i, assetClass: 'debt' },
  // Legacy pre-2018 headings, all unambiguously debt.
  { match: /^(income|gilt|money\s*market)$/i, assetClass: 'debt' },
];

/**
 * Classify one AMFI category heading.
 *
 * An unrecognised heading is `ambiguous`, never a guess. AMFI adds categories —
 * Silver ETF appeared in 2021 — and a new one quietly defaulting to `equity`
 * would tax a fund at the wrong rate without anything looking broken. Undecided
 * shows up as a prompt; a wrong default does not.
 */
export function classifyCategory(amfiCategory: string): Classification {
  const category = amfiCategory.replace(/\s+/g, ' ').trim();
  for (const rule of RULES) {
    if (rule.match.test(category)) {
      return { amfiCategory: category, assetClass: rule.assetClass, ambiguous: !!rule.ambiguous };
    }
  }
  return { amfiCategory: category, assetClass: 'other', ambiguous: true };
}
