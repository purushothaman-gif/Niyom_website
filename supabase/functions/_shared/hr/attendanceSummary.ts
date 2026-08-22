/**
 * Turning a month of hr_attendance_daily rows into the summary payroll needs.
 *
 * Kept separate from the SQL that DERIVES each day: that decides what a single
 * day was, this decides what a month adds up to. Splitting them means the month
 * arithmetic -- which is what LOP and therefore net pay hangs on -- can be
 * tested against fixtures rather than only against a live database.
 *
 * The central quantity is `payable_days`: the sum of each day's
 * payable_fraction. Weekly offs and holidays count 1.0 (they are paid),
 * a present day 1.0, a half day 0.5, an absence 0. LOP days are then simply
 * calendar days minus payable days, which is what makes half-day leave and a
 * mid-month joiner come out right without any special cases.
 */

import type { AttendanceSummary } from './types.ts';

export interface DailyRow {
  work_date: string;
  status:
    | 'present' | 'half_day' | 'absent' | 'weekly_off' | 'holiday'
    | 'paid_leave' | 'unpaid_leave' | 'on_duty' | 'not_joined' | 'exited';
  payable_fraction: number;
  worked_minutes: number;
  is_late: boolean;
  is_early_out: boolean;
  overtime_minutes: number;
  has_pending_punch: boolean;
}

/** Days that are neither a weekly off nor a holiday -- what someone is expected to work. */
const WORKING_STATUSES = new Set([
  'present', 'half_day', 'absent', 'paid_leave', 'unpaid_leave', 'on_duty',
]);

export function summariseAttendance(rows: DailyRow[]): AttendanceSummary {
  const s: AttendanceSummary = {
    calendar_days: rows.length,
    working_days: 0, present_days: 0, paid_leave_days: 0, unpaid_leave_days: 0,
    holiday_days: 0, weekly_off_days: 0, absent_days: 0, lop_days: 0,
    payable_days: 0, late_days: 0, early_out_days: 0, overtime_minutes: 0,
    pending_punch_days: 0,
  };

  for (const r of rows) {
    const payable = clamp01(r.payable_fraction);
    s.payable_days += payable;

    if (WORKING_STATUSES.has(r.status)) s.working_days += 1;

    switch (r.status) {
      case 'present':
      case 'on_duty':      s.present_days += 1; break;
      case 'half_day':     s.present_days += 0.5; break;
      case 'paid_leave':   s.paid_leave_days += 1; break;
      case 'unpaid_leave': s.unpaid_leave_days += 1; break;
      case 'holiday':      s.holiday_days += 1; break;
      case 'weekly_off':   s.weekly_off_days += 1; break;
      case 'absent':       s.absent_days += 1; break;
      // not_joined / exited are outside the employment window: they are
      // neither worked nor payable, and must not read as absence.
      default: break;
    }

    if (r.is_late) s.late_days += 1;
    if (r.is_early_out) s.early_out_days += 1;
    s.overtime_minutes += r.overtime_minutes || 0;
    if (r.has_pending_punch) s.pending_punch_days += 1;
  }

  /*
   * LOP is the shortfall against the days the employee was actually employed
   * for -- NOT against the length of the month. Counting not_joined/exited days
   * as LOP would dock a joiner for the days before they existed and then dock
   * them again through the pro-rata, paying them roughly nothing.
   */
  const employedDays = rows.filter(r => r.status !== 'not_joined' && r.status !== 'exited').length;
  s.lop_days = round2(Math.max(0, employedDays - s.payable_days));

  s.payable_days   = round2(s.payable_days);
  s.present_days   = round2(s.present_days);
  s.working_days   = round2(s.working_days);
  return s;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Minutes as "7h 32m", for the punch card and the register. */
export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '0h 0m';
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}m`;
}
