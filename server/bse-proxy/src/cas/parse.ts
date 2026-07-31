/**
 * Consolidated Account Statement (CAS) parser — CAMS + KFintech.
 *
 * A CAS is the only document that shows everything a client holds in mutual
 * funds, across every AMC and both registrars. BSE cannot tell us this; it is
 * the order rail, not the portfolio one.
 *
 * ## Why this parses text rather than calling an API
 *
 * A CAS is a client's entire financial life. Keeping the parse inside our own
 * infrastructure means the document never leaves it.
 *
 * ## The failure mode this is built around
 *
 * RTAs change these layouts periodically. A drifting text parser does not
 * crash — it quietly matches fewer rows and returns a smaller portfolio, and
 * "your savings are ₹1.4L" when they are ₹2.2L is far worse than an error.
 *
 * So every parse is reconciled against the totals the document prints for
 * itself. `reconciled` is only true when our summed market value and cost both
 * match the stated totals to the paisa. Callers must refuse to persist an
 * unreconciled parse as authoritative.
 *
 * ## Layout being parsed (CAMS "Consolidated Account Summary", V3.5)
 *
 * PDF text extraction runs adjacent columns together, so a holding arrives as
 * three or more lines with no reliable separator:
 *
 *   12924960 48,882.82K144D - Kotak ELSS Tax Saver Fund -      <- head
 *   Direct Plan - Growth (Non-Demat)                            <- name overflow
 *   351.147 31-Jul-2026 139.209 CAMSINF174K01LI3 45,500.000     <- tail
 *
 * head: folio, market value, then the RTA scheme code jammed onto the value
 * tail: units, NAV date, NAV, registrar jammed onto ISIN, cost
 *
 * The tail is anchored on shapes that cannot collide — an ISIN is always
 * INF + 9, a registrar is CAMS or KFINTECH, a date is dd-Mmm-yyyy — which is
 * what makes this robust despite the missing whitespace.
 */

export interface CasHolding {
  folioNumber: string;
  rtaCode: string;
  schemeName: string;
  isin: string;
  registrar: 'CAMS' | 'KFINTECH';
  units: number;
  navDate: string; // ISO
  nav: number;
  marketValue: number;
  costValue: number;
  isDemat: boolean;
}

export interface CasInvestor {
  name: string;
  email: string;
  mobile: string;
  address: string;
  /** Empty when the statement masks it (BYXXXXXX5E) — better none than wrong. */
  pan: string;
}

