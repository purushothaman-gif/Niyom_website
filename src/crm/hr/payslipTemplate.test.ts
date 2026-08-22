import { describe, it, expect } from 'vitest';
import { buildPayslipHtml, type PayslipData } from './payslipTemplate';
import type { HRSettings, PayrollLineRow, PayrollRecord, Payslip } from './hrTypes';

/*
 * The payslip is the one artefact of this whole module that an employee
 * actually receives, so what it says is worth asserting rather than eyeballing.
 * Amounts here are synthetic.
 */

const line = (code: string, name: string, kind: PayrollLineRow['kind'], amount: number, over: Partial<PayrollLineRow> = {}) => ({
  id: code, record_id: 'r', component_id: code, component_code: code, component_name: name,
  kind, base_amount: amount, amount, prorated: false, taxable: true, show_on_payslip: true,
  adjustment_id: null, sort_order: 0, created_at: '', ...over,
} as PayrollLineRow);

const data = (over: Partial<PayslipData> = {}): PayslipData => ({
  payslip: {
    payslip_number: 'NIYOM/PAY/2026/07/TEST-1', period_year: 2026, period_month: 7,
    net_pay: 47000, published: true,
  } as Payslip,
  record: {
    full_name: 'Test Employee', employee_code: 'TEST-1', designation: 'Relationship Manager',
    department: 'Sales', joining_date: '2026-05-04', pan: 'ABCDE1234F', uan: null,
    bank_name: 'IDFC FIRST BANK', bank_account: '10120211772', bank_ifsc: 'IDFB0080131',
    calendar_days: 31, working_days: 25, present_days: 25, paid_leave_days: 0,
    unpaid_leave_days: 0, holiday_days: 1, weekly_off_days: 5, absent_days: 0,
    lop_days: 0, payable_days: 31, gross_earnings: 50000, total_deductions: 3000,
    employer_contrib: 0, net_pay: 47000,
  } as PayrollRecord,
  lines: [
    line('BASIC', 'Basic', 'earning', 25000),
    line('HRA', 'House Rent Allowance', 'earning', 12500),
    line('SPECIAL', 'Fixed Allowance', 'earning', 12500),
    line('EPF_EE', 'Provident Fund', 'deduction', 3000),
  ],
  settings: {
    company_name: 'NIYOM WEALTH DISTRIBUTION LLP',
    company_address: 'Chennai',
    company_logo_url: '/niyomlogo.png',
    payslip_footer_note: 'This is a computer-generated payslip and does not require a signature.',
  } as HRSettings,
  ...over,
});

/** Everything except the stylesheet, so assertions read the document not the CSS. */
const body = (d = data()) => buildPayslipHtml(d).replace(/<style>[\s\S]*?<\/style>/, '');

describe('the payslip carries no signature', () => {
  it('has no signatory block, line or image', () => {
    const b = body();
    expect(b).not.toMatch(/signator/i);
    expect(b).not.toMatch(/Authorised Signatory/i);
    expect(b).not.toMatch(/<img[^>]*sign/i);
  });

  it('says instead that the document is generated', () => {
    expect(body()).toMatch(/computer-generated payslip and does not require a signature/i);
  });

  it('still identifies the issuer and the document', () => {
    const b = body();
    expect(b).toContain('NIYOM WEALTH DISTRIBUTION LLP');
    expect(b).toContain('NIYOM/PAY/2026/07/TEST-1');
  });
});

describe('the figures an employee checks first', () => {
  it('shows net pay as a number and in words', () => {
    const b = body();
    expect(b).toContain('47,000.00');
    /*
     * Unhyphenated, which is what the shared amountInWords produces. The
     * previous payroll system hyphenated ("Forty-Seven"); that formatter also
     * renders the DSA debit notes partners sign, so it is not being changed to
     * match a payslip's house style.
     */
    expect(b).toMatch(/Rupees Forty Seven Thousand Only/i);
  });

  it('lists every earning and deduction with its amount', () => {
    const b = body();
    for (const [name, amt] of [['Basic', '25,000.00'], ['House Rent Allowance', '12,500.00'],
                               ['Fixed Allowance', '12,500.00'], ['Provident Fund', '3,000.00']]) {
      expect(b).toContain(name);
      expect(b).toContain(amt);
    }
  });

  it('totals gross and deductions', () => {
    const b = body();
    expect(b).toContain('50,000.00');
    expect(b).toContain('3,000.00');
  });

  it('shows the attendance the pay was based on', () => {
    const b = body();
    expect(b).toMatch(/Payable Days/i);
    expect(b).toMatch(/LOP/i);
  });

  it('masks the bank account to the last four digits', () => {
    const b = body();
    expect(b).toContain('1772');
    expect(b).not.toContain('10120211772');
  });
});

describe('robustness', () => {
  it('renders with no settings row at all', () => {
    const b = body(data({ settings: null }));
    expect(b).toContain('NIYOM WEALTH DISTRIBUTION LLP');   // falls back to the default
    expect(b).toContain('47,000.00');
  });

  it('omits the employer-contribution block when there is none', () => {
    expect(body()).not.toMatch(/Employer Contributions/i);
  });

  it('shows the employer block when there is one', () => {
    const d = data();
    d.lines = [...d.lines, line('EPF_ER', 'Provident Fund (Employer)', 'employer_contribution', 3000)];
    expect(body(d)).toMatch(/Employer Contributions/i);
  });

  it('leaves a component off the slip when it is marked not to show', () => {
    const d = data();
    d.lines = [...d.lines, line('SECRET', 'Should Not Appear', 'deduction', 1, { show_on_payslip: false })];
    expect(body(d)).not.toContain('Should Not Appear');
  });

  it('escapes a name that contains markup rather than emitting it', () => {
    const d = data();
    (d.record as { full_name: string }).full_name = '<script>alert(1)</script>';
    const b = body(d);
    expect(b).not.toContain('<script>');
    expect(b).toContain('&lt;script&gt;');
  });
});
