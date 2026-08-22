import { describe, it, expect } from 'vitest';
import { calculatePayroll, lopDivisor, payableRatio, round2, slabAmount, summariseRun } from './payrollEngine.ts';
import type {
  AttendanceSummary, PayrollInput, SalaryComponent, SalaryStructure, EmployeeForPayroll,
} from './types.ts';

// ---------------------------------------------------------------------------
// Fixtures. A conventional Indian structure on a 50,000 monthly gross:
//   Basic 20,000 | HRA 50% of basic | Conveyance 1,600 | Special = balance
//   PF 12% of basic capped at a 15,000 wage base | PT 200 flat
//   Employer PF 12% of basic capped the same way
// Every rate here is test data, not a rule the engine knows.
// ---------------------------------------------------------------------------

const comp = (over: Partial<SalaryComponent> & Pick<SalaryComponent, 'id' | 'code' | 'name' | 'kind'>): SalaryComponent => ({
  calc_type: 'fixed', percent_of: null, percent_of_component_id: null, default_percent: null,
  cap_base: null, cap_amount: null, floor_amount: null, eligibility_max_gross: null,
  prorate_on_lop: true, taxable: true, include_in_gross: true, include_in_ctc: true,
  show_on_payslip: true, is_recurring: true, sort_order: 0, ...over,
});

const BASIC   = comp({ id: 'c-basic', code: 'BASIC', name: 'Basic', kind: 'earning', sort_order: 10 });
const HRA     = comp({ id: 'c-hra', code: 'HRA', name: 'HRA', kind: 'earning', calc_type: 'percent_of', percent_of: 'basic', sort_order: 20 });
const CONV    = comp({ id: 'c-conv', code: 'CONV', name: 'Conveyance', kind: 'earning', sort_order: 30 });
const SPECIAL = comp({ id: 'c-spec', code: 'SPECIAL', name: 'Special Allowance', kind: 'earning', calc_type: 'balance', sort_order: 90 });
const PF_EE   = comp({ id: 'c-pfee', code: 'EPF_EE', name: 'PF (Employee)', kind: 'deduction', calc_type: 'percent_of', percent_of: 'basic', cap_base: 15000, sort_order: 10 });
const PT      = comp({ id: 'c-pt', code: 'PT', name: 'Professional Tax', kind: 'deduction', prorate_on_lop: false, sort_order: 30 });
const PF_ER   = comp({ id: 'c-pfer', code: 'EPF_ER', name: 'PF (Employer)', kind: 'employer_contribution', calc_type: 'percent_of', percent_of: 'basic', cap_base: 15000, include_in_gross: false, sort_order: 10 });
const ESI_EE  = comp({ id: 'c-esiee', code: 'ESI_EE', name: 'ESI (Employee)', kind: 'deduction', calc_type: 'percent_of', percent_of: 'gross', eligibility_max_gross: 21000, sort_order: 20 });

const COMPONENTS = [BASIC, HRA, CONV, SPECIAL, PF_EE, PT, PF_ER, ESI_EE];

const STRUCTURE: SalaryStructure = {
  id: 's-1', employee_id: 'e-1', effective_from: '2026-01-01', effective_to: null,
  ctc_annual: 660000, gross_monthly: 50000,
  lines: [
    { component_id: 'c-basic', calc_type: 'fixed',      amount_monthly: 20000, percent_value: null,  sort_order: 10 },
    { component_id: 'c-hra',   calc_type: 'percent_of', amount_monthly: 0,     percent_value: 50,    sort_order: 20 },
    { component_id: 'c-conv',  calc_type: 'fixed',      amount_monthly: 1600,  percent_value: null,  sort_order: 30 },
    { component_id: 'c-spec',  calc_type: 'balance',    amount_monthly: 0,     percent_value: null,  sort_order: 90 },
    { component_id: 'c-pfee',  calc_type: 'percent_of', amount_monthly: 0,     percent_value: 12,    sort_order: 10 },
    { component_id: 'c-pt',    calc_type: 'fixed',      amount_monthly: 200,   percent_value: null,  sort_order: 30 },
    { component_id: 'c-pfer',  calc_type: 'percent_of', amount_monthly: 0,     percent_value: 12,    sort_order: 10 },
  ],
};

