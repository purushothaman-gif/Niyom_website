/**
 * Checking a parsed statement against the statement's own arithmetic.
 *
 * Split out of the droplet's import.ts, which mixed this with an express
 * router. Only the reconciliation moved: it is the part that decides whether a
 * client's portfolio is trustworthy, it is pure, and it carries its own tests.
 * The route around it became the `cas-import` Edge Function.
 *
 * Nothing here does I/O, which is deliberate. A statement is accepted or
 * refused on arithmetic alone, and that judgement should be testable without a
 * database, a PDF or a network.
 */
import { readStatedTotalPair, type CasHolding, type CasParseResult } from './parse.ts';
import type { CasDetailedScheme } from './detailed.ts';
/**
 * Comparing a SUM of printed figures against the total printed beside them.
 *
 * Every scheme's market value is printed rounded to the paisa, so adding N of
 * them can land a few paise away from the total the registrar printed — it
 * rounded once, we rounded N times. A real statement was refused over ₹0.02
 * across six schemes, with the message "a scheme was probably missed entirely",
 * which was both wrong and alarming.
 *
 * A paisa per row absorbs that and still cannot hide a missing scheme: the
 * smallest holding worth reporting is thousands of rupees, and a portfolio
 * would need a hundred thousand schemes before this tolerance reached ₹1,000.
 */
const nearSum = (a: number, b: number, rows: number) =>
  Math.abs(a - b) <= Math.max(0.01, rows * 0.01);

/** Units to the thousandth — the precision a CAS prints. */
const nearUnits = (a: number, b: number) => Math.abs(a - b) <= 0.001;

const money = (n: number) => n.toFixed(2);

/* --------------------------------------------------------- reconciliation -- */

interface Reconciliation {
  reconciled: boolean;
  statedMarket: number | null;
  statedCost: number | null;
  parsedMarket: number;
  parsedCost: number;
  /** Why it did not reconcile — stored on the import row for diagnosis. */
  failures: string[];
  warnings: string[];
}

/**
 * Check a detailed parse against the statement's own arithmetic.
 *
 * Two independent checks per scheme, because they fail differently:
 *
 *   opening + sum(units) == closing   catches a DROPPED transaction, and also a
 *                                     price/units split the parser could not
 *                                     resolve (it leaves units at zero).
 *   last running balance == closing   catches a transaction attributed to the
 *                                     wrong scheme.
 *
 * A scheme dropped in its entirety escapes both — a block that was never parsed
 * has nothing to disagree with — which is what the portfolio total is for. Not
 * every detailed statement prints one, so its absence downgrades to a warning
 * rather than silently passing as agreement.
 */
