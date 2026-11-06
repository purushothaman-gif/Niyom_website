// Map a CAMS WBR77 feed ("Consolidated Brokerage Payout Details") into
// brokerage staging rows. One DBF record = one brokerage line (trail/upfront)
// earned on one transaction over one period: BRKAGE_AMT is the ex-GST
// brokerage (the revenue), IGST/CGST/SGST_VALUE the GST on it, BRKAGE_RAT the
// % p.a. rate applied to AVG_ASSETS for NO_OF_DAYS. The feed has NO PAN, so the
// pipeline matches lines to clients by folio (see mf_rta_brokerage_match).
// Layout peeked from live files on 2026-11-07 (110 columns, DBF names <=10 chars).

import { dbfDate, dbfNumber, type DbfTable } from './dbf.ts';

const txt = (s: string | undefined): string | null => (s && s.trim() ? s.trim() : null);
const num = (s: string | undefined): number => dbfNumber(s) ?? 0;
const yn = (s: string | undefined): boolean | null => {
  const t = (s ?? '').trim().toUpperCase();
  return t === 'Y' ? true : t === 'N' ? false : null;
};
const monthStart = (iso: string | null): string | null => (iso ? `${iso.slice(0, 7)}-01` : null);

const REQUIRED = ['FOLIO_NO', 'BRKAGE_TYP', 'BRKAGE_AMT', 'AVG_ASSETS', 'BRK_POSTED'];

export type BrokerageCategory = 'trail' | 'upfront' | 'other';

export interface RtaBrokerageStage {
  registrar: string;
  row_key: string;
  amc_code: string | null;
  scheme_code: string | null;
  txn_scheme_code: string | null;
  folio: string;
  holder_name: string | null;
  arn: string | null;
  sub_broker: string | null;
  euin: string | null;
  euin_valid: boolean | null;
  brokerage_type: string | null;
  category: BrokerageCategory;
  trxn_type: string | null;
  trxn_desc: string | null;
  trxn_no: string | null;
  trade_date: string | null;
  txn_amount: number | null;
  txn_units: number | null;
  rate: number | null;
  avg_assets: number | null;
  no_of_days: number | null;
  brokerage: number;
  igst: number;
  cgst: number;
  sgst: number;
  brokerage_from: string | null;
  brokerage_to: string | null;
  process_from: string | null;
  process_to: string | null;
  posted_date: string | null;
  brokerage_month: string;
  adj_flag: string | null;
  rate_ref: string | null;
}

export interface Wbr77Parsed {
  lines: RtaBrokerageStage[];
  /** The file's own totals, summed straight off the DBF records. */
  totals: { rows: number; brokerage: number; gst: number };
  /** Latest processing date in the file (the "as of" of the report). */
  snapshotDate: string | null;
}

export function isWbr77(table: DbfTable): boolean {
  const names = new Set(table.fields.map((f) => f.name));
  return REQUIRED.every((r) => names.has(r));
}