const EMPLOYEE: EmployeeForPayroll = {
  employee_id: 'e-1', employee_code: 'NIYOM-009', full_name: 'Test Employee',
  designation: 'Relationship Manager', department: 'Sales',
  joining_date: '2024-04-01', exit_date: null, pan: 'ABCDE1234F', uan: null,
  bank_name: 'IDFC FIRST BANK', bank_account: '89394331135', bank_ifsc: 'IDFB0080131',
  account_holder: 'TEST EMPLOYEE',
};

const att = (over: Partial<AttendanceSummary> = {}): AttendanceSummary => ({
  calendar_days: 31, working_days: 26, present_days: 26,
  paid_leave_days: 0, unpaid_leave_days: 0, holiday_days: 1, weekly_off_days: 4,
  absent_days: 0, lop_days: 0, payable_days: 31,
  late_days: 0, early_out_days: 0, overtime_minutes: 0, pending_punch_days: 0, ...over,
});

const run = (over: Partial<PayrollInput> = {}) => calculatePayroll({
  employee: EMPLOYEE, structure: STRUCTURE, components: COMPONENTS,
  attendance: att(), adjustments: [],
  period: { year: 2026, month: 8, start_date: '2026-08-01', end_date: '2026-08-31' },
  rules: { lop_divisor_mode: 'calendar_days', round_net_to_rupee: true },
  ...over,
});

const line = (r: ReturnType<typeof run>, code: string) => r.lines.find(l => l.component_code === code);

// ---------------------------------------------------------------------------

describe('a normal full month', () => {
  const r = run();

  it('values a percentage component off basic', () => {
    expect(line(r, 'HRA')!.amount).toBe(10000);   // 50% of 20,000
  });

  it('lets the balancing component absorb the remainder of gross', () => {
    // 50,000 - (20,000 basic + 10,000 HRA + 1,600 conveyance)
    expect(line(r, 'SPECIAL')!.amount).toBe(18400);
  });

  it('totals gross to the structure figure', () => {
    expect(r.gross_earnings).toBe(50000);
  });

  it('caps a percentage at its wage ceiling rather than the full base', () => {
    // 12% of min(20,000, 15,000) = 1,800 -- NOT 2,400
    expect(line(r, 'EPF_EE')!.amount).toBe(1800);
  });

  it('applies a flat deduction unchanged', () => {
    expect(line(r, 'PT')!.amount).toBe(200);
  });

  it('computes net as gross minus deductions', () => {
    expect(r.total_deductions).toBe(2000);        // 1,800 + 200
    expect(r.net_pay).toBe(48000);
  });

  it('keeps employer contributions out of net pay but present as a cost', () => {
    expect(line(r, 'EPF_ER')!.amount).toBe(1800);
    expect(r.employer_contrib).toBe(1800);
    expect(r.net_pay).toBe(r.gross_earnings - r.total_deductions);
  });

  it('is payable and raises no blocker', () => {
    expect(r.payable).toBe(true);
    expect(r.exceptions.filter(e => e.severity === 'blocker')).toHaveLength(0);
  });
});

describe('eligibility ceilings', () => {
  it('switches a component off above its gross ceiling', () => {
    // Gross is 50,000, ESI's ceiling is 21,000 -- so no ESI line at all.
    expect(line(run(), 'ESI_EE')).toBeUndefined();
  });

  it('applies it below the ceiling', () => {
    const small: SalaryStructure = {
      ...STRUCTURE, ctc_annual: 240000, gross_monthly: 18000,
      lines: [
        { component_id: 'c-basic', calc_type: 'fixed',      amount_monthly: 9000, percent_value: null, sort_order: 10 },
        { component_id: 'c-spec',  calc_type: 'balance',    amount_monthly: 0,    percent_value: null, sort_order: 90 },
        { component_id: 'c-esiee', calc_type: 'percent_of', amount_monthly: 0,    percent_value: 0.75, sort_order: 20 },
      ],
    };
    const r = run({ structure: small });
    expect(r.gross_earnings).toBe(18000);
    expect(line(r, 'ESI_EE')!.amount).toBe(135);   // 0.75% of 18,000
  });
});

