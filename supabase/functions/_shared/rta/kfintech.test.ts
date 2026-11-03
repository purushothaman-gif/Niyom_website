/** KFintech WSREG (SIP registration) CSV mapping + status + date formats. */
import { describe, it, expect } from 'vitest';
import { parseKfSip, isKfSip, kfDate } from './kfintech.ts';
import type { CsvTable } from './csv.ts';

const HEADER = [
  'Zone', 'Branch', 'Location', 'Ihno', 'Folio', 'Investor Name', 'RegistrationDate', 'Start Date',
  'End Date', 'No Of Installments', 'Amount', 'Scheme', 'Plan', 'AgentCode', 'AgentName', 'Subbroker',
  'Scheme Name', 'PAN', 'SipType', 'SIP Mode', 'Fund Code', 'Product Code', 'Frequency', 'Trtype',
  'To Scheme', 'To Plan', 'TerminateDate', 'Status', 'ToProductCode', 'ToSchemeName', 'ECSNO',
  'ECSBankName', 'ECSAcno', 'ECSHolderName', 'RegSlno', 'InvDpId', 'InvClientId', 'DP_InvName',
  'ModifyFlag', 'umrncode',
];

const row = (o: Record<string, string>): Record<string, string> => {
  const r: Record<string, string> = {};
  for (const h of HEADER) r[h] = o[h] ?? '';
  return r;
};

const table = (rows: Record<string, string>[]): CsvTable => ({ header: HEADER, rows });

const base = {
  Folio: '1234567890', 'Investor Name': 'ASHA RAO', RegistrationDate: '20/12/2025',
  'Start Date': '05/01/2026', 'End Date': '05/01/2031', Amount: '5,000.00',
  'Scheme Name': 'Acme Bluechip Fund', PAN: 'ABCPR1234F', SipType: 'SIP', 'SIP Mode': 'NACH',
  'Fund Code': '128', 'Product Code': 'ACB', Frequency: 'MONTHLY', Trtype: 'SIP',
  TerminateDate: '', Status: 'ACTIVE', ECSBankName: 'HDFC BANK', Subbroker: 'ARN-99', RegSlno: '778899',
};

describe('kfDate', () => {
  it('parses the formats KFintech uses', () => {
    expect(kfDate('05/01/2026')).toBe('2026-01-05');
    expect(kfDate('5-JAN-2026')).toBe('2026-01-05');
    expect(kfDate('2026-01-05')).toBe('2026-01-05');
    expect(kfDate('')).toBeNull();
  });
});

describe('parseKfSip', () => {
  it('recognises the report by its columns', () => {
    expect(isKfSip(table([]))).toBe(true);
  });

  it('maps a live SIP, stripping the thousands comma from the amount', () => {
    const s = parseKfSip(table([row(base)]), 'KFINTECH', '2026-11-03')[0];
    expect(s).toMatchObject({
      registrar: 'KFINTECH', folio: '1234567890', scheme_code: 'ACB', amc_code: '128',
      sip_ref: '1234567890|ACB|778899', txn_type: 'SIP', amount: 5000, frequency: 'MONTHLY',
      pan: 'ABCPR1234F', from_date: '2026-01-05', to_date: '2031-01-05', reg_date: '2025-12-20',
      bank: 'HDFC BANK', status: 'active', target_scheme_code: null,
    });
  });

  it('honours the Status string for a terminated mandate', () => {
    const s = parseKfSip(table([row({ ...base, Status: 'CEASED' })]), 'KFINTECH', '2026-11-03')[0];
    expect(s.status).toBe('ceased');
  });

  it('falls back to dates when Status is blank (past end date => ceased)', () => {
    const s = parseKfSip(table([row({ ...base, Status: '', 'End Date': '01/10/2026' })]), 'KFINTECH', '2026-11-03')[0];
    expect(s.status).toBe('ceased');
  });

  it('skips rows with no folio', () => {
    expect(parseKfSip(table([row({ ...base, Folio: '' })]), 'KFINTECH', '2026-11-03')).toHaveLength(0);
  });
});
