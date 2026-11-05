// Pure name-matching for brand logos (no React, no network) — unit tested.
//
// Two problems this solves:
//  1. ~250 bonds were imported from {isin, bond_name, price} rows and have no
//     bm_issuers link, so issuer_name is null. Their issuer lives only inside the
//     bond name: "10.25% MUTHOOT MERCANTILE LIMITED 2029".
//  2. The same company is spelled many ways across imports: "PAISALO DIGITAL LTD"
//     / "PAISALO DIGITAL LIMITED", "U. P. POWER CORPORATION LTD.", "REC LTD", etc.
// So lookups go exact key → core key (corporate suffixes dropped) → alias.

/** Must match the generated name_key column: lower-case, alphanumerics only. */
export function brandKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const SUFFIX = /(privatelimited|pvtltd|limited|limite|lmited|ltd|pvt|private)$/;

/** Key with trailing corporate-form suffixes removed: "tatacapitallimited" → "tatacapital". */
export function coreKey(key: string): string {
  let k = key;
  for (;;) {
    const next = k.replace(SUFFIX, '');
    if (next === k || !next) return k;
    k = next;
  }
}

/** Short forms seen in bond names → the core key of the issuer's full name. */
const ALIASES: Record<string, string> = {
  rec: 'ruralelectrificationcorporation',
  pfc: 'powerfinancecorporation',
  hudco: 'housingandurbandevelopmentcorporation',
  sbi: 'statebankofindia',
  gs: 'governmentofindia',
  goi: 'governmentofindia',
  edelweissfinser: 'edelweissfinancialservices',
  andhrapradeshstatebeveragecorp: 'andhrapradeshstatebeveragescorporation',
  muthoottumcred: 'muthootmcred',
  keralafincorp: 'keralafinancialcorporation',
  irfc: 'indianrailwayfinancecorporation',
  nhai: 'nationalhighwaysauthorityofindia',
  nhb: 'nationalhousingbank',
  ireda: 'indianrenewableenergydevelopmentagency',
  iifcl: 'indiainfrastructurefinancecompany',
};

/** Every key a name may be stored under, most specific first. */
export function lookupKeys(name: string): string[] {
  const exact = brandKey(name);
  const core = coreKey(exact);
  const alias = ALIASES[core];
  return [...new Set([exact, core, alias].filter((k): k is string => !!k))];
}

const TAIL = new RegExp(
  '\\s+(' +
    [
      '\\d{1,2}[\\s./-]+[A-Za-z]{3,9}[\\s./-]+\\d{4}', // 11 JAN 2031, 11-JAN-2031
      '\\d{1,2}[./-]\\d{1,2}[./-]\\d{4}',              // 10.03.2029, 24/03/2030
      '\\d{4}',                                        // 2029
      'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec',
      'tax[\\s-]*free', 'perp(etual)?', 'call', 'at1', 'ncd', 'bonds?', 'series\\s*\\S+',
    ].join('|') +
    ')\\s*$',
  'i',
);

/**
 * The issuer named inside a bond name, for bonds with no linked issuer:
 * "10.25% MUTHOOT MERCANTILE LIMITED 2029" → "MUTHOOT MERCANTILE LIMITED".
 */
export function issuerFromBondName(bondName: string | null | undefined): string {
  if (!bondName) return '';
  // Notes on later lines are bracketed, so joining lines keeps names that wrap
  // ("KERALA INFRASTRUCTURE\r\nINVESTMENT FUND BOARD 2033") and drops the notes.
  let n = bondName.replace(/\r?\n/g, ' ').replace(/\([^)]*\)?/g, ' ');
  // Leading coupon, including step-up pairs: "7.74%/7.49% ", "8.20%/8.35 ", "7.39% / 7.69% ".
  n = n.replace(/^[\s/]*\d+(\.\d+)?\s*%?(\s*\/\s*\d+(\.\d+)?\s*%?)*\s*/, '');
  for (;;) {
    const next = n.replace(TAIL, '').trim();
    if (next === n) break;
    n = next;
  }
  return n.replace(/\s+/g, ' ').trim();
}