describe('loss of pay', () => {
  it('reduces earnings by a calendar-day rate', () => {
    const r = run({ attendance: att({ lop_days: 2, payable_days: 29 }) });
    // 50,000 / 31 * 29 across components, each rounded to paise
    expect(r.gross_earnings).toBeCloseTo(46774.19, 1);
    expect(r.lop_amount).toBeGreaterThan(3200);
    expect(r.lop_days).toBe(2);
  });

  it('gives a bigger day rate under working_days than calendar_days', () => {
    const a = att({ lop_days: 1, payable_days: 30 });
    const cal = run({ attendance: a, rules: { lop_divisor_mode: 'calendar_days', round_net_to_rupee: true } });
    const wrk = run({ attendance: a, rules: { lop_divisor_mode: 'working_days', round_net_to_rupee: true } });
    expect(wrk.gross_earnings).toBeLessThan(cal.gross_earnings);   // /26 costs more than /31
  });

  it('uses a flat 30-day divisor when configured', () => {
    const r = run({
      attendance: att({ lop_days: 3, payable_days: 28 }),
      rules: { lop_divisor_mode: 'fixed_30', round_net_to_rupee: true },
    });
    expect(r.lop_divisor).toBe(30);
    expect(r.gross_earnings).toBeCloseTo(45000, 0);   // 50,000 * 27/30
  });

  it('pays strictly for days earned under payable_days', () => {
    const r = run({
      attendance: att({ working_days: 26, payable_days: 13, lop_days: 13 }),
      rules: { lop_divisor_mode: 'payable_days', round_net_to_rupee: true },
    });
    expect(r.gross_earnings).toBeCloseTo(25000, 0);   // half of 50,000
  });

  it('scales a percentage deduction with the pro-rated basic', () => {
    const r = run({
      attendance: att({ lop_days: 15.5, payable_days: 15.5 }),
      rules: { lop_divisor_mode: 'calendar_days', round_net_to_rupee: true },
    });
    // Basic halves to 10,000, which is under the 15,000 ceiling, so PF is 12%
    // of the pro-rated basic rather than of the ceiling.
    expect(line(r, 'EPF_EE')!.amount).toBeCloseTo(1200, 0);
  });

  it('does not scale a flat deduction that opts out of proration', () => {
    const r = run({ attendance: att({ lop_days: 15, payable_days: 16 }) });
    expect(line(r, 'PT')!.amount).toBe(200);
  });

  it('blocks the run when the whole month is loss of pay', () => {
    const r = run({ attendance: att({ lop_days: 31, payable_days: 0 }) });
    expect(r.payable).toBe(false);
    expect(r.exceptions.map(e => e.code)).toContain('full_month_lop');
  });

  it('never pays more than a full month however the numbers arrive', () => {
    const r = run({ attendance: att({ lop_days: -5, payable_days: 40 }) });
    expect(r.gross_earnings).toBeLessThanOrEqual(50000);
  });
});

describe('paid leave', () => {
  it('costs nothing: paid leave is not loss of pay', () => {
    const withLeave = run({ attendance: att({ present_days: 24, paid_leave_days: 2, lop_days: 0 }) });
    expect(withLeave.gross_earnings).toBe(50000);
    expect(withLeave.net_pay).toBe(48000);
  });

  it('unpaid leave arrives as LOP days and does reduce pay', () => {
    const r = run({ attendance: att({ unpaid_leave_days: 2, lop_days: 2, payable_days: 29 }) });
    expect(r.gross_earnings).toBeLessThan(50000);
  });
});

