/**
 * What a client's imported statements add to their CRM portfolio summary.
 *
 * The client detail page totals the in-house book (nw_holdings) and the
 * registrar MF feed. A client who imported a CAS or a demat statement holds
 * more than that, and a summary reading ₹0 above a list of their stocks is
 * simply wrong. This works out the extra, once, so the cards and the allocation
 * chart agree.
 *
 * It is for the ONE-CLIENT view only. The client list and every firm-wide AUM
 * and MIS figure stay on the book: money held elsewhere is not our business
 * until it moves.
 *
 * ## Not counting the same money twice
 *
 *   our-ARN funds  appear in both the registrar feed and the CAS. The feed is
 *                  fresher, so CAS rows held with us are counted only when the
 *                  feed has nothing for this client.
 *   demat MFs      appear in both the demat statement and the CAS. The CAS
 *                  carries cost, so demat MFs are counted only without a CAS.
 *
 * A demat statement has no purchase cost, so those holdings are entered at
 * value on both sides — the same convention the client list uses for registrar
 * MF — rather than showing a gain nobody can support.
 */
import { MF_OWNERSHIP } from '../../portal/types/ownership';
import type { CasCrmScheme, CasCrmView } from './casClientView';
import type { DematCrmGroup, DematCrmView } from './dematClientView';

export interface StatementSlice {
  label: string;
  value: number;
  color: string;
}

export interface StatementTotals {
  /** Added to the client's total value. */
  value: number;
  /** Added to the client's total invested. */
  invested: number;
  /** The part of `value` that sits outside Niyom. */
  heldElsewhere: number;
  /** Extra rows for the allocation chart. */
  slices: StatementSlice[];
}

const DEMAT_COLORS: Record<string, string> = {
  equity: '#2E9E8F',
  etf: '#3E7CB1',
  corporate_bond: '#C08A2D',
  gsec: '#6B7A99',
  aif: '#8E6FB3',
  nps: '#4C8C6B',
  demat_mf: '#B5679B',
  other: '#7688A4',
};

/**
 * The statement rows that count towards the client's position, after the two
 * de-duplication rules above. The summary cards and the printed report both
 * read this, so a fund can never be counted on one and skipped on the other.
 */
export interface CountedStatementRows {
  /** Statement funds held with us — empty when the registrar feed covers them. */
  ours: CasCrmScheme[];
  /** Statement funds held with another distributor (or of unknown origin). */
  outside: CasCrmScheme[];
  /** Demat groups, without demat MFs when a CAS already carries them. */
  dematGroups: DematCrmGroup[];
}

/**
 * What the other sources already hold for this client, so a statement row that
 * repeats one of them is not counted a second time:
 *
 *   a bond or unlisted share we sold sits in the client's demat account too —
 *     same ISIN as the book row, which carries the cost, so the book row wins;
 *   a fund that moved to us after the statement date is in the registrar feed
 *     AND still on the statement under its old distributor — same folio.
 */
export interface AlreadyHeld {
  /** Registrar-feed funds (folio + ISIN when resolved). */
  registrar?: { folio: string; isin: string | null }[];
  /** ISINs of in-house book holdings. */
  bookIsins?: (string | null | undefined)[];
}

const normFolio = (f: string | null | undefined): string => (f ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const normIsin = (i: string | null | undefined): string => (i ?? '').toUpperCase().trim();

export function countedStatementRows(
  cas: CasCrmView | null,
  demat: DematCrmView | null,
  registrarMfValue: number,
  held: AlreadyHeld = {},
): CountedStatementRows {
  const regFolios = new Map<string, Set<string>>();
  const regIsins = new Set<string>();
  for (const r of held.registrar ?? []) {
    const f = normFolio(r.folio);
    const i = normIsin(r.isin);
    if (f) regFolios.set(f, (regFolios.get(f) ?? new Set()).add(i));
    if (i) regIsins.add(i);
  }
  const bookIsins = new Set((held.bookIsins ?? []).map(normIsin).filter(Boolean));

  // Same folio in the registrar feed, and the same scheme (or one side has no
  // ISIN to tell them apart): the feed is fresher, so the statement row goes.
  const inRegistrar = (s: CasCrmScheme): boolean => {
    const isins = regFolios.get(normFolio(s.folioNumber));
    if (!isins) return false;
    const i = normIsin(s.isin);
    return !i || isins.has(i) || isins.has('');
  };

  const schemes = cas ? cas.schemes.filter((s) => !inRegistrar(s)) : [];
  const ours = !(registrarMfValue > 0) ? schemes.filter((s) => s.ownership === MF_OWNERSHIP.heldWithNiyom) : [];
  const outside = schemes.filter((s) => s.ownership !== MF_OWNERSHIP.heldWithNiyom);

  const dematGroups: DematCrmGroup[] = [];
  for (const g of demat?.groups ?? []) {
    if (g.key === 'demat_mf' && cas) continue;
    const holdings = g.holdings.filter((h) => {
      const i = normIsin(h.isin);
      return !i || !(bookIsins.has(i) || (g.key === 'demat_mf' && regIsins.has(i)));
    });
    const value = holdings.reduce((t, h) => t + h.value, 0);
    if (value > 0) dematGroups.push({ ...g, holdings, value });
  }
  return { ours, outside, dematGroups };
}

export function statementTotals(
  cas: CasCrmView | null,
  demat: DematCrmView | null,
  registrarMfValue: number,
  held: AlreadyHeld = {},
): StatementTotals {
  const slices: StatementSlice[] = [];
  let value = 0;
  let invested = 0;
  let heldElsewhere = 0;

  const { ours, outside, dematGroups } = countedStatementRows(cas, demat, registrarMfValue, held);
  const sum = (rows: CasCrmScheme[], k: 'value' | 'cost') => rows.reduce((t, s) => t + s[k], 0);

  if (ours.length) {
    const v = sum(ours, 'value');
    value += v;
    invested += sum(ours, 'cost');
    if (v > 0) slices.push({ label: 'Mutual Fund (statement)', value: v, color: '#D9548F' });
  }
  if (outside.length) {
    const v = sum(outside, 'value');
    value += v;
    invested += sum(outside, 'cost');
    heldElsewhere += v;
    if (v > 0) slices.push({ label: 'Mutual Fund (outside Niyom)', value: v, color: '#9A6FD0' });
  }

  for (const g of dematGroups) {
    value += g.value;
    invested += g.value;
    heldElsewhere += g.value;
    slices.push({ label: `${g.label} (demat)`.replace(' (demat) (demat)', ' (demat)'), value: g.value, color: DEMAT_COLORS[g.key] ?? DEMAT_COLORS.other });
  }

  return { value, invested, heldElsewhere, slices };
}