export function reconcileDetailed(schemes: CasDetailedScheme[], lines: string[]): Reconciliation {
  const failures: string[] = [];
  const warnings: string[] = [];

  for (const s of schemes) {
    const where = `${s.schemeName} (folio ${s.folioNumber || 'unknown'})`;

    /*
     * A segregated portfolio holds units nobody bought.
     *
     * When a debt fund's issuer defaults, the AMC side-pockets the doubtful
     * paper into "Segregated Portfolio 1/2" and credits existing holders with
     * units of it — no purchase, no payment, no transaction line in the CAS.
     * The units simply exist, and the unit checks below read that as a whole
     * block of dropped transactions.
     *
     * Passing it is not a concession, it is the accurate treatment: the units
     * are real and belong in the portfolio, and having NO cash flow is correct,
     * because no money was ever put in. Narrow on purpose — only a scheme the
     * statement itself names as segregated, and only when it carries no
     * transactions at all, so an ordinary block that failed to parse still
     * fails loudly.
     */
    if (/segregated portfolio/i.test(s.schemeName) && s.transactions.length === 0) {
      warnings.push(
        `${where}: a segregated portfolio holding ${s.closingUnits.toFixed(3)} units with no transactions — ` +
          'side-pocketed units are credited by the AMC, so there is nothing to reconcile against.',
      );
      continue;
    }

    const ledger = s.transactions.reduce((sum, t) => sum + t.units, s.openingUnits);
    if (!nearUnits(ledger, s.closingUnits)) {
      failures.push(
        `${where}: the transactions add up to ${ledger.toFixed(3)} units but the statement closes at ${s.closingUnits.toFixed(3)}.`,
      );
    }
    if (s.balanceMismatch !== null) {
      failures.push(
        `${where}: the running balance ends ${s.balanceMismatch.toFixed(3)} units away from the stated closing balance.`,
      );
    }
    // txn_date is NOT NULL, so an unreadable date would be dropped on the way
    // to the database — a hole the unit checks above cannot see.
    const undated = s.transactions.filter((t) => !t.date).length;
    if (undated) {
      failures.push(`${where}: ${undated} transaction(s) carry a date this parser could not read.`);
    }
    /*
     * A transaction that moved units but could not be named is the one error
     * every check above is blind to. Units parse identically whatever the type
     * is called, so the balances still reconcile and the holdings are still
     * right — but OTHER is not a cash flow, so the money silently vanishes from
     * the return calculation. That is exactly how a real statement came to show
     * 70% instead of 11%.
     *
     * Fail on it. A registrar phrasing we have not seen should stop the import
     * loudly and get the pattern added, not quietly distort someone's return.
     */
    const unclassified = s.transactions.filter((t) => t.type === 'OTHER' && t.units !== 0);
    if (unclassified.length) {
      const sample = unclassified[0].description.slice(0, 60);
      failures.push(
        `${where}: ${unclassified.length} transaction(s) move units but could not be identified as a purchase, sale or switch (e.g. "${sample}"), so they would be missing from your return.`,
      );
    }
    // Units x NAV should reproduce the stated market value. NAV is printed
    // rounded, so this cannot be exact on a large holding — a warning, never a
    // gate, or rounding alone would block real statements.
    const implied = s.closingUnits * s.nav;
    if (s.marketValue > 0 && Math.abs(implied - s.marketValue) > Math.max(1, s.marketValue * 0.001)) {
      warnings.push(
        `${where}: ${s.closingUnits.toFixed(3)} units at NAV ${s.nav} comes to ${money(implied)}, but the statement says ${money(s.marketValue)}.`,
      );
    }
  }

  const parsedMarket = schemes.reduce((sum, s) => sum + s.marketValue, 0);
  const parsedCost = schemes.reduce((sum, s) => sum + s.costValue, 0);

  const pair = readStatedTotalPair(lines);
  const stated = pair
    ? // Whichever printed figure is nearer our market sum IS the market column.
      Math.abs(pair[0] - parsedMarket) <= Math.abs(pair[1] - parsedMarket)
      ? { marketValue: pair[0], costValue: pair[1] }
      : { marketValue: pair[1], costValue: pair[0] }
    : null;

  if (stated) {
    if (
      !nearSum(parsedMarket, stated.marketValue, schemes.length) ||
      !nearSum(parsedCost, stated.costValue, schemes.length)
    ) {
      failures.push(
        `The schemes total ${money(parsedMarket)} against the statement's ${money(stated.marketValue)}, ` +
          `and cost ${money(parsedCost)} against ${money(stated.costValue)} — a scheme was probably missed entirely.`,
      );
    }
  } else {
    warnings.push(
      'This statement prints no portfolio total, so each scheme was checked against its own closing balance but the set of schemes could not be checked for completeness.',
    );
  }

  if (!schemes.length) failures.push('No schemes were found in this statement.');

  return {
    reconciled: failures.length === 0,
    statedMarket: stated ? stated.marketValue : null,
    statedCost: stated ? stated.costValue : null,
    parsedMarket,
    parsedCost,
    failures,
    warnings,
  };
}

/**
 * The summary variant already reconciles itself against the document's total —
 * this only restates the outcome in the shape the route stores, keeping the
 * parser's advisory notes (chiefly "this is a Summary statement") out of the
 * failure list, where they would read as a layout problem.
 */
export function reconcileSummary(parsed: CasParseResult): Reconciliation {
  const failures: string[] = [];
  if (!parsed.reconciled) {
    failures.push(
      parsed.statedMarketValue === null
        ? 'This statement prints no total, so the parse could not be checked against it.'
        : `The holdings total ${money(parsed.parsedMarketValue)} against the statement's ${money(parsed.statedMarketValue)}, ` +
          `and cost ${money(parsed.parsedCostValue)} against ${money(parsed.statedCostValue ?? 0)} — a holding was probably missed.`,
    );
  }
  if (!parsed.holdings.length) failures.push('No holdings were found in this statement.');
  return {
    reconciled: failures.length === 0,
    statedMarket: parsed.statedMarketValue,
    statedCost: parsed.statedCostValue,
    parsedMarket: parsed.parsedMarketValue,
    parsedCost: parsed.parsedCostValue,
    failures,
    warnings: parsed.warnings,
  };
}