describe('adjustments', () => {
  const bonus = {
    id: 'a-1', component_id: null, label: 'Diwali Bonus', kind: 'earning' as const,
    amount: 25000, prorate_on_lop: false, taxable: true,
  };

  it('adds a one-off earning without pro-rating it', () => {
    const r = run({ attendance: att({ lop_days: 5, payable_days: 26 }), adjustments: [bonus] });
    expect(line(r, 'ADJ')!.amount).toBe(25000);
    expect(r.gross_earnings).toBeGreaterThan(25000);
  });

  it('subtracts a one-off deduction from net', () => {
    const loan = { ...bonus, id: 'a-2', label: 'Loan Recovery', kind: 'deduction' as const, amount: 5000 };
    const base = run();
    const r = run({ adjustments: [loan] });
    expect(r.total_deductions).toBe(base.total_deductions + 5000);
    expect(r.net_pay).toBe(base.net_pay - 5000);
  });

  it('pro-rates an adjustment when it is told to', () => {
    const r = run({
      attendance: att({ lop_days: 15.5, payable_days: 15.5 }),
      adjustments: [{ ...bonus, prorate_on_lop: true, amount: 10000 }],
    });
    expect(line(r, 'ADJ')!.amount).toBeCloseTo(5000, 0);
  });
});

describe('salary revisions', () => {
  /*
   * The engine is handed the structure that applies to the period. This is what
   * keeps an August run on the August structure after a September revision --
   * the caller resolves it, the engine never reaches for "current".
   */
  it('uses whichever structure it is given, not the newest one', () => {
    const revised: SalaryStructure = {
      ...STRUCTURE, id: 's-2', effective_from: '2026-09-01',
      ctc_annual: 792000, gross_monthly: 60000,
      lines: STRUCTURE.lines.map(l =>
        l.component_id === 'c-basic' ? { ...l, amount_monthly: 24000 } : l),
    };
    expect(run().gross_earnings).toBe(50000);
    expect(run({ structure: revised }).gross_earnings).toBe(60000);
    expect(run({ structure: revised }).structure_id).toBe('s-2');
  });
});

describe('joiners and leavers', () => {
  it('flags a mid-month joiner', () => {
    const r = run({
      employee: { ...EMPLOYEE, joining_date: '2026-08-12' },
      attendance: att({ lop_days: 11, payable_days: 20 }),
    });
    expect(r.exceptions.map(e => e.code)).toContain('joined_mid_month');
    expect(r.gross_earnings).toBeLessThan(50000);
  });

  it('flags a mid-month leaver', () => {
    const r = run({
      employee: { ...EMPLOYEE, exit_date: '2026-08-20' },
      attendance: att({ lop_days: 11, payable_days: 20 }),
    });
    expect(r.exceptions.map(e => e.code)).toContain('exited_mid_month');
  });
});

describe('refusals a reviewer must see', () => {
  it('refuses an employee with no structure instead of paying zero', () => {
    const r = run({ structure: null });
    expect(r.payable).toBe(false);
    expect(r.net_pay).toBe(0);
    expect(r.exceptions[0].code).toBe('no_salary_structure');
  });

  it('blocks an employee with no bank details', () => {
    const r = run({ employee: { ...EMPLOYEE, bank_account: '', bank_ifsc: '' } });
    expect(r.payable).toBe(false);
    expect(r.exceptions.map(e => e.code)).toContain('missing_bank_details');
  });

  it('blocks a month with attendance still awaiting approval', () => {
    const r = run({ attendance: att({ pending_punch_days: 2 }) });
    expect(r.payable).toBe(false);
    expect(r.exceptions.map(e => e.code)).toContain('unapproved_attendance');
  });

  it('blocks a negative net rather than emitting it', () => {
    const heavy: SalaryStructure = {
      ...STRUCTURE,
      lines: [...STRUCTURE.lines, { component_id: 'c-pt', calc_type: 'fixed', amount_monthly: 999999, percent_value: null, sort_order: 30 }],
    };
    // the duplicate PT line replaces nothing; use an adjustment instead
    const r = run({ structure: heavy, adjustments: [
      { id: 'a-9', component_id: null, label: 'Huge recovery', kind: 'deduction', amount: 999999, prorate_on_lop: false, taxable: false },
    ] });
    expect(r.payable).toBe(false);
    expect(r.exceptions.map(e => e.code)).toContain('negative_net');
  });

  it('warns when components do not add up to the recorded gross', () => {
    /*
     * Only reachable WITHOUT a balancing component: SPECIAL absorbs the
     * remainder by definition, so a structure that has one can never disagree
     * with its own gross. This is the case where someone typed a gross figure
     * and then listed fixed components that do not reach it.
     */
    const noBalance: SalaryStructure = {
      ...STRUCTURE, gross_monthly: 55000,
      lines: STRUCTURE.lines.filter(l => l.component_id !== 'c-spec'),
    };
    const r = run({ structure: noBalance });
    expect(r.gross_earnings).toBe(31600);   // 20,000 + 10,000 + 1,600
    expect(r.exceptions.map(e => e.code)).toContain('gross_mismatch');
    // A warning, not a blocker: payroll uses the components it can actually see.
    expect(r.exceptions.find(e => e.code === 'gross_mismatch')!.severity).toBe('warning');
  });

  it('refuses a structure with two balancing components', () => {
    const twoBalances: SalaryStructure = {
      ...STRUCTURE,
      lines: [...STRUCTURE.lines, { component_id: 'c-conv2', calc_type: 'balance', amount_monthly: 0, percent_value: null, sort_order: 91 }],
    };
    const extra = comp({ id: 'c-conv2', code: 'SPECIAL2', name: 'Second Balance', kind: 'earning', calc_type: 'balance', sort_order: 91 });
    const r = run({ structure: twoBalances, components: [...COMPONENTS, extra] });
    expect(r.payable).toBe(false);
  });
});

