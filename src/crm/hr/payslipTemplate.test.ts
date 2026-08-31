import { describe, it, expect } from 'vitest';
import { buildPayslipHtml, financialYearStart, type PayslipData } from './payslipTemplate';
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
  ytd: { BASIC: 66935, HRA: 33468, SPECIAL: 33468, EPF_EE: 8032 },
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
    expect(b).toMatch(/Paid Days/i);
    expect(b).toMatch(/LOP Days/i);
    expect(b).toMatch(/Present Days/i);
    expect(b).toMatch(/Holidays \/ Weekly Off/i);
  });

  /*
   * Shown in full, matching the previous system's payslips. It is the
   * employee's own account on their own payslip, and a masked number is no use
   * when the point is to check the salary reached the right place.
   */
  it('shows the bank account the salary was paid into', () => {
    expect(body()).toContain('10120211772');
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

describe('the year-to-date column', () => {
  it('shows the running total beside each component', () => {
    const b = body();
    expect(b).toMatch(/Year to Date/i);
    for (const v of ['66,935.00', '33,468.00', '8,032.00']) expect(b).toContain(v);
  });

  /*
   * A YTD of 0.00 beside a component that was clearly paid reads as a bug in
   * the payslip. Omitting the column says "not shown", which is honest.
   */
  it('omits the column entirely when the history could not be loaded', () => {
    const b = body(data({ ytd: {} }));
    expect(b).not.toMatch(/Year to Date/i);
    expect(b).toContain('25,000.00');          // the month's own figures survive
  });

  it('leaves the cell blank for a component with no history rather than printing zero', () => {
    const b = body(data({ ytd: { BASIC: 66935 } }));
    expect(b).toMatch(/Year to Date/i);
    expect(b).toContain('66,935.00');
    /*
     * The YTD cell for a component with no history must be EMPTY, not '0.00'.
     * Asserted on the cell itself: a loose search for "0.00" also matches the
     * tail of "12,500.00", which is how the first version of this test passed
     * while proving nothing.
     */
    expect(b).toMatch(/class="amt ytd"><\/td>/);
  });
});

describe('the financial year window', () => {
  /* April to March: a January payslip accumulates from the previous April. */
  it('starts in April of the same year from April onward', () => {
    expect(financialYearStart(2026, 4)).toEqual({ year: 2026, month: 4 });
    expect(financialYearStart(2026, 7)).toEqual({ year: 2026, month: 4 });
    expect(financialYearStart(2026, 12)).toEqual({ year: 2026, month: 4 });
  });

  it('reaches back to the previous April for January to March', () => {
    expect(financialYearStart(2027, 1)).toEqual({ year: 2026, month: 4 });
    expect(financialYearStart(2027, 3)).toEqual({ year: 2026, month: 4 });
  });
});

describe('the header carries what people open the payslip to see', () => {
  it('puts net pay and the paid/LOP days at the top', () => {
    const b = body();
    expect(b).toMatch(/Total Net Pay/i);
    expect(b).toMatch(/Paid Days/i);
    expect(b).toMatch(/LOP Days/i);
  });

  it('names the period and the employee', () => {
    const b = body();
    expect(b).toMatch(/Payslip for the month of July 2026/i);
    expect(b).toContain('Test Employee, TEST-1');
  });

  it('states how net pay was arrived at', () => {
    expect(body()).toMatch(/Gross Earnings\s*(−|-)\s*Total Deductions/i);
  });

  it('says so plainly when a month has no deductions', () => {
    const d = data();
    d.lines = d.lines.filter(l => l.kind !== 'deduction');
    expect(body(d)).toMatch(/No deductions this month/i);
  });
});

/*
 * When an administrator waives the loss of pay, the payslip must read as an
 * ordinary month. The employee is being told "you are paid in full"; a
 * document that also says "you were absent four days" or "LOP: 4" contradicts
 * that and reopens the conversation the waiver was meant to close.
 */
describe('a month whose loss of pay was waived', () => {
  // 31 days: 21 present, 4 absent (all waived), 1 holiday, 5 weekly offs.
  const html = buildPayslipHtml(data({
    record: {
      ...data().record,
      present_days: 21, absent_days: 4, lop_days: 0, payable_days: 31,
      lop_waived_days: 4, holiday_days: 1, weekly_off_days: 5,
    } as PayrollRecord,
  }));

  it('shows no loss of pay', () => {
    expect(html).toContain('LOP Days: <b>0</b>');
  });

  it('pays for the whole month', () => {
    expect(html).toContain('Paid Days: <b>31</b>');
  });

  it('counts the waived days as present, so the figures add up', () => {
    // 21 present + 4 waived = 25; 25 + 1 holiday + 5 weekly offs = 31 paid.
    expect(html).toContain('Present Days</span><span class="v">25</span>');
  });

  it('never mentions the waiver, the absence or who granted it', () => {
    for (const word of ['waive', 'Waive', 'waived', 'absent', 'Absent', 'forgiv']) {
      expect(html).not.toContain(word);
    }
  });

  it('is indistinguishable from a month with no absence at all', () => {
    const clean = buildPayslipHtml(data({
      record: {
        ...data().record,
        present_days: 25, absent_days: 0, lop_days: 0, payable_days: 31,
        lop_waived_days: 0, holiday_days: 1, weekly_off_days: 5,
      } as PayrollRecord,
    }));
    expect(html).toBe(clean);
  });
});

describe('a month with loss of pay that was NOT waived', () => {
  const html = buildPayslipHtml(data({
    record: {
      ...data().record,
      present_days: 21, absent_days: 4, lop_days: 4, payable_days: 27,
      lop_waived_days: 0, holiday_days: 1, weekly_off_days: 5,
    } as PayrollRecord,
  }));

  it('still states the loss of pay plainly', () => {
    expect(html).toContain('LOP Days: <b>4</b>');
    expect(html).toContain('Paid Days: <b>27</b>');
  });

  it('does not inflate present days', () => {
    expect(html).toContain('Present Days</span><span class="v">21</span>');
  });
});

/*
 * Payroll run before the month has finished -- the case that showed up on
 * 31 August. The last day is payable but not yet marked present, so the four
 * day figures fell one short of Paid Days for EVERY employee, waiver or not.
 */
describe('a payslip printed before the month has finished', () => {
  const html = buildPayslipHtml(data({
    record: {
      ...data().record,
      present_days: 24, absent_days: 0, lop_days: 0, payable_days: 31,
      lop_waived_days: 0, paid_leave_days: 0, holiday_days: 1, weekly_off_days: 5,
    } as PayrollRecord,
  }));

  it('closes the gap so the day figures add up to paid days', () => {
    // 24 present + 1 unfinished day = 25; 25 + 1 + 5 = 31 paid.
    expect(html).toContain('Present Days</span><span class="v">25</span>');
    expect(html).toContain('Paid Days: <b>31</b>');
  });
});

describe('the derivation never understates attendance', () => {
  it('keeps the real figure when it is higher than the balance', () => {
    // An excluded employee: nothing payable, but they were present 12 days.
    const html = buildPayslipHtml(data({
      record: {
        ...data().record,
        present_days: 12, lop_days: 0, payable_days: 0, lop_waived_days: 0,
        paid_leave_days: 0, holiday_days: 1, weekly_off_days: 5,
      } as PayrollRecord,
    }));
    expect(html).toContain('Present Days</span><span class="v">12</span>');
  });
});
