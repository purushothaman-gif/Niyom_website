// Shared staging shape + direction classifier for the registrar TRANSACTION
// feeds (CAMS WBR2/WBR2A, KFintech WBTRN). One row per registrar transaction.
// The read model folds these into each holding's first investment date and net
// invested cost, so the classifier only has to get the DIRECTION right:
// purchases/switch-ins add to cost, redemptions/switch-outs subtract.

export type RtaTxnKind =
  | 'purchase'
  | 'redemption'
  | 'switch_in'
  | 'switch_out'
  | 'dividend'
  | 'other';

export interface RtaTxnStage {
  registrar: string;
  folio: string;
  scheme_code: string;
  txn_ref: string; // stable per (registrar): folio|scheme|registrar-txn-no
  scheme_name: string | null;
  amc_code: string | null;
  holder_name: string | null;
  pan: string | null;
  txn_kind: RtaTxnKind;
  txn_type_raw: string | null;
  trade_date: string | null;
  post_date: string | null;
  amount: number | null; // positive magnitude; direction is carried by txn_kind
  units: number | null;
  nav: number | null;
  euin: string | null;
  sub_broker: string | null;
  arn: string | null;
  snapshot_date: string | null;
}

/**
 * Normalise a transaction's direction from the registrar's own type description
 * / code (and the dividend reinvest flag). Registrars word these many ways, so
 * we match on keywords in the human description first, then fall back to the
 * short type code. A dividend that is REINVESTED buys units at the dividend
 * amount, so it counts as a purchase for cost; a dividend PAYOUT does not.
 */
export function classifyTxn(
  desc: string | null,
  code: string | null,
  subtype: string | null,
  reinvestFlag: string | null,
): RtaTxnKind {
  const s = `${desc ?? ''} ${subtype ?? ''} ${code ?? ''}`.toUpperCase();
  // CAMS ships an explicit Y/N reinvest flag; KFintech instead spells it out in
  // the description ("Dividend Reinvestment"), so treat either as a reinvest.
  const reinvest = (reinvestFlag ?? '').toUpperCase().startsWith('Y') || /REINVEST/.test(s);

  // A switch / systematic-transfer leg: OUT reduces this scheme, otherwise it's
  // the IN leg. (SWP = systematic WITHDRAWAL, handled as a redemption below.)
  if (/SWITCH|\bSTP\b|TRANSFER/.test(s)) return /OUT/.test(s) ? 'switch_out' : 'switch_in';
  if (/REDE?M|REDMP|WITHDRAW|\bSWP\b/.test(s)) return 'redemption';
  if (/DIVIDEND|\bIDCW\b|\bDIV\b/.test(s)) return reinvest ? 'purchase' : 'dividend';
  if (/PURCH|SUBSCRIP|INVEST|\bSIP\b|\bSTP\b|ADDITION|\bNEW\b|ALLOT|LUMP/.test(s)) return 'purchase';

  // Fall back to the short code when the description was blank/unknown.
  const c = (code ?? '').toUpperCase().trim();
  const codeMap: Record<string, RtaTxnKind> = {
    P: 'purchase', AP: 'purchase', SIP: 'purchase', NFO: 'purchase', ADD: 'purchase',
    R: 'redemption', RED: 'redemption', SWP: 'redemption',
    SO: 'switch_out', SWOUT: 'switch_out', SWO: 'switch_out',
    SI: 'switch_in', SWIN: 'switch_in', SWI: 'switch_in',
    DP: 'dividend', DIVP: 'dividend',
    DR: reinvest ? 'purchase' : 'dividend', DIVR: 'purchase',
  };
  return codeMap[c] ?? 'other';
}