/* ------------------------------------------------------------- row shapes -- */

/** What both statement variants reduce to before being written. */
interface ImportRows {
  folios: Record<string, unknown>[];
  schemes: Record<string, unknown>[];
  transactions: Record<string, unknown>[];
}

interface FolioKey {
  id: string;
  folioNumber: string;
  amc: string | null;
  registrar: string | null;
  value: number;
}

/** One row per folio, with its schemes' market values rolled up. */
function foldFolios(
  entries: { folioNumber: string; amc?: string; registrar?: string; marketValue: number }[],
): Map<string, FolioKey> {
  const folios = new Map<string, FolioKey>();
  for (const e of entries) {
    const key = e.folioNumber || 'unknown';
    const cur =
      folios.get(key) ??
      { id: randomUUID(), folioNumber: key, amc: null, registrar: null, value: 0 };
    cur.value += e.marketValue;
    if (!cur.amc && e.amc) cur.amc = e.amc;
    if (!cur.registrar && e.registrar) cur.registrar = e.registrar.toUpperCase();
    folios.set(key, cur);
  }
  return folios;
}

const gain = (value: number, cost: number) => ({
  gain_absolute: Number((value - cost).toFixed(2)),
  gain_percent: cost > 0 ? Number((((value - cost) / cost) * 100).toFixed(4)) : null,
});

function rowsFromHoldings(
  holdings: CasHolding[],
  importId: string,
  clientId: string,
): ImportRows {
  const folios = foldFolios(holdings);
  return {
    folios: [...folios.values()].map((f) => ({
      id: f.id,
      import_id: importId,
      client_id: clientId,
      folio_number: f.folioNumber,
      amc: f.amc,
      registrar: f.registrar,
      value: Number(f.value.toFixed(2)),
    })),
    schemes: holdings.map((h) => ({
      id: randomUUID(),
      import_id: importId,
      folio_id: folios.get(h.folioNumber || 'unknown')!.id,
      client_id: clientId,
      isin: h.isin,
      rta: h.registrar,
      rta_code: h.rtaCode || null,
      name: h.schemeName,
      units: h.units,
      nav: h.nav,
      nav_date: h.navDate || null,
      value: h.marketValue,
      cost: h.costValue,
      ...gain(h.marketValue, h.costValue),
      // A summary statement carries no advisor code at all, so every holding
      // would read as held away. Left null, which is honestly "not stated".
      advisor_code: null,
    })),
    transactions: [],
  };
}

function rowsFromSchemes(
  schemes: CasDetailedScheme[],
  importId: string,
  clientId: string,
): ImportRows {
  const folios = foldFolios(schemes);
  const schemeRows: Record<string, unknown>[] = [];
  const txnRows: Record<string, unknown>[] = [];

  for (const s of schemes) {
    const schemeId = randomUUID();
    schemeRows.push({
      id: schemeId,
      import_id: importId,
      folio_id: folios.get(s.folioNumber || 'unknown')!.id,
      client_id: clientId,
      isin: s.isin,
      rta: s.registrar || null,
      rta_code: s.rtaCode || null,
      name: s.schemeName,
      units: s.closingUnits,
      nav: s.nav,
      nav_date: s.navDate || null,
      value: s.marketValue,
      cost: s.costValue,
      ...gain(s.marketValue, s.costValue),
      advisor_code: s.advisorCode || null,
    });
    for (const t of s.transactions) {
      if (!t.date) continue; // txn_date is NOT NULL, and an undated row is unusable
      txnRows.push({
        import_id: importId,
        scheme_id: schemeId,
        client_id: clientId,
        txn_date: t.date,
        description: t.description,
        txn_type: t.type,
        amount: t.amount,
        units: t.units,
        nav: t.nav,
        balance_units: t.balanceUnits,
        stamp_duty: t.type === 'STAMP_DUTY' ? Math.abs(t.amount) : null,
      });
    }
  }

  return {
    folios: [...folios.values()].map((f) => ({
      id: f.id,
      import_id: importId,
      client_id: clientId,
      folio_number: f.folioNumber,
      amc: f.amc,
      registrar: f.registrar,
      value: Number(f.value.toFixed(2)),
    })),
    schemes: schemeRows,
    transactions: txnRows,
  };
}
