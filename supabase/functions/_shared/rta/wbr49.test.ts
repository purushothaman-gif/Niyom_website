/**
 * WBR49 (systematic registration) mapping + status derivation. The parser takes
 * a DbfTable, so these build one directly rather than round-tripping bytes — the
 * DBF byte reader is covered by dbf.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { parseWbr49, isWbr49 } from './wbr49.ts';
import type { DbfTable } from './dbf.ts';

const FIELDS = [
  'PRODUCT', 'SCHEME', 'FOLIO_NO', 'INV_NAME', 'AUT_TRNTYP', 'AUTO_TRNO', 'AUTO_AMOUN',
  'FROM_DATE', 'TO_DATE', 'CEASE_DATE', 'PERIODICIT', 'PERIOD_DAY', 'PAYMENT_MO', 'REG_DATE',
  'PAUSE_FROM', 'PAUSE_TO_D', 'TOP_UP_AMT', 'TOP_UP_FRQ', 'TOP_UP_PER', 'BANK', 'AMC_CODE',
  'PAN', 'EUIN', 'SUB_ARN_CO', 'TARGET_SCH',
].map((name) => ({ name, type: 'C', length: 10, decimals: 0 }));

const table = (rows: Record<string, string>[]): DbfTable => ({ fields: FIELDS, rows, deletedCount: 0 });

const base = {
  PRODUCT: 'B123', SCHEME: 'Acme Bluechip Fund - Growth', FOLIO_NO: '91234567 / 0',
  INV_NAME: 'ASHA RAO', AUT_TRNTYP: 'SIP', AUTO_TRNO: '55501', AUTO_AMOUN: '5000.000000',
  FROM_DATE: '20260105', TO_DATE: '20310105', CEASE_DATE: '', PERIODICIT: 'MONTH',
  PERIOD_DAY: '5', PAYMENT_MO: 'ECS', REG_DATE: '20251220', PAUSE_FROM: '', PAUSE_TO_D: '',
  TOP_UP_AMT: '500.000000', TOP_UP_FRQ: 'YEARLY', TOP_UP_PER: '0.000000', BANK: 'HDFC BANK',
  AMC_CODE: 'B', PAN: 'ABCPR1234F', EUIN: 'E123456', SUB_ARN_CO: 'ARN-99', TARGET_SCH: 'B999',
};

describe('parseWbr49', () => {
  it('recognises the feed by its columns', () => {
    expect(isWbr49(table([]))).toBe(true);
  });

  it('maps a live SIP registration', () => {
    const { sips } = parseWbr49(table([{ ...base }]), 'CAMS', '2026-11-03');
    expect(sips).toHaveLength(1);
    const s = sips[0];
    expect(s).toMatchObject({
      registrar: 'CAMS', folio: '91234567 / 0', scheme_code: 'B123', sip_ref: '55501',
      txn_type: 'SIP', amount: 5000, frequency: 'MONTH', sip_day: '5', pan: 'ABCPR1234F',
      from_date: '2026-01-05', to_date: '2031-01-05', reg_date: '2025-12-20',
      top_up_amount: 500, amc_code: 'B', status: 'active', snapshot_date: '2026-11-03',
    });
  });

  it('derives ceased from a past cease date and from an expired end date', () => {
    const ceased = parseWbr49(table([{ ...base, CEASE_DATE: '20260901' }]), 'CAMS', '2026-11-03').sips[0];
    expect(ceased.status).toBe('ceased');
    const expired = parseWbr49(table([{ ...base, TO_DATE: '20261001', CEASE_DATE: '' }]), 'CAMS', '2026-11-03').sips[0];
    expect(expired.status).toBe('ceased');
  });

  it('derives paused when a pause window straddles the snapshot', () => {
    const paused = parseWbr49(
      table([{ ...base, PAUSE_FROM: '20261001', PAUSE_TO_D: '20261201' }]),
      'CAMS', '2026-11-03',
    ).sips[0];
    expect(paused.status).toBe('paused');
  });

  it('falls back to a composite ref when the registration number is blank or zero', () => {
    const s = parseWbr49(table([{ ...base, AUTO_TRNO: '0' }]), 'CAMS', '2026-11-03').sips[0];
    expect(s.sip_ref).toBe('91234567 / 0|B123|2026-01-05');
  });

  it('extracts a PAN embedded in a wider field', () => {
    const s = parseWbr49(table([{ ...base, PAN: 'ABCPR1234F ABCPR9999Z' }]), 'CAMS', '2026-11-03').sips[0];
    expect(s.pan).toBe('ABCPR1234F');
  });

  it('skips rows with no folio', () => {
    const { sips } = parseWbr49(table([{ ...base, FOLIO_NO: '   ' }]), 'CAMS', '2026-11-03');
    expect(sips).toHaveLength(0);
  });
});
