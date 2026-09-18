/**
 * Data gathering for the Incentive tool.
 *
 * Nothing here calculates an incentive — that is shared/incentive/incentiveEngine.ts.
 * This file only assembles the engine's inputs for a month:
 *
 *   revenue  the MIS engine (computeMisRows), so the figure matches the MIS
 *            report and the team card to the rupee;
 *   salary   hr_salary_structures.gross_monthly in force during the month —
 *            the same basis the team card divides by;
 *   volumes  buy-side business per product from nw_transactions, by txn_date.
 *
 * SIP is not stored anywhere in the CRM (SIPs live on the BSE side and are not
 * mirrored into Supabase), and MF buys cannot be told apart from SIP instalments,
 * so SIP is always a manual figure entered by admin.
 */
import { supabase } from '../../lib/supabase';
import type { Json } from '../../lib/database.types';
import type { NWClient } from '../types';
import { computeMisRows, monthRange, sumRevenueByEmployee, loadGrossMonthlyByEmployee } from '../misRevenue';
import {
  parseIncentiveConfig, periodKey,
  type IncentiveConfig, type IncentiveResult, type ProductVolumes,
} from '../../../shared/incentive/incentiveEngine';

export interface PlanVersion {
  id: string;
  effective_from: string;
  config: IncentiveConfig;
  note: string;
  created_at: string;
}

export interface IncentiveStatement {
  id: string;
  employee_id: string;
  period_month: string;
  plan_version_id: string | null;
  salary: number;
  revenue_auto: number;
  revenue_override: number | null;
  volumes_auto: ProductVolumes;
  volumes_manual: ProductVolumes;
  result: Partial<IncentiveResult>;
  computed_amount: number;
  amount_override: number | null;
  override_reason: string;
  final_amount: number;
  status: 'draft' | 'approved';
  approved_at: string | null;
  payroll_run_id: string | null;
  payroll_adjustment_id: string | null;
  updated_at: string;
}

export interface MonthInputs {
  salary: number;
  revenue: number;
  volumesAuto: ProductVolumes;
}

/** Which products the CRM can fill automatically. Everything else is manual. */
export const AUTO_PRODUCT_KEYS = new Set(['mf', 'bond_fd', 'unlisted', 'insurance']);

const PAYMENTS_PER_YEAR: Record<string, number> = {
  monthly: 12, quarterly: 4, halfyearly: 2, annual: 1, single: 1,
};

const toNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

