/**
 * Shared HR & Payroll domain types.
 *
 * Lives under supabase/functions/_shared so the Edge Function bundler is
 * guaranteed to ship it, and so the repo's existing vitest glob
 * (`supabase/functions/_shared/ **\/*.test.ts`) covers the logic beside it. The
 * browser reaches these through src/lib/hr/, which re-exports rather than
 * duplicates -- two copies of the payroll rules would drift, and the drift
 * would be invisible until a payslip was wrong.
 *
 * There is no Deno-specific import anywhere in this folder, by design.
 */

export type ComponentKind = 'earning' | 'deduction' | 'employer_contribution';
export type CalcType = 'fixed' | 'percent_of' | 'balance' | 'slab';
export type PercentBase = 'basic' | 'gross' | 'ctc' | 'component';

/** How a month's pay is divided into days. Set per pay schedule, never hardcoded. */
export type LopDivisorMode = 'calendar_days' | 'working_days' | 'payable_days' | 'fixed_30';

export interface ComponentSlab {
  from_amount: number;
  to_amount: number | null;   // null = open-ended top slab
  amount: number;
}

export interface SalaryComponent {
  id: string;
  code: string;
  name: string;
  kind: ComponentKind;
  calc_type: CalcType;
  percent_of: PercentBase | null;
  percent_of_component_id: string | null;
  default_percent: number | null;
  /** Caps the BASE a percentage is applied to (a PF wage ceiling). */
  cap_base: number | null;
  /** Caps the RESULT after the percentage. */
  cap_amount: number | null;
  floor_amount: number | null;
  /** Component switches off entirely once gross exceeds this (an ESI ceiling). */
  eligibility_max_gross: number | null;
  prorate_on_lop: boolean;
  taxable: boolean;
  include_in_gross: boolean;
  include_in_ctc: boolean;
  show_on_payslip: boolean;
  is_recurring: boolean;
  sort_order: number;
  slabs?: ComponentSlab[];
}

export interface StructureLine {
  component_id: string;
  calc_type: CalcType;
  amount_monthly: number;
  percent_value: number | null;
  sort_order: number;
}

export interface SalaryStructure {
  id: string;
  employee_id: string;
  effective_from: string;
  effective_to: string | null;
  ctc_annual: number;
  gross_monthly: number;
  lines: StructureLine[];
}

/** A month of hr_attendance_daily, already aggregated. */
export interface AttendanceSummary {
  calendar_days: number;
  working_days: number;
  present_days: number;
  paid_leave_days: number;
  unpaid_leave_days: number;
  holiday_days: number;
  weekly_off_days: number;
  absent_days: number;
  lop_days: number;
  payable_days: number;
  late_days: number;
  early_out_days: number;
  overtime_minutes: number;
  /** Off-network punches in the period that nobody has approved yet. */
  pending_punch_days: number;
}

export interface PayrollAdjustment {
  id: string;
  component_id: string | null;
  label: string;
  kind: ComponentKind;
  amount: number;
  prorate_on_lop: boolean;
  taxable: boolean;
}

export interface EmployeeForPayroll {
  employee_id: string;
  employee_code: string;
  full_name: string;
  designation: string;
  department: string;
  joining_date: string | null;
  exit_date: string | null;
  pan: string | null;
  uan: string | null;
  bank_name: string;
  bank_account: string;
  bank_ifsc: string;
  account_holder: string;
}

export interface PayrollRules {
  lop_divisor_mode: LopDivisorMode;
  round_net_to_rupee: boolean;
  /**
   * Round every component to the whole rupee as it is computed.
   *
   * Payroll systems differ here and the difference is visible on the payslip:
   * pro-rating 6,915 over 28/31 days gives 6,245.81 with paise kept and 6,246
   * without. Carrying paise a system does not use makes every historical
   * payslip disagree with the one the employee already has.
   */
  round_components_to_rupee?: boolean;
}

export interface PayrollPeriod {
  year: number;
  month: number;       // 1-12
  start_date: string;  // ISO
  end_date: string;    // ISO
}

export interface PayrollLine {
  component_id: string | null;
  component_code: string;
  component_name: string;
  kind: ComponentKind;
  /** Full monthly entitlement, before LOP. */
  base_amount: number;
  /** What actually applies this month. */
  amount: number;
  prorated: boolean;
  taxable: boolean;
  show_on_payslip: boolean;
  adjustment_id: string | null;
  sort_order: number;
}

export type PayrollExceptionCode =
  | 'no_salary_structure'
  | 'missing_bank_details'
  | 'unapproved_attendance'
  | 'full_month_lop'
  | 'has_lop'
  | 'negative_net'
  | 'gross_mismatch'
  | 'joined_mid_month'
  | 'exited_mid_month'
  | 'no_earnings';

export interface PayrollException {
  code: PayrollExceptionCode;
  message: string;
  severity: 'blocker' | 'warning' | 'info';
}

export interface PayrollResult {
  employee_id: string;
  structure_id: string | null;
  lines: PayrollLine[];
  gross_earnings: number;
  total_deductions: number;
  employer_contrib: number;
  lop_amount: number;
  net_pay: number;
  ctc_annual: number;
  lop_days: number;
  payable_days: number;
  lop_divisor: number;
  exceptions: PayrollException[];
  /** true when nothing blocks this employee from being paid. */
  payable: boolean;
}

export interface PayrollInput {
  employee: EmployeeForPayroll;
  structure: SalaryStructure | null;
  components: SalaryComponent[];
  attendance: AttendanceSummary;
  adjustments: PayrollAdjustment[];
  period: PayrollPeriod;
  rules: PayrollRules;
}
