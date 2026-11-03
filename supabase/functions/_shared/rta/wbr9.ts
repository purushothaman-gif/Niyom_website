// Map a parsed CAMS WBR9 feed (investor static / CRMS) into folio and holdings
// staging rows. WBR9 is one row per scheme-folio and carries CLOS_BAL (units)
// and RUPEE_BAL (the registrar's own valuation), so it is both the folio master
// and a daily holdings snapshot. See docs/mf-rta-feeds-plan.md for the full
// column layout; only the fields below are used.

import { dbfDate, dbfNumber, type DbfTable } from './dbf.ts';

export interface RtaFolioStage {
  registrar: string;
  folio: string;
  amc_code: string | null;
  holder_name: string | null;
  pan: string | null;
  joint_names: string[];
  joint_pans: string[];
  tax_status: string | null;
  arn: string | null;
  sub_broker: string | null;
  email: string | null;
  mobile: string | null;
  demat: string | null;
  folio_open_date: string | null;
}

export interface RtaHoldingStage {
  registrar: string;
  folio: string;
  scheme_code: string;
  scheme_name: string | null;
  amc_code: string | null;
  units: number;
  rta_value: number | null;
  nav?: number | null;
  snapshot_date: string | null;
}

export interface Wbr9Parsed {
  snapshotDate: string | null;
  folios: Map<string, RtaFolioStage>; // keyed by folio number
  holdings: RtaHoldingStage[];
}

const REQUIRED = ['FOLIOCHK', 'CLOS_BAL', 'SCH_NAME'];

const txt = (s: string | undefined): string | null => (s && s.trim() ? s.trim() : null);
const pan = (s: string | undefined): string | null => {
  const v = txt(s)?.toUpperCase() ?? null;
  return v && /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v) ? v : null;
};

/** Does this DBF look like a WBR9 / CRMS feed? Matched by column presence. */
export function isWbr9(table: DbfTable): boolean {
  const names = new Set(table.fields.map((f) => f.name));
  return REQUIRED.every((r) => names.has(r));
}

export function parseWbr9(table: DbfTable, registrar = 'CAMS'): Wbr9Parsed {
  if (!isWbr9(table)) {
    throw new Error('This file is not a CAMS WBR9 feed (missing FOLIOCHK/CLOS_BAL/SCH_NAME).');
  }
  const folios = new Map<string, RtaFolioStage>();
  const holdings: RtaHoldingStage[] = [];
  let snapshotDate: string | null = null;

  for (const row of table.rows) {
    const folio = txt(row.FOLIOCHK);
    if (!folio) continue;
    const scheme_code = txt(row.PRODUCT) ?? txt(row.SCHEME_FOL) ?? folio;
    const snap = dbfDate(row.REP_DATE);
    if (snap && !snapshotDate) snapshotDate = snap;

    if (!folios.has(folio)) {
      folios.set(folio, {
        registrar,
        folio,
        amc_code: txt(row.AMC_CODE),
        holder_name: txt(row.INV_NAME),
        pan: pan(row.PAN_NO),
        joint_names: [txt(row.JNT_NAME1), txt(row.JNT_NAME2)].filter((x): x is string => !!x),
        joint_pans: [pan(row.JOINT1_PAN), pan(row.JOINT2_PAN)].filter((x): x is string => !!x),
        tax_status: txt(row.TAX_STATUS),
        arn: txt(row.BROKCODE) ?? txt(row.BROKER_COD),
        sub_broker: txt(row.SUBBROKER),
        email: txt(row.EMAIL),
        mobile: txt(row.MOBILE_NO),
        demat: txt(row.DEMAT),
        folio_open_date: dbfDate(row.FOLIO_DATE),
      });
    }

    holdings.push({
      registrar,
      folio,
      scheme_code,
      scheme_name: txt(row.SCH_NAME),
      amc_code: txt(row.AMC_CODE),
      units: dbfNumber(row.CLOS_BAL) ?? 0,
      rta_value: dbfNumber(row.RUPEE_BAL),
      snapshot_date: snap,
    });
  }

  return { snapshotDate, folios, holdings };
}
