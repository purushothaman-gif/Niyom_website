// Map a KFintech Transaction Feeds report (WBTRN, report MFSD307) into staging
// transactions. KFintech sends this as a CSV (link-mode, fetched by the Apps
// Script), the transaction equivalent of CAMS's WBR2 DBF. The direction
// classifier and the RtaTxnStage shape are shared with CAMS, so the pipeline
// folds both registrars' transactions into each holding's first investment date
// and net invested cost the same way.

import type { CsvTable } from './csv.ts';
import { kfDate } from './kfintech.ts';
import { classifyTxn, type RtaTxnStage } from './txns.ts';

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

/** Positive magnitude; direction is carried by txn_kind, so sign is dropped. */
const mag = (s: string | undefined): number | null => {
  const n = num(s);
  return n == null ? null : Math.abs(n);
};

// Columns that only the transaction feed carries (not the SIP registration or
// the Client-wise AUM report), so detection can't collide with those.
const REQUIRED = ['Folio Number', 'Transaction Number', 'Transaction Date', 'Transaction Head'];

/** Does this CSV look like a KFintech Transaction Feeds (WBTRN) report? */
export function isWbtrn(table: CsvTable): boolean {
  const names = new Set(table.header);
  return REQUIRED.every((r) => names.has(r));
}

export function parseWbtrn(
  table: CsvTable,
  registrar = 'KFINTECH',
): { snapshotDate: string | null; txns: RtaTxnStage[] } {
  if (!isWbtrn(table)) {
    throw new Error('This file is not a KFintech Transaction Feeds report (missing Folio Number/Transaction Number/Transaction Date/Transaction Head).');
  }
  const txns: RtaTxnStage[] = [];
  let snapshotDate: string | null = null;

  for (const row of table.rows) {
    const folio = txt(row['Folio Number']);
    if (!folio) continue;

    // Mirror the holdings feed (WBCUM) key so a transaction lines up with its
    // holding: Product Code first, then Scheme Code, then the folio.
    const scheme_code = txt(row['Product Code']) ?? txt(row['Scheme Code']) ?? folio;

    const snap = kfDate(row['Report Date']);
    if (snap && !snapshotDate) snapshotDate = snap;

    // Folio + scheme + the registrar's own transaction number is a stable,
    // deterministic key; a re-import of the same transaction overwrites it.
    const serial = txt(row['Transaction Number']) ?? txt(row['Transaction ID']) ?? txt(row.Ihno) ?? '';
    const txn_ref = `${folio}|${scheme_code}|${serial}`;

    const desc = txt(row['Transaction Description']) ?? txt(row['Transaction Head']);
    const kind = classifyTxn(
      desc,
      txt(row['Transaction Type']) ?? txt(row['Transaction Head']),
      txt(row['Transaction Sub']) ?? txt(row.SubTranType),
      txt(row['Dividend Option']),
    );

    txns.push({
      registrar,
      folio,
      scheme_code,
      txn_ref,
      scheme_name: txt(row['Fund Description']) ?? txt(row.Scheme) ?? txt(row.Fund),
      amc_code: txt(row.Fund),
      holder_name: txt(row['Investor Name']),
      pan: pan(row.PAN1) ?? pan(row.PAN2) ?? pan(row.PAN3),
      txn_kind: kind,
      txn_type_raw: desc ?? txt(row['Transaction Type']),
      trade_date: kfDate(row['Transaction Date']),
      post_date: kfDate(row['Process Date']),
      amount: mag(row.Amount),
      units: mag(row.Units),
      nav: num(row.Price) ?? num(row.Nav),
      euin: txt(row.EUIN),
      sub_broker: txt(row['Sub-Broker Code']) ?? txt(row['Sub Broker ARN Code']),
      arn: txt(row['Agent Code']),
      snapshot_date: snap,
    });
  }

  return { snapshotDate, txns };
}
