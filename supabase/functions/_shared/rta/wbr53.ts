// CAMS WBR53 "Valuation of all non-zero folios as of a Date" and WBR22
// "AuM on a specific date by Scheme by Investor" — two FULL-BOOK holdings
// snapshots, as opposed to WBR9, which only carries folios touched recently.
// Both land in the same staging rows as WBR9, keyed (registrar, folio,
// scheme_code), so a holding reported by several of them is one row, never two;
// the database keeps the newest snapshot and never blanks a field a richer
// report filled (see migration 20261107190000).
//
// WBR53 (12 cols): FOLIOCHK, PRODUCT, BAL_DATE (D), CLOS_BAL (units), RUPEE_BAL
//   (registrar value), BROK_DLR_C, LAST_TRXN_, EUIN, PAN, AMC_CODE, FOLIO_OLD,
//   SCHEME_FOL. Carries the PAN, so folios match to clients directly.
// WBR22 (15 cols): BROK_DLR_C, PRODUCT, ASSET_DATE (C11 text), FOLIO,
//   INV_NAME, SCHEME_NAM, CLOSING_AS (value), CITY, AE_CODE, TAX_STATUS, UNITS,
//   NAV, INV_IIN, FOLIO_OLD, SCHEME_FOL. No PAN: matches via the folio master.
//
// PRODUCT is the same CAMS product code WBR9 uses as scheme_code, which is what
// makes the three reports converge on one row per holding.

import { dbfDate, dbfNumber, type DbfTable } from './dbf.ts';
import { kfDate } from './kfintech.ts';
import type { RtaFolioStage, RtaHoldingStage, Wbr9Parsed } from './wbr9.ts';

const txt = (s: string | undefined): string | null => (s && s.trim() ? s.trim() : null);
const pan = (s: string | undefined): string | null => {
  const m = (s ?? '').toUpperCase().match(/[A-Z]{5}[0-9]{4}[A-Z]/);
  return m ? m[0] : null;
};

const has = (table: DbfTable, cols: string[]) => {
  const names = new Set(table.fields.map((f) => f.name));
  return cols.every((c) => names.has(c));
};

export const isWbr53 = (t: DbfTable) => has(t, ['FOLIOCHK', 'BAL_DATE', 'CLOS_BAL', 'RUPEE_BAL', 'PRODUCT']);
export const isWbr22 = (t: DbfTable) => has(t, ['FOLIO', 'ASSET_DATE', 'CLOSING_AS', 'UNITS', 'PRODUCT']);

/** A folio row carrying only what these reports know; the DB keeps the rest. */
function sparseFolio(registrar: string, folio: string, extra: Partial<RtaFolioStage>): RtaFolioStage {
  return {
    registrar, folio,
    amc_code: null, holder_name: null, pan: null, joint_names: [], joint_pans: [],
    tax_status: null, arn: null, sub_broker: null, email: null, mobile: null, demat: null,
    folio_open_date: null,
    ...extra,
  };
}

/** WBR22's ASSET_DATE is text: "30-Oct-2026", "30/10/2026" or "20261030". */
function assetDate(s: string | undefined): string | null {
  return kfDate(s) ?? dbfDate(s);
}

function finish(folios: Map<string, RtaFolioStage>, holdings: RtaHoldingStage[]): Wbr9Parsed {
  // The report's as-of date = the latest date it carries.
  const snapshotDate = holdings.reduce<string | null>(
    (m, h) => (h.snapshot_date && (!m || h.snapshot_date > m) ? h.snapshot_date : m), null);
  return { snapshotDate, folios, holdings };
}

export function parseWbr53(table: DbfTable, registrar = 'CAMS'): Wbr9Parsed {
  if (!isWbr53(table)) throw new Error('This file is not a CAMS WBR53 valuation feed.');
  const folios = new Map<string, RtaFolioStage>();
  const holdings: RtaHoldingStage[] = [];
  for (const row of table.rows) {
    const folio = txt(row.FOLIOCHK);
    const scheme_code = txt(row.PRODUCT) ?? txt(row.SCHEME_FOL);
    if (!folio || !scheme_code) continue;
    if (!folios.has(folio)) {
      folios.set(folio, sparseFolio(registrar, folio, {
        amc_code: txt(row.AMC_CODE), pan: pan(row.PAN), arn: txt(row.BROK_DLR_C),
      }));
    }
    holdings.push({
      registrar, folio, scheme_code,
      scheme_name: null, // not in WBR53; filled from the scheme master / kept from WBR9
      amc_code: txt(row.AMC_CODE),
      units: dbfNumber(row.CLOS_BAL) ?? 0,
      rta_value: dbfNumber(row.RUPEE_BAL),
      snapshot_date: dbfDate(row.BAL_DATE),
    });
  }
  return finish(folios, holdings);
}

export function parseWbr22(table: DbfTable, registrar = 'CAMS'): Wbr9Parsed {
  if (!isWbr22(table)) throw new Error('This file is not a CAMS WBR22 AuM feed.');
  const folios = new Map<string, RtaFolioStage>();
  const holdings: RtaHoldingStage[] = [];
  for (const row of table.rows) {
    const folio = txt(row.FOLIO);
    const scheme_code = txt(row.PRODUCT) ?? txt(row.SCHEME_FOL);
    if (!folio || !scheme_code) continue;
    if (!folios.has(folio)) {
      folios.set(folio, sparseFolio(registrar, folio, {
        holder_name: txt(row.INV_NAME), tax_status: txt(row.TAX_STATUS), arn: txt(row.BROK_DLR_C),
      }));
    }
    holdings.push({
      registrar, folio, scheme_code,
      scheme_name: txt(row.SCHEME_NAM),
      amc_code: null,
      units: dbfNumber(row.UNITS) ?? 0,
      rta_value: dbfNumber(row.CLOSING_AS),
      nav: dbfNumber(row.NAV),
      snapshot_date: assetDate(row.ASSET_DATE),
    });
  }
  return finish(folios, holdings);
}
