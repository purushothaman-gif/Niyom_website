import { describe, it, expect } from 'vitest';
import { calculatePayroll, payableRatio } from './payrollEngine.ts';
import { summariseAttendance, type DailyRow } from './attendanceSummary.ts';
import type { PayrollInput, SalaryComponent, SalaryStructure } from './types.ts';

/*
 * These tests run attendanceSummary and payrollEngine TOGETHER.
 *
 * Both modules had thorough tests of their own and both were correct in
 * isolation, yet a mid-month joiner was paid a full month: summariseAttendance
 * reports a joiner's pre-employment days as NOT loss of pay -- rightly, they
 * were not absent -- and the engine only looked at lop_days, so it saw nothing
 * to deduct. The unit tests never caught it because the engine's joiner test
 * handed it `lop_days` directly instead of letting the summariser produce it.
 *
 * The lesson is the reason this file exists: a seam between two well-tested
 * modules is exactly where the untested behaviour hides. Anything here must go
 * through BOTH, never a hand-written AttendanceSummary.
 *
 * Amounts are synthetic. Real salaries are not committed to the repository.
 */

const comp = (o: Partial<SalaryComponent> & Pick<SalaryComponent, 'id' | 'code' | 'name' | 'kind'>): SalaryComponent => ({
  calc_type: 'fixed', percent_of: null, percent_of_component_id: null, default_percent: null,
  cap_base: null, cap_amount: null, floor_amount: null, eligibility_max_gross: null,
  prorate_on_lop: true, taxable: true, include_in_gross: true, include_in_ctc: true,
  show_on_payslip: true, is_recurring: true, sort_order: 0, ...o,
});

// Basic 50% of gross, HRA 50% of basic, the rest a balancing allowance, PF 12%
// of basic uncapped -- the common Indian shape.
const BASIC = comp({ id: 'b', code: 'BASIC', name: 'Basic', kind: 'earning', sort_order: 10 });
const HRA   = comp({ id: 'h', code: 'HRA', name: 'HRA', kind: 'earning', calc_type: 'percent_of', percent_of: 'basic', sort_order: 20 });
const FIXED = comp({ id: 'f', code: 'SPECIAL', name: 'Fixed Allowance', kind: 'earning', calc_type: 'balance', sort_order: 90 });
const PF    = comp({ id: 'p', code: 'EPF_EE', name: 'Provident Fund', kind: 'deduction', calc_type: 'percent_of', percent_of: 'basic', sort_order: 10 });
const COMPONENTS = [BASIC, HRA, FIXED, PF];

const structureFor = (gross: number): SalaryStructure => ({
  id: 's', employee_id: 'e', effective_from: '2026-05-01', effective_to: null,
  ctc_annual: gross * 12, gross_monthly: gross,
  lines: [
    { component_id: 'b', calc_type: 'fixed',      amount_monthly: gross / 2, percent_value: null, sort_order: 10 },
    { component_id: 'h', calc_type: 'percent_of', amount_monthly: 0,         percent_value: 50,   sort_order: 20 },
    { component_id: 'f', calc_type: 'balance',    amount_monthly: 0,         percent_value: null, sort_order: 90 },
    { component_id: 'p', calc_type: 'percent_of', amount_monthly: 0,         percent_value: 12,   sort_order: 10 },
  ],
});

const day = (status: DailyRow['status'], payable: number): DailyRow => ({
  work_date: '2026-05-01', status, payable_fraction: payable, worked_minutes: 480,
  is_late: false, is_early_out: false, overtime_minutes: 0, has_pending_punch: false,
});

const rep = (n: number, s: DailyRow['status'], p: number) => Array.from({ length: n }, () => day(s, p));

/** A whole month for someone who joined on `joinDay`, everything else worked. */
const monthWithJoiner = (calendarDays: number, joinDay: number) => [
  ...rep(joinDay - 1, 'not_joined', 0),
  ...rep(calendarDays - joinDay + 1, 'present', 1),
];

