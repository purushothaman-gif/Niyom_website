import { describe, it, expect } from 'vitest';
import { summariseAttendance, formatDuration, type DailyRow } from './attendanceSummary.ts';

const day = (over: Partial<DailyRow> & Pick<DailyRow, 'status' | 'payable_fraction'>): DailyRow => ({
  work_date: '2026-08-01', worked_minutes: 0, is_late: false, is_early_out: false,
  overtime_minutes: 0, has_pending_punch: false, ...over,
});

const present  = () => day({ status: 'present', payable_fraction: 1, worked_minutes: 490 });
const halfDay  = () => day({ status: 'half_day', payable_fraction: 0.5, worked_minutes: 250 });
const absent   = () => day({ status: 'absent', payable_fraction: 0 });
const weekOff  = () => day({ status: 'weekly_off', payable_fraction: 1 });
const holiday  = () => day({ status: 'holiday', payable_fraction: 1 });
const paidLv   = () => day({ status: 'paid_leave', payable_fraction: 1 });
const unpaidLv = () => day({ status: 'unpaid_leave', payable_fraction: 0 });

const month = (...groups: DailyRow[][]) => groups.flat();
const repeat = (n: number, f: () => DailyRow) => Array.from({ length: n }, f);

describe('a clean 31-day month', () => {
  // 26 worked + 4 weekly offs + 1 holiday
  const s = summariseAttendance(month(repeat(26, present), repeat(4, weekOff), repeat(1, holiday)));

  it('counts the calendar', () => {
    expect(s.calendar_days).toBe(31);
    expect(s.weekly_off_days).toBe(4);
    expect(s.holiday_days).toBe(1);
  });

  it('counts only expected-to-work days as working days', () => {
    expect(s.working_days).toBe(26);
  });

  it('pays the whole month with no loss of pay', () => {
    expect(s.payable_days).toBe(31);
    expect(s.lop_days).toBe(0);
  });
});

describe('absence and leave', () => {
  it('turns an absent day into exactly one LOP day', () => {
    const s = summariseAttendance(month(repeat(25, present), repeat(1, absent), repeat(5, weekOff)));
    expect(s.absent_days).toBe(1);
    expect(s.lop_days).toBe(1);
    expect(s.payable_days).toBe(30);
  });

  it('costs nothing for paid leave', () => {
    const s = summariseAttendance(month(repeat(24, present), repeat(2, paidLv), repeat(5, weekOff)));
    expect(s.paid_leave_days).toBe(2);
    expect(s.lop_days).toBe(0);
  });

  it('charges unpaid leave as LOP', () => {
    const s = summariseAttendance(month(repeat(24, present), repeat(2, unpaidLv), repeat(5, weekOff)));
    expect(s.unpaid_leave_days).toBe(2);
    expect(s.lop_days).toBe(2);
  });

  it('charges half a day for a half day', () => {
    const s = summariseAttendance(month(repeat(25, present), repeat(1, halfDay), repeat(5, weekOff)));
    expect(s.present_days).toBe(25.5);
    expect(s.lop_days).toBe(0.5);
    expect(s.payable_days).toBe(30.5);
  });

  it('handles a whole month of absence', () => {
    const s = summariseAttendance(repeat(30, absent));
    expect(s.lop_days).toBe(30);
    expect(s.payable_days).toBe(0);
  });
});

describe('employment window', () => {
  /*
   * The trap this guards: counting the days before someone joined as LOP would
   * dock them for not existing yet, and then the pro-rata would dock them
   * again. A joiner on the 20th should simply be paid for the 20th onward.
   */
  it('does not charge a mid-month joiner for the days before they joined', () => {
    const s = summariseAttendance(month(
      repeat(19, () => day({ status: 'not_joined', payable_fraction: 0 })),
      repeat(10, present),
      repeat(2, weekOff),
    ));
    expect(s.calendar_days).toBe(31);
    expect(s.payable_days).toBe(12);
    expect(s.lop_days).toBe(0);        // not 19
    expect(s.absent_days).toBe(0);
  });

  it('does not charge a leaver for the days after they left', () => {
    const s = summariseAttendance(month(
      repeat(18, present), repeat(2, weekOff),
      repeat(11, () => day({ status: 'exited', payable_fraction: 0 })),
    ));
    expect(s.payable_days).toBe(20);
    expect(s.lop_days).toBe(0);
  });

  it('still charges a real absence inside a partial month', () => {
    const s = summariseAttendance(month(
      repeat(19, () => day({ status: 'not_joined', payable_fraction: 0 })),
      repeat(9, present), repeat(1, absent), repeat(2, weekOff),
    ));
    expect(s.lop_days).toBe(1);
  });
});

describe('flags carried into payroll', () => {
  it('counts late and early days', () => {
    const s = summariseAttendance(month(
      repeat(3, () => day({ status: 'present', payable_fraction: 1, is_late: true })),
      repeat(2, () => day({ status: 'present', payable_fraction: 1, is_early_out: true })),
    ));
    expect(s.late_days).toBe(3);
    expect(s.early_out_days).toBe(2);
  });

  it('sums overtime', () => {
    const s = summariseAttendance(repeat(4, () => day({ status: 'present', payable_fraction: 1, overtime_minutes: 45 })));
    expect(s.overtime_minutes).toBe(180);
  });

  /* This is what blocks a payroll run: pay computed from attendance nobody has approved. */
  it('surfaces days with punches still awaiting approval', () => {
    const s = summariseAttendance(month(
      repeat(20, present),
      repeat(2, () => day({ status: 'absent', payable_fraction: 0, has_pending_punch: true })),
    ));
    expect(s.pending_punch_days).toBe(2);
  });
});

describe('robustness', () => {
  it('returns a zeroed summary for an empty month', () => {
    const s = summariseAttendance([]);
    expect(s.calendar_days).toBe(0);
    expect(s.payable_days).toBe(0);
    expect(s.lop_days).toBe(0);
  });

  it('clamps a corrupt payable_fraction instead of propagating it', () => {
    const s = summariseAttendance([
      day({ status: 'present', payable_fraction: 5 }),
      day({ status: 'present', payable_fraction: -3 }),
      day({ status: 'present', payable_fraction: NaN }),
    ]);
    expect(s.payable_days).toBe(1);
    expect(s.lop_days).toBe(2);
  });
});

describe('formatDuration', () => {
  it('reads the way the punch card shows it', () => {
    expect(formatDuration(272)).toBe('4h 32m');
    expect(formatDuration(60)).toBe('1h 0m');
    expect(formatDuration(0)).toBe('0h 0m');
    expect(formatDuration(-5)).toBe('0h 0m');
  });
});
