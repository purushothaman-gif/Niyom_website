// Canonicalise a SIP registration's plan type and frequency at ingest.
//
// The registrars disagree on representation: CAMS WBR49 stores short codes
// (AUT_TRNTYP = "P", PERIODICIT = "OM"), while KFintech's WSREG sends words
// ("SIP", "MONTHLY"). Both parsers run these two helpers so the stored value is
// one canonical form regardless of source — every downstream reader (both
// portals, exports, reports) then sees the same thing. The maps are the single
// source of truth for this decoding; the functions are idempotent on values
// that are already canonical, and anything unrecognised passes through cleanly
// (frequency title-cased, plan upper-cased) so no information is ever lost.

const titleCase = (s: string): string =>
  s.length <= 3 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

// Keyed by the UPPER-CASED raw value. CAMS periodicity codes use an "O"
// (once-per) prefix; KFintech and the canonical form use the word.
const FREQUENCY: Record<string, string> = {
  OD: 'Daily',
  DAILY: 'Daily',
  OW: 'Weekly',
  WEEKLY: 'Weekly',
  OF: 'Fortnightly',
  FORTNIGHTLY: 'Fortnightly',
  OM: 'Monthly',
  MONTH: 'Monthly',
  MONTHLY: 'Monthly',
  OBM: 'Bi-Monthly',
  BIMONTHLY: 'Bi-Monthly',
  'BI-MONTHLY': 'Bi-Monthly',
  OQ: 'Quarterly',
  QUARTER: 'Quarterly',
  QUARTERLY: 'Quarterly',
  OH: 'Half-Yearly',
  OSA: 'Half-Yearly',
  HALFYEARLY: 'Half-Yearly',
  'HALF-YEARLY': 'Half-Yearly',
  SEMIANNUAL: 'Half-Yearly',
  OY: 'Yearly',
  OA: 'Yearly',
  YEARLY: 'Yearly',
  ANNUAL: 'Yearly',
  ANNUALLY: 'Yearly',
};

// CAMS AUT_TRNTYP: P = systematic purchase (SIP), S = switch (STP),
// W/R = withdrawal (SWP). KFintech sends SIP/STP/SWP directly.
const PLAN: Record<string, string> = {
  P: 'SIP',
  SIP: 'SIP',
  S: 'STP',
  STP: 'STP',
  W: 'SWP',
  R: 'SWP',
  SWP: 'SWP',
};

/** "OM" | "MONTH" | "Monthly" -> "Monthly"; unknown -> title-cased as-is. */
export function normalizeSipFrequency(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const v = raw.trim();
  return FREQUENCY[v.toUpperCase()] ?? titleCase(v);
}

/** "P" | "SIP" -> "SIP"; unknown -> upper-cased as-is. */
export function normalizeSipPlan(raw: string | null | undefined): string | null {
  if (!raw || !raw.trim()) return null;
  const v = raw.trim();
  return PLAN[v.toUpperCase()] ?? v.toUpperCase();
}