const runFor = (rows: DailyRow[], gross: number, joining: string | null, over: Partial<PayrollInput> = {}) => {
  const attendance = summariseAttendance(rows);
  return calculatePayroll({
    employee: {
      employee_id: 'e', employee_code: 'X-1', full_name: 'Test', designation: '', department: '',
      joining_date: joining, exit_date: null, pan: null, uan: null,
      bank_name: 'B', bank_account: '1', bank_ifsc: 'ABCD0123456', account_holder: 'Test',
    },
    structure: structureFor(gross), components: COMPONENTS, attendance, adjustments: [],
    period: { year: 2026, month: 5, start_date: '2026-05-01', end_date: '2026-05-31' },
    rules: { lop_divisor_mode: 'calendar_days', round_net_to_rupee: false, round_components_to_rupee: true },
    ...over,
  });
};

const line = (r: ReturnType<typeof runFor>, code: string) => r.lines.find(l => l.component_code === code);

describe('a mid-month joiner, through both modules', () => {
  it('is paid for the days employed, not the whole month', () => {
    // Joined the 4th of a 31-day month: 28 days employed.
    const r = runFor(monthWithJoiner(31, 4), 27658, '2026-05-04');
    expect(r.gross_earnings).toBeLessThan(27658);
    expect(r.gross_earnings / 27658).toBeCloseTo(28 / 31, 3);
  });

  it('reports no loss of pay, because they were not absent', () => {
    const att = summariseAttendance(monthWithJoiner(31, 4));
    expect(att.lop_days).toBe(0);          // correct: not absence
    expect(att.payable_days).toBe(28);
    expect(payableRatio('calendar_days', att)).toBeCloseTo(28 / 31, 6);
  });

  it('pro-rates a later joiner further still', () => {
    const early = runFor(monthWithJoiner(31, 4),  50000, '2026-05-04');
    const late  = runFor(monthWithJoiner(31, 11), 50000, '2026-05-11');
    expect(late.gross_earnings).toBeLessThan(early.gross_earnings);
    expect(late.gross_earnings / 50000).toBeCloseTo(21 / 31, 3);
  });

  it('pays a full month once the joiner has a complete one', () => {
    expect(runFor(rep(30, 'present', 1), 50000, '2026-05-04').gross_earnings).toBe(50000);
  });

  it('does the same for someone who leaves mid-month', () => {
    const rows = [...rep(20, 'present', 1), ...rep(11, 'exited', 0)];
    const r = runFor(rows, 50000, '2024-01-01', {
      employee: {
        employee_id: 'e', employee_code: 'X-1', full_name: 'Test', designation: '', department: '',
        joining_date: '2024-01-01', exit_date: '2026-05-20', pan: null, uan: null,
        bank_name: 'B', bank_account: '1', bank_ifsc: 'ABCD0123456', account_holder: 'Test',
      },
    });
    expect(r.gross_earnings / 50000).toBeCloseTo(20 / 31, 3);
  });

  it('still deducts real absence on top of a partial month', () => {
    const joinerWhoAlsoMissedTwoDays = [
      ...rep(3, 'not_joined', 0), ...rep(26, 'present', 1), ...rep(2, 'absent', 0),
    ];
    const att = summariseAttendance(joinerWhoAlsoMissedTwoDays);
    expect(att.lop_days).toBe(2);                    // the absence, and only that
    expect(att.payable_days).toBe(26);
    expect(payableRatio('calendar_days', att)).toBeCloseTo(26 / 31, 6);
  });
});

describe('deductions follow the pro-rated basic, not the full one', () => {
  /*
   * The ordering that a real payroll system's figures confirmed: PF on a
   * part-month is 12% of the REDUCED basic, not 12% of the full basic scaled
   * down. The two differ by a rupee or so once rounding is applied, which is
   * exactly enough to make every reconciliation fail.
   */
  it('computes PF from the reduced basic', () => {
    const r = runFor(monthWithJoiner(31, 4), 27658, '2026-05-04');
    const basic = line(r, 'BASIC')!.amount;
    expect(line(r, 'EPF_EE')!.amount).toBe(Math.round(basic * 0.12));
  });

  it('differs from scaling the full month PF, by design', () => {
    const r = runFor(monthWithJoiner(31, 4), 27658, '2026-05-04');
    const fullMonthPf = Math.round((27658 / 2) * 0.12);
    const scaledDown = Math.round(fullMonthPf * 28 / 31);
    const actual = line(r, 'EPF_EE')!.amount;
    expect(actual).toBeGreaterThanOrEqual(scaledDown);   // the rounding goes the other way
  });
});

