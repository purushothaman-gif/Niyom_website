// Human labels for a registrar SIP/STP/SWP row.
//
// The registrar feeds are not consistent: KFintech already decodes the plan
// type and frequency ("SIP", "Monthly"), but the CAMS WBR49 parser stores the
// raw codes (AUT_TRNTYP = "P", PERIODICIT = "OM"). Rather than re-ingest, both
// portals run the stored value through these maps for display. Anything already
// friendly, or any code we don't recognise, passes through unchanged (title-
// cased) so nothing is ever hidden.

const titleCase = (s: string) =>
  s.length <= 3 ? s : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();

// CAMS periodicity codes use an "O" (once-per) prefix; KFintech sends the word.
const FREQUENCY: Record<string, string> = {
  OD: 'Daily',
  OW: 'Weekly',
  OF: 'Fortnightly',
  OM: 'Monthly',
  OBM: 'Bi-Monthly',
  OQ: 'Quarterly',
  OH: 'Half-Yearly',
  OSA: 'Half-Yearly',
  OY: 'Yearly',
  OA: 'Yearly',
};

// Plan type. CAMS AUT_TRNTYP: P = systematic purchase (SIP), S = switch (STP),
// W/R = withdrawal (SWP). KFintech sends SIP/STP/SWP directly.
const PLAN: Record<string, string> = {
  P: 'SIP',
  S: 'STP',
  W: 'SWP',
  R: 'SWP',
  SIP: 'SIP',
  STP: 'STP',
  SWP: 'SWP',
};

/** "OM" -> "Monthly"; "Monthly" -> "Monthly"; unknown -> title-cased as-is. */
export function sipFrequencyLabel(raw: string | null | undefined): string {
  if (!raw) return '';
  const key = raw.trim().toUpperCase();
  return FREQUENCY[key] ?? titleCase(raw.trim());
}

/** "P" -> "SIP"; "SIP" -> "SIP"; unknown -> upper-cased as-is. */
export function sipPlanLabel(raw: string | null | undefined): string {
  if (!raw) return 'SIP';
  const key = raw.trim().toUpperCase();
  return PLAN[key] ?? key;
}
