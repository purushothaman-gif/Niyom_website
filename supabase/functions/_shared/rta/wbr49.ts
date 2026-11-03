// Map a parsed CAMS WBR49 feed (systematic registrations) into SIP staging
// rows. WBR49 is one row per live registration — SIP, STP or SWP — and carries
// the instalment amount, frequency, mandate day and the start/end/cease/pause
// dates. It has no snapshot-date column of its own (the generation date is in
// the file name), and status is DERIVED from the dates rather than from a row's
// presence, so a partial per-AMC file never wrongly "ceases" other mandates.
//
// One DBF quirk: dBASE field names are capped at 10 chars, so both
// TARGET_SCHEME and TARGET_SCHEME_CODE arrive as "TARGET_SCH"; the second
// (the 5-char code) wins in the name->value map, which is the one we want for
// an STP target. Every other field we read has a unique name.

import { dbfDate, dbfNumber, type DbfTable } from './dbf.ts';

export interface RtaSipStage {
  registrar: string;
  folio: string;
  scheme_code: string;
  sip_ref: string;
  scheme_name: string | null;
  amc_code: string | null;
  holder_name: string | null;
  pan: string | null;
  txn_type: string | null;
  amount: number | null;
  frequency: string | null;
  sip_day: string | null;
  payment_mode: string | null;
  from_date: string | null;
  to_date: string | null;
  cease_date: string | null;
  reg_date: string | null;
  pause_from: string | null;
  pause_to: string | null;
  top_up_amount: number | null;
  top_up_frequency: string | null;
  top_up_percent: number | null;
  bank: string | null;
  branch: string | null;
  ac_type: string | null;
  euin: string | null;
  sub_arn: string | null;
  sub_broker: string | null;
  target_scheme_code: string | null;
  status: 'active' | 'paused' | 'ceased';
  snapshot_date: string | null;
}

export interface Wbr49Parsed {
  snapshotDate: string | null;
  sips: RtaSipStage[];
}

const REQUIRED = ['FOLIO_NO', 'AUT_TRNTYP', 'AUTO_AMOUN'];

const txt = (s: string | undefined): string | null => (s && s.trim() ? s.trim() : null);

/** First valid PAN found anywhere in the cell (the 45-char PAN field can hold
    the first holder padded, or several joint PANs run together). */
const pan = (s: string | undefined): string | null => {
  const m = (s ?? '').toUpperCase().match(/[A-Z]{5}[0-9]{4}[A-Z]/);
  return m ? m[0] : null;
};

/** Does this DBF look like a WBR49 / systematic-registration feed? */
export function isWbr49(table: DbfTable): boolean {
  const names = new Set(table.fields.map((f) => f.name));
  return REQUIRED.every((r) => names.has(r));
}

/**
 * Derive a registration's status from its dates, treating `today` (the
 * snapshot date, or the real today when unknown) as the reference point:
 *   ceased  — a cease date has passed, or the end date is in the past;
 *   paused  — a pause window is open over today;
 *   active  — otherwise.
 */
function deriveStatus(s: {
  cease_date: string | null;
  to_date: string | null;
  pause_from: string | null;
  pause_to: string | null;
}, today: string): 'active' | 'paused' | 'ceased' {
  if (s.cease_date && s.cease_date <= today) return 'ceased';
  if (s.to_date && s.to_date < today) return 'ceased';
  if (s.pause_from && s.pause_from <= today && (!s.pause_to || s.pause_to >= today)) return 'paused';
  return 'active';
}

export function parseWbr49(table: DbfTable, registrar = 'CAMS', snapshotDate: string | null = null): Wbr49Parsed {
  if (!isWbr49(table)) {
    throw new Error('This file is not a CAMS WBR49 feed (missing FOLIO_NO/AUT_TRNTYP/AUTO_AMOUN).');
  }
  const today = snapshotDate ?? new Date().toISOString().slice(0, 10);
  const sips: RtaSipStage[] = [];

  for (const row of table.rows) {
    const folio = txt(row.FOLIO_NO);
    if (!folio) continue;
    const scheme_code = txt(row.PRODUCT) ?? txt(row.SCHEME_COD) ?? folio;

    const from_date = dbfDate(row.FROM_DATE);
    const to_date = dbfDate(row.TO_DATE);
    const cease_date = dbfDate(row.CEASE_DATE);
    const pause_from = dbfDate(row.PAUSE_FROM);
    const pause_to = dbfDate(row.PAUSE_TO_D);

    // Registration number is the natural key; when it is blank or zero, fall
    // back to a composite so two mandates on one folio+scheme don't collide.
    const trno = txt(row.AUTO_TRNO);
    const sip_ref = trno && trno !== '0' ? trno : `${folio}|${scheme_code}|${from_date ?? ''}`;

    sips.push({
      registrar,
      folio,
      scheme_code,
      sip_ref,
      scheme_name: txt(row.SCHEME),
      amc_code: txt(row.AMC_CODE),
      holder_name: txt(row.INV_NAME),
      pan: pan(row.PAN),
      txn_type: txt(row.AUT_TRNTYP),
      amount: dbfNumber(row.AUTO_AMOUN),
      frequency: txt(row.PERIODICIT),
      sip_day: txt(row.PERIOD_DAY),
      payment_mode: txt(row.PAYMENT_MO),
      from_date,
      to_date,
      cease_date,
      reg_date: dbfDate(row.REG_DATE),
      pause_from,
      pause_to,
      top_up_amount: dbfNumber(row.TOP_UP_AMT),
      top_up_frequency: txt(row.TOP_UP_FRQ),
      top_up_percent: dbfNumber(row.TOP_UP_PER),
      bank: txt(row.BANK),
      branch: txt(row.BRANCH),
      ac_type: txt(row.AC_TYPE),
      euin: txt(row.EUIN),
      sub_arn: txt(row.SUB_ARN_CO),
      sub_broker: txt(row.SUBBROKER),
      target_scheme_code: txt(row.TARGET_SCH),
      status: deriveStatus({ cease_date, to_date, pause_from, pause_to }, today),
      snapshot_date: snapshotDate,
    });
  }

  return { snapshotDate, sips };
}
