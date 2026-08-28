/**
 * Which column is which, in an AMFI file.
 *
 * ## Why this exists
 *
 * On 19-Aug-2026 AMFI added `Plan` and `Option` columns to both of its NAV
 * files and stopped spelling the plan into the scheme name. Nothing errored:
 * the daily parser read six fixed positions, so `Net Asset Value` became
 * `Direct Plan`, every row failed `Number()`, and the refresh logged
 * "AMFI returned no usable rows" every night for nine nights while client
 * portfolios kept showing 18-Aug prices as though they were current.
 *
 * Fixed positions were the mistake. Both files carry a header row naming every
 * column, and reading it costs one pass over one line.
 *
 * ## The four layouts, and why the count no longer separates them
 *
 *   daily   before  Code;ISIN Growth;ISIN Reinvest;Name;NAV;Date                  6
 *   daily   after   Code;ISIN Growth;ISIN Reinvest;Name;Plan;Option;NAV;Date      8
 *   history before  Code;Name;ISIN Growth;ISIN Reinvest;NAV;Repurchase;Sale;Date  8
 *   history after   Code;NAV Name;Plan;Option;ISIN Growth;ISIN Reinvest;NAV;Date  8
 *
 * Three of the four now split into eight parts, so "a row is a row when it has
 * eight columns" no longer tells the daily file from the historical one. What
 * still separates them is the order: the daily file puts its ISINs BEFORE the
 * scheme name, the historical file puts them after. Each parser accepts only a
 * header of its own shape and reads nothing from a file of the other's — the
 * two must never be crossed, because a scheme name read as an ISIN yields
 * nothing, while a sale price read as a NAV yields a plausible wrong number.
 */

/** A header row, split and normalised, or null if this line is not one. */
export function readHeaderCells(line: string): string[] | null {
  const parts = line.split(';');
  if (parts.length < 2) return null;
  if (parts[0].trim().toLowerCase() !== 'scheme code') return null;
  return parts.map((c) => c.replace(/\s+/g, ' ').trim().toLowerCase());
}

/** Index of the first header cell matching `match`, or -1 when absent. */
export function columnIndex(cells: string[], match: RegExp): number {
  return cells.findIndex((c) => match.test(c));
}

/** Header cell patterns, shared so the two parsers name columns identically. */
export const COLUMN = {
  code: /^scheme code$/,
  /** "ISIN Div Payout/ ISIN Growth" — spacing varies between the two files. */
  isinPayout: /^isin.*(payout|growth)/,
  isinReinvest: /^isin.*reinvest/,
  /** "Scheme Name" in the daily file, "NAV Name" in the historical one. */
  name: /^(scheme|nav) name$/,
  plan: /^plan$/,
  option: /^option$/,
  nav: /^net asset value$/,
  date: /^date$/,
} as const;

/**
 * The scheme's full name, from the three columns AMFI now spreads it over.
 *
 * A plan or option already spelled into the name is not repeated. The daily
 * file states each part exactly once ("Axis Children's Fund" + "Direct Plan" +
 * "Growth Option"), but the historical report still carries the plan inside its
 * `NAV Name` on 6,739 of its 8,646 rows — appending blindly there gives
 * "...Multi-Cap Fund-Direct Growth - Direct Plan - GROWTH".
 *
 * Matched on the significant word, because AMFI writes the same plan as
 * "Direct Plan", "Direct" and "DIRECT" in different places.
 */
export function composeSchemeName(name: string, plan: string, option: string): string {
  const base = name.trim();
  const lower = base.toLowerCase();
  const parts = [base];

  for (const raw of [plan, option]) {
    const token = raw.trim();
    // Blank or "-" is absence, not a name fragment to join.
    if (!token || token === '-') continue;
    const key = token.replace(/\s+(plan|option)$/i, '').toLowerCase();
    if (key && lower.includes(key)) continue;
    parts.push(token);
  }
  return parts.filter(Boolean).join(' - ');
}