describe('rounding', () => {
  it('rounds net to the rupee when the schedule says so', () => {
    const r = run({ attendance: att({ lop_days: 1, payable_days: 30 }) });
    expect(Number.isInteger(r.net_pay)).toBe(true);
  });

  it('leaves paise on net when the schedule does not', () => {
    const r = run({
      attendance: att({ lop_days: 1, payable_days: 30 }),
      rules: { lop_divisor_mode: 'calendar_days', round_net_to_rupee: false },
    });
    expect(r.net_pay).toBe(round2(r.gross_earnings - r.total_deductions));
  });

  it('keeps net within a rupee of gross minus deductions in every case', () => {
    for (const lop of [0, 0.5, 1, 7, 15.5, 30]) {
      const r = run({ attendance: att({ lop_days: lop, payable_days: 31 - lop }) });
      expect(Math.abs((r.gross_earnings - r.total_deductions) - r.net_pay)).toBeLessThanOrEqual(1);
    }
  });
});

describe('helpers', () => {
  it('picks the right divisor per mode', () => {
    const a = att({ calendar_days: 28, working_days: 24 });
    expect(lopDivisor('calendar_days', a)).toBe(28);
    expect(lopDivisor('working_days', a)).toBe(24);
    expect(lopDivisor('fixed_30', a)).toBe(30);
  });

  it('never divides by zero when a month has no recorded days', () => {
    const empty = att({ calendar_days: 0, working_days: 0, payable_days: 0 });
    expect(lopDivisor('calendar_days', empty)).toBe(30);
    expect(payableRatio('calendar_days', empty)).toBeGreaterThanOrEqual(0);
  });

  it('looks up a slab inclusive of its floor and exclusive of its ceiling', () => {
    const c = comp({
      id: 'c-slab', code: 'PT', name: 'PT', kind: 'deduction', calc_type: 'slab',
      slabs: [
        { from_amount: 0, to_amount: 21000, amount: 0 },
        { from_amount: 21000, to_amount: 30000, amount: 135 },
        { from_amount: 30000, to_amount: null, amount: 208 },
      ],
    });
    expect(slabAmount(c, 20999)).toBe(0);
    expect(slabAmount(c, 21000)).toBe(135);
    expect(slabAmount(c, 29999.99)).toBe(135);
    expect(slabAmount(c, 30000)).toBe(208);
    expect(slabAmount(c, 1000000)).toBe(208);
  });
});

describe('summariseRun', () => {
  it('totals only the employees that can actually be paid', () => {
    const ok = run();
    const blocked = run({ structure: null });
    const s = summariseRun([ok, ok, blocked]);
    expect(s.employee_count).toBe(2);
    expect(s.excluded_count).toBe(1);
    expect(s.total_net).toBe(round2(ok.net_pay * 2));
  });
});
