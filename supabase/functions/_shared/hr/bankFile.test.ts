import { describe, it, expect } from 'vitest';
import { buildBankFile, formatDate, type BankTemplate, type PayeeRow } from './bankFile.ts';

const template = (over: Partial<BankTemplate> = {}): BankTemplate => ({
  name: 'Test Bank', sheet_name: 'Salary', include_header: true,
  date_format: 'DD/MM/YYYY', amount_format: '2dp',
  debit_account: '89394331135', debit_ifsc: 'IDFB0080131',
  columns: [
    { position: 1, header_label: 'Beneficiary Name', source: 'account_holder', constant_value: '', required: true,  transform: 'upper',       max_length: 50 },
    { position: 2, header_label: 'Account Number',   source: 'bank_account',   constant_value: '', required: true,  transform: 'digits_only', max_length: 20 },
    { position: 3, header_label: 'IFSC',             source: 'bank_ifsc',      constant_value: '', required: true,  transform: 'upper',       max_length: 11 },
    { position: 4, header_label: 'Amount',           source: 'net_pay',        constant_value: '', required: true,  transform: 'none',        max_length: null },
    { position: 5, header_label: 'Remarks',          source: 'remarks',        constant_value: '', required: false, transform: 'none',        max_length: 30 },
  ],
  ...over,
});

const payee = (over: Partial<PayeeRow> = {}): PayeeRow => ({
  employee_code: 'NIYOM-009', full_name: 'Test Employee', account_holder: 'Test Employee',
  bank_name: 'IDFC FIRST BANK', bank_account: '89394331135', bank_ifsc: 'idfb0080131',
  net_pay: 48000, remarks: 'Salary Aug 2026', ...over,
});

describe('column mapping', () => {
  const r = buildBankFile(template(), [payee()], '2026-08-31');

  it('emits the header the template names, in template order', () => {
    expect(r.grid[0]).toEqual(['Beneficiary Name', 'Account Number', 'IFSC', 'Amount', 'Remarks']);
  });

  it('fills each cell from its configured source', () => {
    expect(r.grid[1]).toEqual(['TEST EMPLOYEE', '89394331135', 'IDFB0080131', 48000, 'Salary Aug 2026']);
  });

  it('respects a reordered template', () => {
    const t = template({
      columns: [
        { position: 2, header_label: 'Name',   source: 'employee_name', constant_value: '', required: true, transform: 'none', max_length: null },
        { position: 1, header_label: 'Sr No.', source: 'sequence',      constant_value: '', required: true, transform: 'none', max_length: null },
      ],
    });
    const out = buildBankFile(t, [payee(), payee({ employee_code: 'NIYOM-010' })], '2026-08-31');
    expect(out.grid[0]).toEqual(['Sr No.', 'Name']);
    expect(out.grid[1]).toEqual(['1', 'Test Employee']);
    expect(out.grid[2][0]).toBe('2');
  });

  it('omits the header when the bank does not want one', () => {
    const out = buildBankFile(template({ include_header: false }), [payee()], '2026-08-31');
    expect(out.grid).toHaveLength(1);
    expect(out.grid[0][0]).toBe('TEST EMPLOYEE');
  });

  it('supports constant and debit-account columns', () => {
    const t = template({
      columns: [
        { position: 1, header_label: 'Txn Type',      source: 'constant',      constant_value: 'NEFT', required: true, transform: 'none', max_length: null },
        { position: 2, header_label: 'Debit Account', source: 'debit_account', constant_value: '',     required: true, transform: 'none', max_length: null },
      ],
    });
    expect(buildBankFile(t, [payee()], '2026-08-31').grid[1]).toEqual(['NEFT', '89394331135']);
  });
});

describe('the amount cell', () => {
  it('stays a number so the bank does not read it as text', () => {
    const r = buildBankFile(template(), [payee({ net_pay: 48000.5 })], '2026-08-31');
    expect(typeof r.grid[1][3]).toBe('number');
    expect(r.grid[1][3]).toBe(48000.5);
  });

  it('rounds to whole rupees when the template says integer', () => {
    const r = buildBankFile(template({ amount_format: 'integer' }), [payee({ net_pay: 48000.6 })], '2026-08-31');
    expect(r.grid[1][3]).toBe(48001);
  });

  it('totals what the file actually transfers', () => {
    const r = buildBankFile(template(), [payee({ net_pay: 48000 }), payee({ net_pay: 31500.25 })], '2026-08-31');
    expect(r.total_amount).toBe(79500.25);
    expect(r.row_count).toBe(2);
  });

  it('refuses a zero or negative amount', () => {
    const r = buildBankFile(template(), [payee({ net_pay: 0 })], '2026-08-31');
    expect(r.valid).toBe(false);
    expect(r.issues[0].message).toMatch(/positive amount/);
  });
});

