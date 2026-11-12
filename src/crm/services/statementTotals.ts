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
import type { CasCrmView } from './casClientView';
import type { DematCrmView } from './dematClientView';

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

export function statementTotals(
  cas: CasCrmView | null,
  demat: DematCrmView | null,
  registrarMfValue: number,
): StatementTotals {
  const slices: StatementSlice[] = [];
  let value = 0;
  let invested = 0;
  let heldElsewhere = 0;

  if (cas) {
    const ours = cas.schemes.filter((s) => s.ownership === MF_OWNERSHIP.heldWithNiyom);
    const outside = cas.schemes.filter((s) => s.ownership !== MF_OWNERSHIP.heldWithNiyom);
    const sum = (rows: typeof ours, k: 'value' | 'cost') => rows.reduce((t, s) => t + s[k], 0);

    if (!(registrarMfValue > 0) && ours.length) {
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
  }

  if (demat) {
    for (const g of demat.groups) {
      if (g.key === 'demat_mf' && cas) continue;
      if (!(g.value > 0)) continue;
      value += g.value;
      invested += g.value;
      heldElsewhere += g.value;
      slices.push({ label: `${g.label} (demat)`.replace(' (demat) (demat)', ' (demat)'), value: g.value, color: DEMAT_COLORS[g.key] ?? DEMAT_COLORS.other });
    }
  }

  return { value, invested, heldElsewhere, slices };
}
