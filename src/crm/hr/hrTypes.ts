/**
 * Row shapes for the HR & Payroll screens.
 *
 * Derived from the generated database types wherever a table is read directly,
 * so a migration that changes a column breaks the build rather than the page.
 * The calculation domain (components, structures, payroll results) is NOT
 * redefined here -- it comes from the shared engine via src/lib/hr.
 */

import type { Database } from '../../lib/database.types';

type T = Database['public']['Tables'];

export type HRSettings          = T['hr_settings']['Row'];
export type AttendanceSettings  = T['hr_attendance_settings']['Row'];
export type AllowedNetwork      = T['hr_allowed_networks']['Row'];
export type AttendancePunch     = T['hr_attendance_punches']['Row'];
export type AttendanceAdjustment= T['hr_attendance_adjustments']['Row'];
export type AttendanceDaily     = T['hr_attendance_daily']['Row'];
export type EmployeeProfile     = T['hr_employee_profiles']['Row'];
export type BankAccount         = T['hr_employee_bank_accounts']['Row'];
export type WorkSchedule        = T['hr_work_schedules']['Row'];
export type PaySchedule         = T['hr_pay_schedules']['Row'];
export type LeaveType           = T['hr_leave_types']['Row'];
export type LeaveBalance        = T['hr_leave_balances']['Row'];
export type LeaveRequest        = T['hr_leave_requests']['Row'];
export type LeaveDay            = T['hr_leave_days']['Row'];
export type Holiday             = T['hr_holidays']['Row'];
export type SalaryComponentRow  = T['hr_salary_components']['Row'];
export type ComponentSlabRow    = T['hr_salary_component_slabs']['Row'];
export type SalaryStructureRow  = T['hr_salary_structures']['Row'];
export type StructureLineRow    = T['hr_salary_structure_lines']['Row'];
export type PayrollRun          = T['hr_payroll_runs']['Row'];
export type PayrollRecord       = T['hr_payroll_employee_records']['Row'];
export type PayrollLineRow      = T['hr_payroll_lines']['Row'];
export type PayrollAdjustmentRow= T['hr_payroll_adjustments']['Row'];
export type PayrollEvent        = T['hr_payroll_events']['Row'];
export type BankTemplateRow     = T['hr_bank_payment_templates']['Row'];
export type BankTemplateColumn  = T['hr_bank_payment_template_columns']['Row'];
export type PaymentFile         = T['hr_payroll_payment_files']['Row'];
export type Payslip             = T['hr_payslips']['Row'];
export type AuditLog            = T['hr_audit_logs']['Row'];
export type RolePermission      = T['hr_role_permissions']['Row'];

/** nw_employees joined with its HR profile -- what the directory renders. */
export interface HREmployee {
  id: string;
  employee_code: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  designation: string | null;
  avatar_url: string | null;
  status: string;
  joining_date: string | null;
  profile: EmployeeProfile | null;
  bank: BankAccount | null;
}

/** What the punch card renders. Mirrors hr_punch_state()'s jsonb exactly. */
export interface PunchState {
  ok?: boolean;
  work_date: string;
  server_time: string;
  /** The caller's OWN public IP as the server sees it -- never the allowlist. */
  detected_ip: string | null;
  punched_in: boolean;
  next_action: 'in' | 'out';
  last_punch_at: string | null;
  first_in_at: string | null;
  last_out_at: string | null;
  worked_minutes: number;
  status: string;
  is_late: boolean;
  late_minutes: number;
  has_pending_punch: boolean;
  network_status: 'office' | 'off_network' | 'unknown';
  network_name: string;
  network_exempt: boolean;
  enforcement_mode: 'observe' | 'enforce';
  office_start: string;
  office_end: string;
  /** Permitted punching hours, separate from office hours. */
  window_enforced: boolean;
  window_start: string;
  window_end: string;
  within_window: boolean;
  day_blocked: boolean;
  /** True when THIS action would be refused on time-of-day grounds. */
  window_blocks_next: boolean;
  can_punch: boolean;
  timeline: { type: 'in' | 'out'; at: string; network: string; approval: string }[];
  error?: string;
}

export interface PunchResult {
  ok: boolean;
  code?: string;
  message?: string;
  error?: string;
  punch_type?: 'in' | 'out';
  network_status?: string;
  network_name?: string;
  approval_status?: string;
}

/** Which HR screens the signed-in user may see. Resolved once per session. */
export interface HRAccess {
  isAdmin: boolean;
  hrRole: 'none' | 'manager' | 'hr_admin';
  canView: Record<HRModule, boolean>;
  canEdit: Record<HRModule, boolean>;
  /** Any admin surface at all -- decides whether the HR nav section appears. */
  anyAdminAccess: boolean;
}

export type HRModule =
  | 'employees' | 'attendance' | 'leave' | 'holidays'
  | 'salary' | 'payroll' | 'payslips' | 'reports' | 'settings';

export const HR_MODULES: HRModule[] = [
  'employees', 'attendance', 'leave', 'holidays',
  'salary', 'payroll', 'payslips', 'reports', 'settings',
];
