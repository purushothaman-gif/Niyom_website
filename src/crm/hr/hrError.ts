/**
 * Turning database and edge-function failures into sentences a person can act on.
 *
 * An employee standing at the office door should never see "ERROR 23505" or a
 * constraint name. Equally, the real error must not be thrown away -- it goes to
 * the console for whoever is debugging, and the security-relevant ones are
 * already recorded server-side in hr_audit_logs.
 *
 * The RPCs in this module raise with deliberate, already-human messages
 * ("You cannot approve your own leave request."), so those are passed through
 * unchanged; only the raw Postgres codes need translating.
 */

export interface PgLikeError {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

const BY_CONSTRAINT: { match: RegExp; message: string }[] = [
  { match: /hr_punches_no_exact_dupe/,      message: 'This attendance punch has already been recorded. Please refresh the page and try again.' },
  { match: /hr_leave_days_one_per_day/,     message: 'Leave is already booked on one of those dates. Cancel the existing request first.' },
  { match: /hr_adjustments_one_open/,       message: 'You already have a correction request open for that date. Edit it instead of raising another.' },
  { match: /hr_employee_profiles_pan_uniq/, message: 'That PAN is already recorded against another employee.' },
  { match: /hr_employee_profiles_uan_uniq/, message: 'That UAN is already recorded against another employee.' },
  { match: /hr_salary_structures_one_open/, message: 'This employee already has an open salary structure. Close it with an end date, or create the new one as a revision.' },
  { match: /hr_payslips_payslip_number_key/,message: 'A payslip with that number already exists for this period.' },
  { match: /hr_leave_types_code_key/,       message: 'A leave type with that code already exists.' },
  { match: /hr_salary_components_code_key/, message: 'A salary component with that code already exists.' },
  { match: /hr_work_schedules_name_key|hr_pay_schedules_name_key|hr_bank_payment_templates_name_key/,
    message: 'Something with that name already exists. Pick a different one.' },
  { match: /hr_holidays_holiday_date_location_name_key/,
    message: 'That holiday is already on the calendar for this location.' },
  { match: /hr_employee_bank_primary/,      message: 'This employee already has a primary bank account. Mark the existing one as not primary first.' },
];

const BY_CODE: Record<string, string> = {
  '23505': 'That record already exists.',
  '23503': 'A linked record is missing or has been removed. Refresh and try again.',
  '23514': 'Some of those values are not allowed together. Please review the form.',
  '23502': 'A required field is missing.',
  '22P02': 'One of the values is not in the expected format.',
  '42501': 'You do not have permission to do that.',
  '42883': 'That action is not available. Please reload the page.',
  'P0002': 'That record could not be found.',
  '40001': 'Someone else changed this at the same moment. Please try again.',
  '57014': 'That took too long and was cancelled. Try a narrower date range.',
};

/**
 * `raisedByUs` marks messages the HR functions wrote deliberately -- they are
 * already phrased for a person, so translating them would make them worse.
 */
function raisedByUs(message: string): boolean {
  return /^(You |Only |Not permitted|Attendance |Payroll |This payroll|Leave |Approve |Lock |A reason|That range|Not enough|Salary structure|Unknown employee|Employee |Recalculate|Correction|Punch not found)/.test(message);
}

export function hrErrorMessage(err: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (!err) return fallback;

  if (typeof err === 'string') return err;

  const e = err as PgLikeError & { error?: string };

  // Edge functions answer { ok:false, error | message }.
  if (typeof e.error === 'string' && e.error) return e.error;

  const raw = `${e.message ?? ''} ${e.details ?? ''}`;

  for (const rule of BY_CONSTRAINT) {
    if (rule.match.test(raw)) return rule.message;
  }

  if (e.message && raisedByUs(e.message)) {
    // Strip the Postgres context suffix some drivers append.
    return e.message.split('\n')[0].trim();
  }

  if (e.code && BY_CODE[e.code]) return BY_CODE[e.code];

  // Anything left is genuinely unexpected: keep it out of the UI, keep it in
  // the console where it is useful.
  if (e.message) console.error('[hr] unmapped error', e.code, e.message, e.details);
  return fallback;
}

/** Convenience for `catch (err) { showToast(hrError(err), false) }`. */
export const hrError = hrErrorMessage;
