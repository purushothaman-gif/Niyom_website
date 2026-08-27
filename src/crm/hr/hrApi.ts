/**
 * Data access for HR & Payroll.
 *
 * Every screen goes through here rather than calling supabase inline, for two
 * reasons: the RLS-sensitive reads are written once and reviewed once, and the
 * two attendance calls that MUST go through an edge function (so the IP is
 * decided server-side) cannot be accidentally replaced by a direct table write.
 *
 * There is deliberately no `insertPunch` and no `writeAttendanceDaily`. Those
 * tables have no INSERT policy for anyone -- punches exist only via
 * hr-attendance-punch, and daily rows only via hr_recompute_daily().
 */

import { supabase } from '../../lib/supabase';
import type {
  AllowedNetwork, AttendanceAdjustment, AttendanceDaily, AttendancePunch, HRNavContext, OfficeLocation,
  AttendanceSettings, AuditLog, BankAccount, BankTemplateColumn, BankTemplateRow,
  ComponentSlabRow, EmployeeProfile, HRAccess, HREmployee, HRModule, HRSettings,
  Holiday, LeaveBalance, LeaveRequest, LeaveType, PaySchedule, PayrollAdjustmentRow,
  PayrollEvent, PayrollLineRow, PayrollRecord, PayrollRun, Payslip, PunchResult,
  PunchState, SalaryComponentRow, SalaryStructureRow, StructureLineRow, WorkSchedule,
} from './hrTypes';
import { HR_MODULES } from './hrTypes';