function toVolumes(j: unknown): ProductVolumes {
  const out: ProductVolumes = {};
  if (j && typeof j === 'object' && !Array.isArray(j)) {
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      if (v === null || v === '' || v === undefined) continue;
      const n = Number(v);
      if (Number.isFinite(n)) out[k] = n;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Structure versions
// ---------------------------------------------------------------------------

export async function loadPlanVersions(): Promise<PlanVersion[]> {
  const { data, error } = await supabase
    .from('inc_plan_versions')
    .select('id, effective_from, config, note, created_at')
    .order('effective_from', { ascending: false })
    .order('created_at', { ascending: false });
  if (error) throw error;
  const out: PlanVersion[] = [];
  for (const r of data ?? []) {
    const parsed = parseIncentiveConfig(r.config);
    // An unparseable version is skipped rather than guessed at; the admin
    // screen refuses to save one, so this only guards hand-edited rows.
    if (parsed.ok) out.push({ id: r.id, effective_from: r.effective_from, config: parsed.config, note: r.note, created_at: r.created_at });
  }
  return out;
}

/** The version in force for a month: latest effective_from ≤ month, newest first on ties. */
export function planForMonth(versions: PlanVersion[], period: string): PlanVersion | null {
  // `versions` is already sorted effective_from DESC, created_at DESC.
  return versions.find(v => v.effective_from <= period) ?? null;
}

export async function createPlanVersion(effectiveFrom: string, config: IncentiveConfig, note: string): Promise<string> {
  const { data, error } = await supabase.rpc('inc_create_plan_version', {
    p_effective_from: effectiveFrom, p_config: config as unknown as Json, p_note: note,
  });
  if (error) throw error;
  return data as string;
}

// ---------------------------------------------------------------------------
// Auto volumes
// ---------------------------------------------------------------------------

type VolClient = Pick<NWClient, 'id' | 'employee_id'>;

/** Buy-side business per owning employee for the month. */
export async function loadAutoVolumes(
  clients: VolClient[], startDate: string, endDate: string,
): Promise<Map<string, ProductVolumes>> {
  const owner = new Map(clients.map(c => [c.id, c.employee_id ?? null]));
  const ids = clients.map(c => c.id);
  const out = new Map<string, ProductVolumes>();
  // Chunked: an .in() over every client can outgrow a request URL.
  for (let i = 0; i < ids.length; i += 150) {
    const { data, error } = await supabase
      .from('nw_transactions')
      .select('client_id, product_type, txn_type, consolidated_amount, premium_amount, premium_frequency')
      .in('client_id', ids.slice(i, i + 150))
      .eq('txn_type', 'buy')
      .gte('txn_date', startDate)
      .lte('txn_date', endDate);
    if (error) throw error;
    for (const t of data ?? []) {
      const emp = owner.get(t.client_id);
      if (!emp) continue;
      const v = out.get(emp) ?? {};
      const add = (k: string, n: number) => { v[k] = (v[k] ?? 0) + n; };
      switch (t.product_type) {
        case 'mutual_fund':    add('mf', toNum(t.consolidated_amount)); break;
        case 'primary_bond':
        case 'secondary_bond':
        case 'fixed_deposit':  add('bond_fd', toNum(t.consolidated_amount)); break;
        case 'unlisted_share': add('unlisted', toNum(t.consolidated_amount)); break;
        case 'insurance': {
          const per = PAYMENTS_PER_YEAR[String(t.premium_frequency ?? 'annual')] ?? 1;
          add('insurance', toNum(t.premium_amount) * per);
          break;
        }
      }
      out.set(emp, v);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Month inputs
// ---------------------------------------------------------------------------

const CLIENT_COLS = 'id, full_name, client_code, employee_id, sourced_via';

/** One employee's month, under their own RLS (the tracker). */
export async function loadMyMonth(employeeId: string, year: number, month0: number): Promise<MonthInputs> {
  const { startDate, endDate } = monthRange(year, month0);
  const { data: clientData, error } = await supabase.from('nw_clients').select(CLIENT_COLS).eq('employee_id', employeeId);
  if (error) throw error;
  const clients = (clientData ?? []) as NWClient[];
  const [rows, gross, vols] = await Promise.all([
    computeMisRows(clients, startDate, endDate, year, month0),
    loadGrossMonthlyByEmployee(startDate, endDate, employeeId),
    loadAutoVolumes(clients, startDate, endDate),
  ]);
  return {
    salary: gross.get(employeeId) ?? 0,
    revenue: sumRevenueByEmployee(rows).get(employeeId)?.revenue ?? 0,
    volumesAuto: vols.get(employeeId) ?? {},
  };
}

/** Every employee's month (the admin board). Same engine, every client. */
export async function loadTeamMonth(year: number, month0: number): Promise<Map<string, MonthInputs>> {
  const { startDate, endDate } = monthRange(year, month0);
  const { data: clientData, error } = await supabase.from('nw_clients').select(CLIENT_COLS);
  if (error) throw error;
  const clients = (clientData ?? []) as NWClient[];
  const [rows, gross, vols] = await Promise.all([
    computeMisRows(clients, startDate, endDate, year, month0),
    loadGrossMonthlyByEmployee(startDate, endDate),
    loadAutoVolumes(clients, startDate, endDate),
  ]);
  const revenue = sumRevenueByEmployee(rows);
  const ids = new Set([...revenue.keys(), ...gross.keys(), ...vols.keys()]);
  const out = new Map<string, MonthInputs>();
  for (const id of ids) {
    out.set(id, {
      salary: gross.get(id) ?? 0,
      revenue: revenue.get(id)?.revenue ?? 0,
      volumesAuto: vols.get(id) ?? {},
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

function toStatement(r: Record<string, unknown>): IncentiveStatement {
  return {
    id: String(r.id),
    employee_id: String(r.employee_id),
    period_month: String(r.period_month),
    plan_version_id: (r.plan_version_id as string | null) ?? null,
    salary: toNum(r.salary),
    revenue_auto: toNum(r.revenue_auto),
    revenue_override: r.revenue_override === null || r.revenue_override === undefined ? null : toNum(r.revenue_override),
    volumes_auto: toVolumes(r.volumes_auto),
    volumes_manual: toVolumes(r.volumes_manual),
    result: (r.result ?? {}) as Partial<IncentiveResult>,
    computed_amount: toNum(r.computed_amount),
    amount_override: r.amount_override === null || r.amount_override === undefined ? null : toNum(r.amount_override),
    override_reason: String(r.override_reason ?? ''),
    final_amount: toNum(r.final_amount),
    status: r.status === 'approved' ? 'approved' : 'draft',
    approved_at: (r.approved_at as string | null) ?? null,
    payroll_run_id: (r.payroll_run_id as string | null) ?? null,
    payroll_adjustment_id: (r.payroll_adjustment_id as string | null) ?? null,
    updated_at: String(r.updated_at ?? ''),
  };
}

export async function loadStatementsForPeriod(period: string): Promise<IncentiveStatement[]> {
  const { data, error } = await supabase.from('inc_monthly_statements').select('*').eq('period_month', period);
  if (error) throw error;
  return (data ?? []).map(r => toStatement(r as Record<string, unknown>));
}

export async function loadMyStatements(employeeId: string): Promise<IncentiveStatement[]> {
  const { data, error } = await supabase.from('inc_monthly_statements').select('*')
    .eq('employee_id', employeeId).order('period_month', { ascending: false }).limit(24);
  if (error) throw error;
  return (data ?? []).map(r => toStatement(r as Record<string, unknown>));
}

export interface SaveStatementInput {
  employeeId: string;
  period: string;
  planVersionId: string | null;
  salary: number;
  revenueAuto: number;
  revenueOverride: number | null;
  volumesAuto: ProductVolumes;
  volumesManual: ProductVolumes;
  result: IncentiveResult;
  computedAmount: number;
  amountOverride: number | null;
  overrideReason: string;
}

export async function saveStatement(s: SaveStatementInput): Promise<string> {
  const { data, error } = await supabase.rpc('inc_save_statement', {
    p_employee_id: s.employeeId,
    p_period_month: s.period,
    p_plan_version_id: s.planVersionId as string,
    p_salary: s.salary,
    p_revenue_auto: s.revenueAuto,
    p_revenue_override: s.revenueOverride as number,
    p_volumes_auto: s.volumesAuto as unknown as Json,
    p_volumes_manual: s.volumesManual as unknown as Json,
    p_result: s.result as unknown as Json,
    p_computed_amount: s.computedAmount,
    p_amount_override: s.amountOverride as number,
    p_override_reason: s.overrideReason,
  });
  if (error) throw error;
  return data as string;
}

export async function approveStatements(ids: string[]): Promise<number> {
  const { data, error } = await supabase.rpc('inc_approve_statements', { p_ids: ids });
  if (error) throw error;
  return data as number;
}

export async function reopenStatement(id: string, reason: string): Promise<void> {
  const { error } = await supabase.rpc('inc_reopen_statement', { p_id: id, p_reason: reason });
  if (error) throw error;
}

export async function pushToPayroll(period: string, runId: string): Promise<number> {
  const { data, error } = await supabase.rpc('inc_push_to_payroll', { p_period_month: period, p_run_id: runId });
  if (error) throw error;
  return data as number;
}

/** The payroll run a revenue month is paid in, if it has been opened. */
export async function findPayrollRun(payYear: number, payMonth0: number) {
  const { data, error } = await supabase.from('hr_payroll_runs')
    .select('id, status, period_year, period_month')
    .eq('period_year', payYear).eq('period_month', payMonth0 + 1)
    .neq('status', 'cancelled')
    .order('created_at', { ascending: false }).limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

/** Approved, non-zero incentives for a revenue month not yet in any payroll run. */
export async function countPendingForPayroll(period: string): Promise<{ count: number; total: number }> {
  const { data, error } = await supabase.from('inc_monthly_statements')
    .select('final_amount').eq('period_month', period).eq('status', 'approved')
    .is('payroll_adjustment_id', null).gt('final_amount', 0);
  if (error) throw error;
  const rows = data ?? [];
  return { count: rows.length, total: rows.reduce((s, r) => s + toNum(r.final_amount), 0) };
}

export interface IncEvent {
  id: string; event: string; employee_id: string | null; period_month: string | null;
  actor_name: string; reason: string; before_value: unknown; after_value: unknown; created_at: string;
}

export async function loadEvents(limit = 200): Promise<IncEvent[]> {
  const { data, error } = await supabase.from('inc_events')
    .select('id, event, employee_id, period_month, actor_name, reason, before_value, after_value, created_at')
    .order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return (data ?? []) as IncEvent[];
}

export { periodKey };

/** Full-rupee Indian formatting for payroll figures (fmt() abbreviates to L/Cr). */
export const inr = (n: number): string =>
  `₹${Math.round(n).toLocaleString('en-IN')}`;

/** Revenue multiple, e.g. 5.62x. */
export const fmtX = (x: number): string => `${x.toFixed(2)}x`;

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export const monthLabel = (period: string): string => {
  const [y, m] = period.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
};
