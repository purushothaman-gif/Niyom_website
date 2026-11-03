// Map a KFintech mailback CSV into staging rows. KFintech feeds differ from
// CAMS in two ways the pipeline cares about: they are CSV (not DBF), and they
// arrive as a download link (fetched by the Apps Script) rather than an email
// attachment. The data model is the same — a KFintech SIP registration becomes
// the same RtaSipStage a CAMS WBR49 row does, so both share the SIP upsert.
//
// Only the SIP registration report (WSREG / "SIP REGISTRATION REPORT", 40 cols)
// is mapped here for now; the Investor Master (WBMST) and Transaction (WBTRN)
// reports can be added the same way once their layouts are confirmed.

import type { CsvTable } from './csv.ts';
import type { RtaSipStage } from './wbr49.ts';

const txt = (s: string | undefined): string | null => (s && s.trim() ? s.trim() : null);

const pan = (s: string | undefined): string | null => {
  const m = (s ?? '').toUpperCase().match(/[A-Z]{5}[0-9]{4}[A-Z]/);
  return m ? m[0] : null;
};

const num = (s: string | undefined): number | null => {
  const t = (s ?? '').replace(/,/g, '').trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const MONTHS: Record<string, string> = {
  JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06',
  JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12',
};

/** Parse the date formats KFintech mailback CSVs use into ISO, or null. */
export function kfDate(s: string | undefined): string | null {
  const t = (s ?? '').trim();
  if (!t) return null;
  let m = t.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);           // DD/MM/YYYY or DD-MM-YYYY
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  m = t.match(/^(\d{1,2})[-/]([A-Za-z]{3})[-/](\d{4})$/);       // DD-MON-YYYY
  if (m) {
    const mm = MONTHS[m[2].toUpperCase()];
    return mm ? `${m[3]}-${mm}-${m[1].padStart(2, '0')}` : null;
  }
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);                      // YYYY-MM-DD(...)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{4})(\d{2})(\d{2})$/);                       // YYYYMMDD
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

const REQUIRED = ['Folio', 'SipType', 'RegistrationDate', 'Amount'];

/** Does this CSV look like a KFintech SIP registration report? */
export function isKfSip(table: CsvTable): boolean {
  const names = new Set(table.header);
  return REQUIRED.every((r) => names.has(r));
}

/**
 * Status from KFintech's own Status string first (it ships one), falling back
 * to the dates — so a mandate reads ceased/paused/active the same way a CAMS
 * one does regardless of which signal the registrar populated.
 */
function status(raw: string | null, cease: string | null, to: string | null, today: string): 'active' | 'paused' | 'ceased' {
  const s = (raw ?? '').toUpperCase();
  if (/CEAS|CLOS|TERMINAT|EXPIR|REJECT|CANCEL|COMPLET|STOP/.test(s)) return 'ceased';
  if (/PAUS|HOLD|SUSPEND/.test(s)) return 'paused';
  if (cease && cease <= today) return 'ceased';
  if (to && to < today) return 'ceased';
  return 'active';
}

export function parseKfSip(table: CsvTable, registrar = 'KFINTECH', snapshotDate: string | null = null): RtaSipStage[] {
  if (!isKfSip(table)) {
    throw new Error('This file is not a KFintech SIP registration report (missing Folio/SipType/RegistrationDate/Amount).');
  }
  const today = snapshotDate ?? new Date().toISOString().slice(0, 10);
  const out: RtaSipStage[] = [];

  for (const row of table.rows) {
    const folio = txt(row.Folio);
    if (!folio) continue;
    const scheme_code = txt(row['Product Code']) ?? txt(row['Fund Code']) ?? folio;

    const from_date = kfDate(row['Start Date']);
    const to_date = kfDate(row['End Date']);
    const cease_date = kfDate(row.TerminateDate);

    // Folio + scheme + the registrar's own serial (or instruction no) is a
    // stable, deterministic key; a re-import of the same row overwrites it.
    const serial = txt(row.RegSlno) ?? txt(row.Ihno) ?? from_date ?? '';
    const sip_ref = `${folio}|${scheme_code}|${serial}`;

    out.push({
      registrar,
      folio,
      scheme_code,
      sip_ref,
      scheme_name: txt(row['Scheme Name']) ?? txt(row.Scheme),
      amc_code: txt(row['Fund Code']),
      holder_name: txt(row['Investor Name']),
      pan: pan(row.PAN),
      txn_type: txt(row.Trtype) ?? txt(row.SipType),
      amount: num(row.Amount),
      frequency: txt(row.Frequency),
      sip_day: null, // WSREG carries no explicit mandate day
      payment_mode: txt(row['SIP Mode']),
      from_date,
      to_date,
      cease_date,
      reg_date: kfDate(row.RegistrationDate),
      pause_from: null,
      pause_to: null,
      top_up_amount: null,
      top_up_frequency: null,
      top_up_percent: null,
      bank: txt(row.ECSBankName),
      branch: null,
      ac_type: null,
      euin: null,
      sub_arn: null,
      sub_broker: txt(row.Subbroker),
      target_scheme_code: txt(row.ToProductCode),
      status: status(txt(row.Status), cease_date, to_date, today),
      snapshot_date: snapshotDate,
    });
  }
  return out;
}