describe('whole-rupee component rounding', () => {
  it('leaves no paise on any line when enabled', () => {
    const r = runFor(monthWithJoiner(31, 4), 27658, '2026-05-04');
    for (const l of r.lines) expect(Number.isInteger(l.amount)).toBe(true);
    expect(Number.isInteger(r.gross_earnings)).toBe(true);
    expect(Number.isInteger(r.total_deductions)).toBe(true);
  });

  it('keeps paise when disabled, so the choice is real', () => {
    const withPaise = runFor(monthWithJoiner(31, 4), 27658, '2026-05-04', {
      rules: { lop_divisor_mode: 'calendar_days', round_net_to_rupee: false, round_components_to_rupee: false },
    });
    expect(withPaise.lines.some(l => !Number.isInteger(l.amount))).toBe(true);
  });

  it('keeps net equal to gross minus deductions either way', () => {
    for (const round of [true, false]) {
      const r = runFor(monthWithJoiner(31, 4), 27658, '2026-05-04', {
        rules: { lop_divisor_mode: 'calendar_days', round_net_to_rupee: false, round_components_to_rupee: round },
      });
      expect(r.net_pay).toBeCloseTo(r.gross_earnings - r.total_deductions, 2);
    }
  });
});

describe('the shape a real payroll produces', () => {
  it('splits a full month 50 / 25 / 25 with PF at 12% of basic', () => {
    const r = runFor(rep(31, 'present', 1), 50000, '2024-01-01');
    expect(line(r, 'BASIC')!.amount).toBe(25000);
    expect(line(r, 'HRA')!.amount).toBe(12500);
    expect(line(r, 'SPECIAL')!.amount).toBe(12500);
    expect(line(r, 'EPF_EE')!.amount).toBe(3000);
    expect(r.gross_earnings).toBe(50000);
    expect(r.net_pay).toBe(47000);
  });
});

describe('rounding is applied as each component settles, not at the end', () => {
  /*
   * Caught by reconciling against a real payroll: on a gross of 27,657 the
   * basic is 13,828.50. Settle it first and HRA is 50% of 13,829 = 6,915.
   * Round only at output and HRA is 50% of 13,828.50 = 6,914.
   *
   * Three rupees move between HRA and the balancing allowance. Gross is
   * identical either way, so nothing in the totals reveals it -- it only shows
   * per component, which is exactly where a reconstructed payslip gets compared
   * against the copy the employee already has.
   */
  it('takes a percentage of the settled basic, not the raw one', () => {
    const r = runFor(rep(31, 'present', 1), 27657, '2024-01-01');
    expect(line(r, 'BASIC')!.amount).toBe(13829);    // 13,828.50 settled up
    expect(line(r, 'HRA')!.amount).toBe(6915);       // 50% of 13,829, not of 13,828.50
    expect(line(r, 'SPECIAL')!.amount).toBe(6913);   // the balance of gross
    expect(r.gross_earnings).toBe(27657);
  });

  it('keeps the balancing component honest whichever way the halves fall', () => {
    for (const gross of [27657, 23188, 26001, 33333, 50000]) {
      const r = runFor(rep(31, 'present', 1), gross, '2024-01-01');
      const sum = r.lines.filter(l => l.kind === 'earning').reduce((a, l) => a + l.amount, 0);
      expect(sum).toBe(gross);                       // never drifts from the agreed gross
      expect(r.gross_earnings).toBe(gross);
    }
  });

  it('carries the settled figures through pro-ration too', () => {
    // 28 of 31 days: each component pro-rated from its settled whole-rupee value.
    const r = runFor(monthWithJoiner(31, 4), 27657, '2026-05-04');
    expect(line(r, 'BASIC')!.amount).toBe(Math.round(13829 * 28 / 31));
    expect(line(r, 'HRA')!.amount).toBe(Math.round(6915 * 28 / 31));
    expect(line(r, 'SPECIAL')!.amount).toBe(Math.round(6913 * 28 / 31));
  });
});