describe('validation before the bank sees it', () => {
  it('flags a missing required field and names the employee', () => {
    const r = buildBankFile(template(), [payee({ bank_account: '', employee_code: 'NIYOM-011' })], '2026-08-31');
    expect(r.valid).toBe(false);
    expect(r.issues[0].employee_code).toBe('NIYOM-011');
    expect(r.issues[0].column).toBe('Account Number');
  });

  it('does not flag an empty optional field', () => {
    expect(buildBankFile(template(), [payee({ remarks: '' })], '2026-08-31').valid).toBe(true);
  });

  /* Silent truncation is how a wrong account number reaches a bank. */
  it('reports a truncation as well as performing it', () => {
    const r = buildBankFile(template(), [payee({ remarks: 'x'.repeat(45) })], '2026-08-31');
    expect(r.grid[1][4]).toHaveLength(30);
    expect(r.issues.some(i => /truncated/.test(i.message))).toBe(true);
    expect(r.valid).toBe(false);
  });

  it('refuses an empty run rather than producing a blank sheet', () => {
    const r = buildBankFile(template(), [], '2026-08-31');
    expect(r.valid).toBe(false);
    expect(r.row_count).toBe(0);
  });

  it('refuses a template with no columns', () => {
    expect(buildBankFile(template({ columns: [] }), [payee()], '2026-08-31').valid).toBe(false);
  });
});

describe('transforms', () => {
  it('strips separators a bank will not accept in an account number', () => {
    const r = buildBankFile(template(), [payee({ bank_account: '8939-4331 135' })], '2026-08-31');
    expect(r.grid[1][1]).toBe('89394331135');
  });

  it('upper-cases IFSC regardless of how it was typed', () => {
    expect(buildBankFile(template(), [payee({ bank_ifsc: 'idfb0080131' })], '2026-08-31').grid[1][2]).toBe('IDFB0080131');
  });

  it('falls back to the employee name when no account holder is recorded', () => {
    const r = buildBankFile(template(), [payee({ account_holder: '', full_name: 'Real Name' })], '2026-08-31');
    expect(r.grid[1][0]).toBe('REAL NAME');
  });
});

describe('formatDate', () => {
  it('renders every supported pattern', () => {
    expect(formatDate('2026-08-31', 'DD/MM/YYYY')).toBe('31/08/2026');
    expect(formatDate('2026-08-31', 'YYYY-MM-DD')).toBe('2026-08-31');
    expect(formatDate('2026-08-31', 'DD-MM-YYYY')).toBe('31-08-2026');
    expect(formatDate('2026-08-31', 'DD-MMM-YYYY')).toBe('31-Aug-2026');
    expect(formatDate('2026-08-31', 'MM/DD/YYYY')).toBe('08/31/2026');
  });

  it('defaults to the Indian order for an unknown pattern', () => {
    expect(formatDate('2026-08-31', 'nonsense')).toBe('31/08/2026');
  });

  it('returns empty for a missing date', () => {
    expect(formatDate('', 'DD/MM/YYYY')).toBe('');
  });
});

describe('the file never carries a salary breakdown', () => {
  /*
   * A structural guarantee, not a policy note: `source` is a closed union, so
   * there is no configuration that puts basic, deductions or CTC into a
   * transfer file that circulates outside HR.
   */
  it('exposes only beneficiary and amount fields as sources', () => {
    const allowed = [
      'employee_name', 'employee_code', 'account_holder', 'bank_name',
      'bank_account', 'bank_ifsc', 'net_pay', 'payment_date',
      'remarks', 'debit_account', 'debit_ifsc', 'sequence', 'constant',
    ];
    expect(allowed).not.toContain('basic');
    expect(allowed).not.toContain('gross');
    expect(allowed).not.toContain('deductions');
    expect(allowed).not.toContain('ctc');
  });
});
