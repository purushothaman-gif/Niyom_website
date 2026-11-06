// Map a CAMS WBR39 feed (the scheme master: every scheme of the selected AMCs
// with its name, plan, asset class, ISIN and transaction limits) into scheme
// reference rows. WBR77 brokerage lines carry only AMC + scheme CODES; this is
// what turns them into scheme and AMC names. Peeked 2026-11-07: 57 columns,
// ~7.4k schemes across 27 AMCs. Only the labelling columns are kept.

import type { DbfTable } from './dbf.ts';

const txt = (s: string | undefined): string | null => (s && s.trim() ? s.trim() : null);
const REQUIRED = ['AMC_CODE', 'AMC', 'SCH_CODE', 'SCH_NAME', 'PLAN_TYPE', 'ASSET_CLAS'];

export interface RtaSchemeStage {
  registrar: string;
  amc_code: string;
  scheme_code: string;
  amc_name: string | null;
  scheme_name: string | null;
  scheme_type: string | null;
  plan_type: string | null;
  asset_class: string | null;
  sebi_class: string | null;
  isin: string | null;
  parent_code: string | null;
}

export function isWbr39(table: DbfTable): boolean {
  const names = new Set(table.fields.map((f) => f.name));
  return REQUIRED.every((r) => names.has(r));
}

export function parseWbr39(table: DbfTable, registrar = 'CAMS'): { schemes: RtaSchemeStage[]; rows: number } {
  if (!isWbr39(table)) throw new Error('This file is not a CAMS WBR39 scheme master.');
  // Keyed by AMC + scheme code; a repeated code keeps the last record.
  const byKey = new Map<string, RtaSchemeStage>();
  for (const row of table.rows) {
    const amc = txt(row.AMC_CODE);
    const code = txt(row.SCH_CODE);
    if (!amc || !code) continue;
    byKey.set(`${amc}|${code}`, {
      registrar,
      amc_code: amc,
      scheme_code: code,
      amc_name: txt(row.AMC),
      scheme_name: txt(row.SCH_NAME),
      scheme_type: txt(row.SCH_TYPE),
      plan_type: txt(row.PLAN_TYPE),
      asset_class: txt(row.ASSET_CLAS),
      sebi_class: txt(row.SEBI_CLASS),
      isin: txt(row.ISIN_NO),
      parent_code: txt(row.PARENT_SCH),
    });
  }
  return { schemes: [...byKey.values()], rows: table.rows.length };
}
