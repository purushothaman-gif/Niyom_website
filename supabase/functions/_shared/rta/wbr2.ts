// Map a CAMS WBR2 feed ("Investor Transactions for a Period") — and the
// WBR2A historical-transactions variant, which shares this layout — into
// transaction staging rows. WBR2 carries the trade date (TRADDATE), amount,
// units, price and transaction type per transaction, which is what gives each
// holding its real first-investment date and cost basis. Matched to clients by
// PAN like every other feed. See the peeked layout in docs/mf-rta-feeds-plan.md.

import { dbfDate, dbfNumber, type DbfTable } from './dbf.ts';
import { classifyTxn, type RtaTxnStage } from './txns.ts';

const txt = (s: string | undefined): string | null => (s && s.trim() ? s.trim() : null);
const pan = (s: string | undefined): string | null => {
  const m = (s ?? '').toUpperCase().match(/[A-Z]{5}[0-9]{4}[A-Z]/);
  return m ? m[0] : null;
};
const absNum = (s: string | undefined): number | null => {
  const n = dbfNumber(s);
  return n == null ? null : Math.abs(n);
};

// DBF field names are truncated to <=10 chars, so these match the peeked header.
const REQUIRED = ['TRXNTYPE', 'TRADDATE', 'FOLIO_NO', 'PRODCODE'];

export interface Wbr2Parsed {
  snapshotDate: string | null;
  txns: RtaTxnStage[];
}

/** Does this DBF look like a CAMS WBR2 / WBR2A transaction feed? */
export function isWbr2(table: DbfTable): boolean {
  const names = new Set(table.fields.map((f) => f.name));
  return REQUIRED.every((r) => names.has(r));
}

export function parseWbr2(table: DbfTable, registrar = 'CAMS'): Wbr2Parsed {
  if (!isWbr2(table)) {
    throw new Error('This file is not a CAMS WBR2 transaction feed (missing TRXNTYPE/TRADDATE/FOLIO_NO/PRODCODE).');
  }
  const txns: RtaTxnStage[] = [];
  let snapshotDate: string | null = null;

  for (const row of table.rows) {
    const folio = txt(row.FOLIO_NO);
    if (!folio) continue;
    const scheme_code = txt(row.PRODCODE) ?? txt(row.SCHEME_FOL) ?? folio;
    const trade_date = dbfDate(row.TRADDATE);
    const snap = dbfDate(row.REP_DATE);
    if (snap && !snapshotDate) snapshotDate = snap;

    // A stable per-registrar key: the AMC transaction number (unique within a
    // folio/scheme), else a user/trade fallback so a re-import overwrites rather
    // than duplicates.
    const txnNo = txt(row.TRXNNO) ?? txt(row.USRTRXNO) ?? txt(row.SEQ_NO);
    const fallback = `${trade_date ?? ''}-${absNum(row.AMOUNT) ?? ''}-${absNum(row.UNITS) ?? ''}`;
    const txn_ref = `${folio}|${scheme_code}|${txnNo ?? fallback}`;

    const kind = classifyTxn(txt(row.TRXN_TYPE_), txt(row.TRXNTYPE), txt(row.TRXNSUBTYP), txt(row.REINVEST_F));

    txns.push({
      registrar,
      folio,
      scheme_code,
      txn_ref,
      scheme_name: txt(row.SCHEME),
      amc_code: txt(row.AMC_CODE),
      holder_name: txt(row.INV_NAME),
      pan: pan(row.PAN),
      txn_kind: kind,
      txn_type_raw: txt(row.TRXN_TYPE_) ?? txt(row.TRXNTYPE),
      trade_date,
      post_date: dbfDate(row.POSTDATE),
      amount: absNum(row.AMOUNT),
      units: absNum(row.UNITS),
      nav: dbfNumber(row.PURPRICE),
      euin: txt(row.EUIN),
      sub_broker: txt(row.SUBBROK),
      arn: txt(row.BROKCODE),
      snapshot_date: snap,
    });
  }

  return { snapshotDate, txns };
}