export interface CasParseResult {
  variant: 'summary' | 'detailed';
  statementDate: string | null;
  investor: CasInvestor;
  holdings: CasHolding[];
  /** Totals the document prints for itself — the reconciliation anchor. */
  statedMarketValue: number | null;
  statedCostValue: number | null;
  parsedMarketValue: number;
  parsedCostValue: number;
  /** True only when both totals match. Never persist as authoritative if false. */
  reconciled: boolean;
  variance: { marketValue: number; costValue: number };
  warnings: string[];
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/** "31-Jul-2026" -> "2026-07-31". Returns '' for anything unrecognised. */
function toIso(d: string): string {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(d.trim());
  if (!m) return '';
  const mm = MONTHS[m[2].toLowerCase()];
  return mm ? `${m[3]}-${mm}-${m[1]}` : '';
}

/** "48,882.82" -> 48882.82. Indian grouping, so commas are never decimal. */
function num(s: string): number {
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

/** Money compares to the paisa — floats make exact equality unsafe. */
const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;

/**
 * The closing line of a holding. Anchored on ISIN + registrar + date, which no
 * other line in the document can imitate.
 */
const TAIL =
  /^([\d,]+\.?\d*)\s+(\d{2}-[A-Za-z]{3}-\d{4})\s+([\d,]+\.?\d*)\s*(CAMS|KFINTECH)\s*(INF[A-Z0-9]{9})\s+([\d,]+\.?\d*)\s*$/;

/**
 * The opening line: folio, market value, then the scheme code run onto it.
 * The value is required to carry exactly two decimals, which is what separates
 * it from the unit balance on a tail line.
 */
const HEAD = /^(\S+)\s+([\d,]+\.\d{2})(\S.*)$/;

/** "Total 216,883.66194,580.90" — two amounts with no separator. */
const TOTAL = /^Total\s+([\d,]+\.\d{2})([\d,]+\.\d{2})\s*$/;

/**
 * Collapse runs of whitespace so the shape-anchored patterns can rely on single
 * spaces. Empty lines are kept — parseCas uses them to bound a holding.
 */
export function normalizeLines(text: string): string[] {
  return text.split('\n').map((l) => l.replace(/\s+/g, ' ').trim());
}

/**
 * The totals the document prints for itself — the reconciliation anchor, and
 * the only thing that can tell us the parse missed a holding.
 *
 * Shared with the detailed parse path, which sums per-scheme figures and needs
 * the same independent check. Returns null when the statement prints no total,
 * which callers must treat as unreconcilable rather than as agreement.
 */
export function readStatedTotals(
  lines: string[],
): { marketValue: number; costValue: number } | null {
  for (const line of lines) {
    const t = TOTAL.exec(line);
    if (t) return { marketValue: num(t[1]), costValue: num(t[2]) };
  }
  return null;
}

/**
 * Every PAN the statement states, in the order printed (first = first holder).
 *
 * Used to confirm a statement belongs to the client it is being imported for.
 * Statements sometimes mask the PAN ("BYXXXXXX5E"), which cannot match this
 * shape at all — so an absent PAN means "unknown", never "different".
 */
export function readInvestorPans(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\bPAN\s*:?\s*([A-Z]{5}\d{4}[A-Z])\b/g)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/**
 * Who the statement is for. Both variants print the same block, so the detailed
 * path reads it from here rather than keeping a second copy of these patterns.
 */
export function readInvestor(text: string): CasInvestor {
  const lines = normalizeLines(text);
  const emailIdx = lines.findIndex((l) => /^Email Id:/i.test(l));
  return {
    email: /Email Id:\s*(\S+@\S+)/i.exec(text)?.[1] ?? '',
    mobile: /Mobile:\s*(\+?\d[\d\s-]{7,})/i.exec(text)?.[1]?.trim() ?? '',
    // The investor's name is the line immediately after the email line.
    name: emailIdx >= 0 ? (lines[emailIdx + 1] ?? '').trim() : '',
    address: emailIdx >= 0 ? lines.slice(emailIdx + 2, emailIdx + 6).join(', ') : '',
    pan: readInvestorPans(text)[0] ?? '',
  };
}

/** "01-Jan-1931 To 01-Aug-2026" — the period a detailed statement covers. */
export function readStatementPeriod(text: string): { from: string; to: string } | null {
  const m = /(\d{2}-[A-Za-z]{3}-\d{4})\s*To\s*(\d{2}-[A-Za-z]{3}-\d{4})/i.exec(text);
  if (!m) return null;
  const from = toIso(m[1]);
  const to = toIso(m[2]);
  return from && to ? { from, to } : null;
}

export function parseCas(text: string): CasParseResult {
  const lines = normalizeLines(text);
  const warnings: string[] = [];

  const variant: 'summary' | 'detailed' = /Consolidated Account Summary/i.test(text)
    ? 'summary'
    : 'detailed';

  /* ------------------------------------------------------------- investor */
  const investor = readInvestor(text);

  const statementDate = toIso(
    /As on\s+(\d{2}-[A-Za-z]{3}-\d{4})/i.exec(text)?.[1] ?? '',
  ) || null;

  /* ------------------------------------------------------------- holdings */
  const holdings: CasHolding[] = [];
  let pending: { folio: string; marketValue: number; nameParts: string[] } | null = null;

  for (const line of lines) {
    if (!line) continue;

    const tail = TAIL.exec(line);
    if (tail && pending) {
      const raw = pending.nameParts.join(' ').replace(/\s+/g, ' ').trim();
      // "K144D - Kotak ELSS Tax Saver Fund - Direct Plan - Growth (Non-Demat)"
      const split = /^(\S+)\s+-\s+(.*)$/.exec(raw);
      const schemeName = (split ? split[2] : raw).trim();
      holdings.push({
        folioNumber: pending.folio,
        rtaCode: split ? split[1] : '',
        schemeName,
        isin: tail[5],
        registrar: tail[4] as 'CAMS' | 'KFINTECH',
        units: num(tail[1]),
        navDate: toIso(tail[2]),
        nav: num(tail[3]),
        marketValue: pending.marketValue,
        costValue: num(tail[6]),
        // "(Demat)" vs "(Non-Demat)" / "(Non Demat )" — match the negative first.
        isDemat: /\(\s*Demat\s*\)/i.test(schemeName) && !/Non[\s-]*Demat/i.test(schemeName),
      });
      pending = null;
      continue;
    }

    // The totals line also satisfies HEAD ("Total" reads as a folio), which
    // would open a phantom holding and emit a misleading warning.
    if (TOTAL.test(line)) continue;

    const head = HEAD.exec(line);
    // A tail line can also satisfy HEAD, so only open a record when idle.
    if (head && !pending && !TAIL.test(line)) {
      pending = { folio: head[1], marketValue: num(head[2]), nameParts: [head[3]] };
      continue;
    }

    if (pending) pending.nameParts.push(line);
  }

  if (pending) {
    warnings.push(
      `A holding for folio ${pending.folio} was opened but never closed — the row layout may have changed.`,
    );
  }

  /* -------------------------------------------------------- reconciliation */
  const stated = readStatedTotals(lines);
  const statedMarketValue = stated ? stated.marketValue : null;
  const statedCostValue = stated ? stated.costValue : null;

  const parsedMarketValue = holdings.reduce((s, h) => s + h.marketValue, 0);
  const parsedCostValue = holdings.reduce((s, h) => s + h.costValue, 0);

  if (!stated) {
    warnings.push(
      'No total line was found, so this parse could not be checked against the document. Treating it as unreconciled.',
    );
  }

  const reconciled =
    statedMarketValue !== null &&
    statedCostValue !== null &&
    near(parsedMarketValue, statedMarketValue) &&
    near(parsedCostValue, statedCostValue);

  if (stated && !reconciled) {
    warnings.push(
      `Totals do not match the statement: market ${parsedMarketValue.toFixed(2)} vs ${statedMarketValue?.toFixed(2)}, ` +
        `cost ${parsedCostValue.toFixed(2)} vs ${statedCostValue?.toFixed(2)}. Some holdings were probably missed.`,
    );
  }

  if (variant === 'summary') {
    warnings.push(
      'This is a Summary statement, so it carries no transactions and no advisor code — capital gains, XIRR and held-away attribution need a Detailed statement.',
    );
  }

  return {
    variant,
    statementDate,
    investor,
    holdings,
    statedMarketValue,
    statedCostValue,
    parsedMarketValue,
    parsedCostValue,
    reconciled,
    variance: {
      marketValue: statedMarketValue === null ? 0 : parsedMarketValue - statedMarketValue,
      costValue: statedCostValue === null ? 0 : parsedCostValue - statedCostValue,
    },
    warnings,
  };
}