/** TF = trail fee; upfront shows as a U* type, an "upfront" description or a TOTAL_UPFR amount. */
export function classifyBrokerage(type: string | null, desc: string | null, totalUpfront: number): BrokerageCategory {
  const t = (type ?? '').toUpperCase();
  const d = (desc ?? '').toLowerCase();
  if (t.startsWith('T') || /trail/.test(d)) return 'trail';
  if (t.startsWith('U') || t.includes('UPF') || /upfront|up-front/.test(d) || totalUpfront > 0) return 'upfront';
  return 'other';
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function parseWbr77(table: DbfTable, registrar = 'CAMS'): Wbr77Parsed {
  if (!isWbr77(table)) {
    throw new Error('This file is not a CAMS WBR77 brokerage feed (missing FOLIO_NO/BRKAGE_TYP/BRKAGE_AMT/AVG_ASSETS/BRK_POSTED).');
  }
  const lines: RtaBrokerageStage[] = [];
  const seen = new Map<string, number>();
  let brokerage = 0;
  let gst = 0;
  let rows = 0;
  let snapshotDate: string | null = null;

  for (const row of table.rows) {
    rows++;
    const amt = num(row.BRKAGE_AMT);
    const igst = num(row.IGST_VALUE), cgst = num(row.CGST_VALUE), sgst = num(row.SGST_VALUE);
    // Totals are the file's own: every live record counts, even one we can't key.
    brokerage += amt;
    gst += igst + cgst + sgst;

    const folio = txt(row.FOLIO_NO);
    const procFrom = dbfDate(row.PROC_FROM_);
    const procTo = dbfDate(row.PROC_TO_DA);
    const brokFrom = dbfDate(row.BRKAGE_FRO);
    const brokTo = dbfDate(row.BRKAGE_TO);
    const posted = dbfDate(row.BRK_POSTED) ?? dbfDate(row.BROKERAGE_);
    const procDate = dbfDate(row.PROC_DATE);
    if (procDate && (!snapshotDate || procDate > snapshotDate)) snapshotDate = procDate;

    // The month the brokerage is FOR: the processing period CAMS computed it in,
    // else the end of the brokerage period, else the posting date.
    const month = monthStart(procFrom ?? brokTo ?? brokFrom ?? posted ?? procDate);
    if (!folio || !month) {
      throw new Error(`WBR77 record ${rows} has no folio or period — refusing a partial import.`);
    }

    const type = txt(row.BRKAGE_TYP);
    const desc = txt(row.TRXN_DESC);
    const keyBase = [
      txt(row.AMC_CODE), folio, txt(row.SCHEME_COD), txt(row.TRXN_NO), txt(row.TRXN_TYPE), type,
      brokFrom, brokTo, procFrom, txt(row.ADJ_FLAG),
    ].map((v) => v ?? '').join('|');
    // Two identical keys inside one file are distinct lines (e.g. an adjustment
    // that repeats the period): number them so the stored total equals the file's.
    const dup = (seen.get(keyBase) ?? 0) + 1;
    seen.set(keyBase, dup);
    const row_key = dup === 1 ? keyBase : `${keyBase}#${dup}`;

    lines.push({
      registrar,
      row_key,
      amc_code: txt(row.AMC_CODE),
      scheme_code: txt(row.SCHEME_COD),
      txn_scheme_code: txt(row.TXN_SCH_CO),
      folio,
      holder_name: txt(row.INV_NAME),
      arn: txt(row.BROK_CODE) ?? txt(row.ORIG_BRK_C),
      sub_broker: txt(row.SUB_BRK_AR),
      euin: txt(row.ARN_EMP_CO),
      euin_valid: yn(row.EUIN_VALID),
      brokerage_type: type,
      category: classifyBrokerage(type, desc, num(row.TOTAL_UPFR)),
      trxn_type: txt(row.TRXN_TYPE),
      trxn_desc: desc,
      trxn_no: txt(row.TRXN_NO),
      trade_date: dbfDate(row.TRADE_DATE),
      txn_amount: dbfNumber(row.PLOT_AMOUN),
      txn_units: dbfNumber(row.PLOT_UNITS),
      rate: dbfNumber(row.BRKAGE_RAT),
      avg_assets: dbfNumber(row.AVG_ASSETS),
      no_of_days: dbfNumber(row.NO_OF_DAYS),
      brokerage: amt,
      igst, cgst, sgst,
      brokerage_from: brokFrom,
      brokerage_to: brokTo,
      process_from: procFrom,
      process_to: procTo,
      posted_date: posted,
      brokerage_month: month,
      adj_flag: txt(row.ADJ_FLAG),
      rate_ref: txt(row.RATE_REF_I),
    });
  }

  return { lines, totals: { rows, brokerage: round6(brokerage), gst: round6(gst) }, snapshotDate };
}