const FN_BASE = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`;

async function callFunction<T>(name: string, body: unknown): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const res = await fetch(`${FN_BASE}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token ?? ''}` },
    body: JSON.stringify(body ?? {}),
  });
  const json = await res.json().catch(() => ({ ok: false, error: 'Unexpected response from the server.' }));
  return json as T;
}

/**
 * Unwrap a PostgREST result, throwing the error for hrError() to translate.
 *
 * The `NonNullable` is honest rather than convenient: every caller here uses
 * `.single()` or an RPC that always returns a value, so a null `data` alongside
 * a null `error` would be a driver-level impossibility -- and the alternative,
 * threading `| null` through every call site, would mean null checks that can
 * never fire.
 */
function unwrap<T>({ data, error }: { data: T; error: unknown }): NonNullable<T> {
  if (error) throw error;
  return data as NonNullable<T>;
}

// ===========================================================================
// Access
// ===========================================================================

/**
 * What this user may see. Resolved through the same SECURITY DEFINER helpers
 * the RLS policies use, so the menu can never offer a screen the database will
 * then refuse -- and, more importantly, hiding a screen is never the only thing
 * protecting it.
 */
export async function loadAccess(role: string): Promise<HRAccess> {
  const isAdmin = role === 'admin' || role === 'super_admin';

  const ctx = await loadNavContext();
  const resolved = ctx.hr_role;

  const canView = {} as Record<HRModule, boolean>;
  const canEdit = {} as Record<HRModule, boolean>;

  if (isAdmin) {
    HR_MODULES.forEach(m => { canView[m] = true; canEdit[m] = true; });
  } else {
    const { data: perms } = await supabase
      .from('hr_role_permissions').select('module, can_view, can_edit').eq('hr_role', resolved);
    HR_MODULES.forEach(m => {
      const p = (perms ?? []).find(x => x.module === m);
      canView[m] = !!p?.can_view;
      canEdit[m] = !!p?.can_edit;
    });
  }

  return {
    isAdmin, hrRole: resolved, canView, canEdit,
    anyAdminAccess: isAdmin || HR_MODULES.some(m => canView[m]),
    onPayroll: ctx.on_payroll,
  };
}

/**
 * The menu's view of the signed-in user, in one call.
 *
 * Fails CLOSED on the administration side and OPEN on self-service: if this
 * cannot be resolved, do not offer HR admin screens, but do keep someone's own
 * attendance reachable. Guessing the other way would either hand out a menu
 * nobody is entitled to, or hide a person's own punch card from them.
 */
export async function loadNavContext(): Promise<HRNavContext> {
  const { data, error } = await supabase.rpc('hr_my_nav_context');
  if (error || !data) return { hr_role: 'none', hr_admin_access: false, on_payroll: true };
  return data as unknown as HRNavContext;
}

// ===========================================================================
// Settings & configuration
// ===========================================================================

export const getHRSettings = async (): Promise<HRSettings | null> =>
  (await supabase.from('hr_settings').select('*').eq('id', 1).maybeSingle()).data;

export const saveHRSettings = async (patch: Partial<HRSettings>) =>
  unwrap(await supabase.from('hr_settings').update(patch).eq('id', 1).select().single());

export const getAttendanceSettings = async (): Promise<AttendanceSettings | null> =>
  (await supabase.from('hr_attendance_settings').select('*').eq('id', 1).maybeSingle()).data;

export const saveAttendanceSettings = async (patch: Partial<AttendanceSettings>) =>
  unwrap(await supabase.from('hr_attendance_settings').update(patch).eq('id', 1).select().single());

export const listWorkSchedules = async (): Promise<WorkSchedule[]> =>
  (await supabase.from('hr_work_schedules').select('*').order('name')).data ?? [];

export const listPaySchedules = async (): Promise<PaySchedule[]> =>
  (await supabase.from('hr_pay_schedules').select('*').order('name')).data ?? [];

export const savePaySchedule = async (id: string, patch: Partial<PaySchedule>) =>
  unwrap(await supabase.from('hr_pay_schedules').update(patch).eq('id', id).select().single());

export const saveWorkSchedule = async (id: string, patch: Partial<WorkSchedule>) =>
  unwrap(await supabase.from('hr_work_schedules').update(patch).eq('id', id).select().single());

// ---- Office geofences (HR-readable only; employees never see the coordinates)

export const listOffices = async (): Promise<OfficeLocation[]> =>
  (await supabase.from('hr_office_locations').select('*').order('created_at', { ascending: false })).data ?? [];

export const createOffice = async (row: Partial<OfficeLocation>) =>
  unwrap(await supabase.from('hr_office_locations').insert(row as never).select().single());

export const updateOffice = async (id: string, patch: Partial<OfficeLocation>) =>
  unwrap(await supabase.from('hr_office_locations').update(patch).eq('id', id).select().single());

/*
 * Retired, not deleted. Punches reference the office they were judged against;
 * deleting the row would null that reference and quietly rewrite the record of
 * where somebody was standing.
 */
export const retireOffice = async (id: string) =>
  unwrap(await supabase.from('hr_office_locations').update({ status: 'inactive' }).eq('id', id).select().single());

// ---- Allowed networks (HR-readable only; employees never see the office IPs)

export const listNetworks = async (): Promise<AllowedNetwork[]> =>
  (await supabase.from('hr_allowed_networks').select('*').order('created_at', { ascending: false })).data ?? [];

export const createNetwork = async (row: Partial<AllowedNetwork>) =>
  unwrap(await supabase.from('hr_allowed_networks').insert(row as never).select().single());

export const updateNetwork = async (id: string, patch: Partial<AllowedNetwork>) =>
  unwrap(await supabase.from('hr_allowed_networks').update(patch).eq('id', id).select().single());

export const deleteNetwork = async (id: string) => {
  const { error } = await supabase.from('hr_allowed_networks').delete().eq('id', id);
  if (error) throw error;
};

// ===========================================================================
// Attendance
// ===========================================================================

/**
 * Today's state plus the SERVER's verdict on the current network. Goes through
 * the edge function because the browser must not be told what the office IPs
 * are, and because the preview must use the same rule as the punch itself.
 */
export const getPunchState = (fix?: { latitude: number; longitude: number; accuracy: number }) =>
  callFunction<PunchState>('hr-attendance-state', fix ?? {});

/**
 * The only way to create a punch.
 *
 * The coordinates are REPORTED, not trusted: the server holds the office
 * position, computes the distance itself, and decides. Sending them from here
 * is unavoidable -- a GPS fix has no other source.
 */
export const punch = (
  punch_type: 'in' | 'out',
  fix?: { latitude: number; longitude: number; accuracy: number },
): Promise<PunchResult> =>
  callFunction<PunchResult>('hr-attendance-punch', { punch_type, source: 'web', ...(fix ?? {}) });

export const listMyDaily = async (employeeId: string, from: string, to: string): Promise<AttendanceDaily[]> =>
  (await supabase.from('hr_attendance_daily').select('*')
    .eq('employee_id', employeeId).gte('work_date', from).lte('work_date', to)
    .order('work_date', { ascending: false })).data ?? [];

export const listDailyForDate = async (date: string): Promise<AttendanceDaily[]> =>
  (await supabase.from('hr_attendance_daily').select('*').eq('work_date', date)).data ?? [];

export const listDailyForRange = async (from: string, to: string): Promise<AttendanceDaily[]> =>
  (await supabase.from('hr_attendance_daily').select('*')
    .gte('work_date', from).lte('work_date', to)
    .order('work_date')).data ?? [];

export const listPunches = async (employeeId: string, date: string): Promise<AttendancePunch[]> =>
  (await supabase.from('hr_attendance_punches').select('*')
    .eq('employee_id', employeeId).eq('work_date', date)
    .order('punched_at')).data ?? [];

export const listPendingPunches = async (): Promise<AttendancePunch[]> =>
  (await supabase.from('hr_attendance_punches').select('*')
    .eq('approval_status', 'pending').order('punched_at', { ascending: false }).limit(200)).data ?? [];

export const reviewPunch = async (punchId: string, approve: boolean, note: string) =>
  unwrap(await supabase.rpc('hr_review_punch', { p_punch_id: punchId, p_approve: approve, p_note: note }));

/**
 * Allowlist an office address and clear the punches held from it, in one go.
 *
 * One RPC rather than "create network" followed by N "approve punch" calls: a
 * half-applied version leaves an approved network with punches still sitting in
 * the queue, which reads as a bug and has to be cleaned up by hand.
 */
export const allowlistNetwork = async (
  ip: string, name: string, location: string, approvePending: boolean, description = '',
) => unwrap(await supabase.rpc('hr_allowlist_network', {
  p_ip: ip, p_name: name, p_location: location,
  p_approve_pending: approvePending, p_description: description,
})) as { ok: boolean; network_id: string; ip: string; punches_approved: number; employees_affected: number };

// ---- Corrections

export const listAdjustments = async (opts: { employeeId?: string; pendingOnly?: boolean } = {}) => {
  let q = supabase.from('hr_attendance_adjustments').select('*').order('created_at', { ascending: false });
  if (opts.employeeId) q = q.eq('employee_id', opts.employeeId);
  if (opts.pendingOnly) q = q.eq('status', 'pending');
  return (await q.limit(300)).data ?? [] as AttendanceAdjustment[];
};

export const requestAdjustment = async (row: Partial<AttendanceAdjustment>) =>
  unwrap(await supabase.from('hr_attendance_adjustments').insert(row as never).select().single());

export const reviewAdjustment = async (id: string, approve: boolean, note: string) =>
  unwrap(await supabase.rpc('hr_review_adjustment', { p_adjustment_id: id, p_approve: approve, p_note: note }));

export const cancelAdjustment = async (id: string) =>
  unwrap(await supabase.from('hr_attendance_adjustments').update({ status: 'cancelled' }).eq('id', id).select().single());

export const recomputeAttendance = async (employeeId: string | null, from: string, to: string) =>
  unwrap(await supabase.rpc('hr_admin_recompute', {
    // Generated as non-nullable because the SQL parameter has no DEFAULT;
    // hr_admin_recompute treats NULL as "every active employee".
    p_employee_id: employeeId as unknown as string,
    p_from: from, p_to: to,
  }));

// ===========================================================================
// Leave & holidays
// ===========================================================================

export const listLeaveTypes = async (activeOnly = false): Promise<LeaveType[]> => {
  let q = supabase.from('hr_leave_types').select('*').order('sort_order');
  if (activeOnly) q = q.eq('active', true);
  return (await q).data ?? [];
};

export const saveLeaveType = async (id: string | null, row: Partial<LeaveType>) =>
  id
    ? unwrap(await supabase.from('hr_leave_types').update(row).eq('id', id).select().single())
    : unwrap(await supabase.from('hr_leave_types').insert(row as never).select().single());

export const listLeaveBalances = async (employeeId: string | null, year: number): Promise<LeaveBalance[]> => {
  let q = supabase.from('hr_leave_balances').select('*').eq('leave_year', year);
  if (employeeId) q = q.eq('employee_id', employeeId);
  return (await q).data ?? [];
};

export const adjustLeaveBalance = async (id: string, adjusted: number) =>
  unwrap(await supabase.from('hr_leave_balances').update({ adjusted }).eq('id', id).select().single());

export const listLeaveRequests = async (opts: { employeeId?: string; pendingOnly?: boolean } = {}) => {
  let q = supabase.from('hr_leave_requests').select('*').order('from_date', { ascending: false });
  if (opts.employeeId) q = q.eq('employee_id', opts.employeeId);
  if (opts.pendingOnly) q = q.eq('status', 'pending');
  return ((await q.limit(300)).data ?? []) as LeaveRequest[];
};

export const countLeaveDays = async (
  employeeId: string, from: string, to: string, fromHalf: boolean, toHalf: boolean,
): Promise<number> =>
  Number(unwrap(await supabase.rpc('hr_count_leave_days', {
    p_employee_id: employeeId, p_from: from, p_to: to,
    p_from_half: fromHalf, p_to_half: toHalf,
  })) ?? 0);

export const applyLeave = async (row: Partial<LeaveRequest>) =>
  unwrap(await supabase.from('hr_leave_requests').insert(row as never).select().single());

export const decideLeave = async (id: string, approve: boolean, note: string) =>
  unwrap(await supabase.rpc('hr_decide_leave', { p_request_id: id, p_approve: approve, p_note: note }));

export const cancelLeave = async (id: string, reason: string) =>
  unwrap(await supabase.rpc('hr_cancel_leave', { p_request_id: id, p_reason: reason }));

export const listHolidays = async (year: number): Promise<Holiday[]> =>
  (await supabase.from('hr_holidays').select('*')
    .gte('holiday_date', `${year}-01-01`).lte('holiday_date', `${year}-12-31`)
    .order('holiday_date')).data ?? [];

export const saveHoliday = async (id: string | null, row: Partial<Holiday>) =>
  id
    ? unwrap(await supabase.from('hr_holidays').update(row).eq('id', id).select().single())
    : unwrap(await supabase.from('hr_holidays').insert(row as never).select().single());

export const deleteHoliday = async (id: string) => {
  const { error } = await supabase.from('hr_holidays').delete().eq('id', id);
  if (error) throw error;
};

// ===========================================================================
// Employees
// ===========================================================================

/**
 * @param includeInactive  include employees whose CRM record is not active
 * @param payrollOnly      exclude partners and anyone else not on payroll.
 *                         Used by every screen that iterates people for pay or
 *                         attendance, so "not salaried" is stated once.
 */
export async function listHREmployees(
  includeInactive = false, payrollOnly = false,
): Promise<HREmployee[]> {
  let q = supabase.from('nw_employees')
    .select('id, employee_code, full_name, email, phone, role, designation, avatar_url, status, joining_date')
    .order('employee_code');
  if (!includeInactive) q = q.eq('status', 'active');

  const employees = (await q).data ?? [];
  const ids = employees.map(e => e.id);
  if (ids.length === 0) return [];

  const [{ data: profiles }, { data: banks }] = await Promise.all([
    supabase.from('hr_employee_profiles').select('*').in('employee_id', ids),
    supabase.from('hr_employee_bank_accounts').select('*').in('employee_id', ids).eq('is_primary', true).eq('active', true),
  ]);

  const rows = employees.map(e => ({
    ...e,
    profile: (profiles ?? []).find(p => p.employee_id === e.id) ?? null,
    bank: (banks ?? []).find(b => b.employee_id === e.id) ?? null,
  })) as HREmployee[];

  // A missing profile counts as on payroll: a new hire is salaried until
  // someone says otherwise, and defaulting the other way would quietly drop
  // them out of their first payroll run.
  return payrollOnly ? rows.filter(r => r.profile?.on_payroll ?? true) : rows;
}

export const saveProfile = async (employeeId: string, patch: Partial<EmployeeProfile>) =>
  unwrap(await supabase.from('hr_employee_profiles')
    .upsert({ employee_id: employeeId, ...patch } as never, { onConflict: 'employee_id' })
    .select().single());

export const listBankAccounts = async (employeeId: string): Promise<BankAccount[]> =>
  (await supabase.from('hr_employee_bank_accounts').select('*').eq('employee_id', employeeId)).data ?? [];

export const saveBankAccount = async (id: string | null, row: Partial<BankAccount>) =>
  id
    ? unwrap(await supabase.from('hr_employee_bank_accounts').update(row).eq('id', id).select().single())
    : unwrap(await supabase.from('hr_employee_bank_accounts').insert(row as never).select().single());

// ===========================================================================
// Salary
// ===========================================================================

export const listComponents = async (activeOnly = false): Promise<SalaryComponentRow[]> => {
  let q = supabase.from('hr_salary_components').select('*').order('kind').order('sort_order');
  if (activeOnly) q = q.eq('active', true);
  return (await q).data ?? [];
};

export const listComponentSlabs = async (): Promise<ComponentSlabRow[]> =>
  (await supabase.from('hr_salary_component_slabs').select('*').order('from_amount')).data ?? [];

export const saveComponent = async (id: string | null, row: Partial<SalaryComponentRow>) =>
  id
    ? unwrap(await supabase.from('hr_salary_components').update(row).eq('id', id).select().single())
    : unwrap(await supabase.from('hr_salary_components').insert(row as never).select().single());

export const listStructures = async (employeeId?: string): Promise<SalaryStructureRow[]> => {
  let q = supabase.from('hr_salary_structures').select('*').order('effective_from', { ascending: false });
  if (employeeId) q = q.eq('employee_id', employeeId);
  return (await q).data ?? [];
};

export const listStructureLines = async (structureIds: string[]): Promise<StructureLineRow[]> => {
  if (structureIds.length === 0) return [];
  return (await supabase.from('hr_salary_structure_lines').select('*').in('structure_id', structureIds)).data ?? [];
};

export async function createStructure(
  header: Partial<SalaryStructureRow>,
  lines: Partial<StructureLineRow>[],
): Promise<SalaryStructureRow> {
  const created = unwrap(await supabase.from('hr_salary_structures').insert(header as never).select().single());
  if (lines.length) {
    const { error } = await supabase.from('hr_salary_structure_lines')
      .insert(lines.map(l => ({ ...l, structure_id: created.id })) as never);
    if (error) {
      // Leave no half-built structure behind: a header with no lines would
      // compute a zero payslip rather than refuse.
      await supabase.from('hr_salary_structures').delete().eq('id', created.id);
      throw error;
    }
  }
  return created;
}

// ===========================================================================
// Payroll
// ===========================================================================

export const listRuns = async (): Promise<PayrollRun[]> =>
  (await supabase.from('hr_payroll_runs').select('*')
    .order('period_year', { ascending: false }).order('period_month', { ascending: false }).limit(60)).data ?? [];

export const getRun = async (id: string): Promise<PayrollRun | null> =>
  (await supabase.from('hr_payroll_runs').select('*').eq('id', id).maybeSingle()).data;

export const openRun = async (year: number, month: number, payScheduleId: string | null): Promise<string> =>
  unwrap(await supabase.rpc('hr_payroll_open_run', {
    p_year: year, p_month: month,
    // NULL means "the default pay schedule" -- see hr_payroll_open_run.
    p_pay_schedule_id: payScheduleId as unknown as string,
  })) as string;

export const writeRunRecords = async (runId: string, payload: unknown) =>
  unwrap(await supabase.rpc('hr_payroll_write_records', { p_run_id: runId, p_payload: payload as never }));

export const approveRun    = (id: string, note: string) => supabase.rpc('hr_payroll_approve', { p_run_id: id, p_note: note }).then(unwrap);
export const lockRun       = (id: string)               => supabase.rpc('hr_payroll_lock', { p_run_id: id }).then(unwrap);
export const reopenRun     = (id: string, reason: string) => supabase.rpc('hr_payroll_reopen', { p_run_id: id, p_reason: reason }).then(unwrap);
// NULL payment date means "today in IST", resolved server-side.
export const markRunPaid   = (id: string, date: string | null) => supabase.rpc('hr_payroll_mark_paid', { p_run_id: id, p_payment_date: date as unknown as string }).then(unwrap);
export const publishPayslips = (id: string)             => supabase.rpc('hr_publish_payslips', { p_run_id: id }).then(unwrap);

export const listRunRecords = async (runId: string): Promise<PayrollRecord[]> =>
  (await supabase.from('hr_payroll_employee_records').select('*').eq('run_id', runId).order('employee_code')).data ?? [];

export const listRunLines = async (runId: string): Promise<PayrollLineRow[]> => {
  const records = await listRunRecords(runId);
  if (records.length === 0) return [];
  return (await supabase.from('hr_payroll_lines').select('*')
    .in('record_id', records.map(r => r.id)).order('sort_order')).data ?? [];
};

export const listRecordLines = async (recordId: string): Promise<PayrollLineRow[]> =>
  (await supabase.from('hr_payroll_lines').select('*').eq('record_id', recordId).order('sort_order')).data ?? [];

export const listRunEvents = async (runId: string): Promise<PayrollEvent[]> =>
  (await supabase.from('hr_payroll_events').select('*').eq('run_id', runId).order('created_at', { ascending: false })).data ?? [];

export const listRunAdjustments = async (runId: string): Promise<PayrollAdjustmentRow[]> =>
  (await supabase.from('hr_payroll_adjustments').select('*').eq('run_id', runId)).data ?? [];

export const saveRunAdjustment = async (row: Partial<PayrollAdjustmentRow>) =>
  unwrap(await supabase.from('hr_payroll_adjustments').insert(row as never).select().single());

export const deleteRunAdjustment = async (id: string) => {
  const { error } = await supabase.from('hr_payroll_adjustments').delete().eq('id', id);
  if (error) throw error;
};

// ===========================================================================
// Bank templates & payment files
// ===========================================================================

export const listBankTemplates = async (): Promise<BankTemplateRow[]> =>
  (await supabase.from('hr_bank_payment_templates').select('*').order('name')).data ?? [];

export const listTemplateColumns = async (templateId: string): Promise<BankTemplateColumn[]> =>
  (await supabase.from('hr_bank_payment_template_columns').select('*')
    .eq('template_id', templateId).order('position')).data ?? [];

export const saveBankTemplate = async (id: string | null, row: Partial<BankTemplateRow>) =>
  id
    ? unwrap(await supabase.from('hr_bank_payment_templates').update(row).eq('id', id).select().single())
    : unwrap(await supabase.from('hr_bank_payment_templates').insert(row as never).select().single());

export async function replaceTemplateColumns(templateId: string, columns: Partial<BankTemplateColumn>[]) {
  const { error: delErr } = await supabase.from('hr_bank_payment_template_columns')
    .delete().eq('template_id', templateId);
  if (delErr) throw delErr;
  if (columns.length === 0) return;
  const { error } = await supabase.from('hr_bank_payment_template_columns')
    .insert(columns.map((c, i) => ({ ...c, template_id: templateId, position: i + 1 })) as never);
  if (error) throw error;
}

export const recordPaymentFile = async (row: Partial<import('./hrTypes').PaymentFile>) =>
  unwrap(await supabase.from('hr_payroll_payment_files').insert(row as never).select().single());

export const listPaymentFiles = async (runId: string) =>
  (await supabase.from('hr_payroll_payment_files').select('*').eq('run_id', runId)
    .order('generated_at', { ascending: false })).data ?? [];

// ===========================================================================
// Payslips
// ===========================================================================

export const listPayslips = async (opts: { runId?: string; employeeId?: string } = {}): Promise<Payslip[]> => {
  let q = supabase.from('hr_payslips').select('*')
    .order('period_year', { ascending: false }).order('period_month', { ascending: false });
  if (opts.runId) q = q.eq('run_id', opts.runId);
  if (opts.employeeId) q = q.eq('employee_id', opts.employeeId);
  return (await q).data ?? [];
};

export const listMyPayrollRecords = async (employeeId: string): Promise<PayrollRecord[]> =>
  (await supabase.from('hr_payroll_employee_records').select('*')
    .eq('employee_id', employeeId).order('created_at', { ascending: false })).data ?? [];

// ===========================================================================
// Audit
// ===========================================================================

export const listAuditLogs = async (entity?: string, limit = 200): Promise<AuditLog[]> => {
  let q = supabase.from('hr_audit_logs').select('*').order('created_at', { ascending: false }).limit(limit);
  if (entity) q = q.eq('entity', entity);
  return (await q).data ?? [];
};
