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

// --- Client-wise AUM report (WBCUM) → holdings + folio master ----------------
// KFintech's holdings report, the equivalent of CAMS WBR9. It is a full
// snapshot (Balance = units held, AUM = market value, NAV, Report Date), one
// row per folio-scheme, and also carries the folio's investor static — so it
// produces both the folio master and the holdings, matched to clients by PAN.

import type { RtaFolioStage, RtaHoldingStage, Wbr9Parsed } from './wbr9.ts';

const AUM_REQUIRED = ['Folio Number', 'Balance', 'AUM', 'NAV'];

/** Does this CSV look like a KFintech Client-wise AUM report? */
export function isKfAum(table: CsvTable): boolean {
  const names = new Set(table.header);
  return AUM_REQUIRED.every((r) => names.has(r));
}

export function parseKfAum(table: CsvTable, registrar = 'KFINTECH'): Wbr9Parsed {
  if (!isKfAum(table)) {
    throw new Error('This file is not a KFintech Client-wise AUM report (missing Folio Number/Balance/AUM/NAV).');
  }
  const folios = new Map<string, RtaFolioStage>();
  const holdings: RtaHoldingStage[] = [];
  let snapshotDate: string | null = null;

  for (const row of table.rows) {
    const folio = txt(row['Folio Number']);
    if (!folio) continue;
    const scheme_code = txt(row['Product Code']) ?? txt(row['Scheme Code']) ?? folio;
    const snap = kfDate(row['Report Date']);
    if (snap && !snapshotDate) snapshotDate = snap;

    if (!folios.has(folio)) {
      folios.set(folio, {
        registrar,
        folio,
        amc_code: txt(row.Fund),
        holder_name: txt(row['Investor Name']),
        pan: pan(row.PAN),
        joint_names: [],
        joint_pans: [],
        tax_status: null,
        arn: txt(row['Broker Code']) ?? txt(row['Agent Code']),
        sub_broker: txt(row['P-OUT Code']),
        email: txt(row.Email),
        mobile: txt(row['Mobile No']),
        demat: txt(row.DPID),
        folio_open_date: null,
      });
    }

    const units = num(row.Balance) ?? 0;
    const nav = num(row.NAV);
    holdings.push({
      registrar,
      folio,
      scheme_code,
      scheme_name: txt(row['Fund Description']),
      amc_code: txt(row.Fund),
      units,
      rta_value: num(row.AUM),
      nav,
      snapshot_date: snap,
    });
  }

  return { snapshotDate, folios, holdings };
}

// ---------------------------------------------------------------------------
// KFintech Investor Master (WBMST; MFSD211 on-demand / MFSD311 subscribed).
// One row per folio, ~140 columns, NO balances — it is KFintech's folio master,
// the counterpart of the CAMS WBR9 static block. Only the fields the folio
// master stores are read. The file also carries Aadhaar references, bank
// account numbers, dates of birth and nominee details: those are deliberately
// NOT read or stored.

const MASTER_REQUIRED = ['Folio', 'Investor Name', 'PAN Number', 'Product Code'];

/** Does this CSV look like a KFintech Investor Master (and not the AUM report)? */
export function isKfMaster(table: CsvTable): boolean {
  const names = new Set(table.header);
  return MASTER_REQUIRED.every((r) => names.has(r)) && !names.has('Balance');
}

export function parseKfMaster(table: CsvTable, registrar = 'KFINTECH'): Wbr9Parsed {
  if (!isKfMaster(table)) throw new Error('This file is not a KFintech Investor Master report.');
  const folios = new Map<string, RtaFolioStage>();
  let snapshotDate: string | null = null;
  for (const row of table.rows) {
    const folio = txt(row.Folio);
    if (!folio) continue;
    const snap = kfDate(row['Report Date']);
    if (snap && (!snapshotDate || snap > snapshotDate)) snapshotDate = snap;
    if (folios.has(folio)) continue; // one master row per folio (a folio spans schemes)
    folios.set(folio, {
      registrar,
      folio,
      amc_code: txt(row.Fund),
      holder_name: txt(row['Investor Name']),
      pan: pan(row['PAN Number']),
      joint_names: [txt(row['Joint Name 1']), txt(row['Joint Name 2'])].filter((x): x is string => !!x),
      joint_pans: [pan(row.PAN2), pan(row.PAN3)].filter((x): x is string => !!x),
      tax_status: txt(row['Tax Status']),
      arn: txt(row['Broker Code']),
      sub_broker: null,
      email: txt(row.Email),
      mobile: txt(row['Mobile Number']),
      demat: txt(row.DPID),
      folio_open_date: null,
    });
  }
  return { snapshotDate, folios, holdings: [] };
}
