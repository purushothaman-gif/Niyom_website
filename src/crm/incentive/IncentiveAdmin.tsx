/**
 * Incentive Admin — track every employee, override anything, change the
 * structure, approve, and send approved amounts into the next month's payroll.
 *
 * All figures come from the one engine (shared/incentive/incentiveEngine.ts).
 * Approval saves a full snapshot first, so what payroll pays is exactly what
 * the board showed at the moment of approval.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  RefreshCw, Download, CheckCheck, Send, Pencil, RotateCcw, Plus, Trash2, Save, History, Layers,
} from 'lucide-react';
import type { NWEmployee } from '../types';
import { supabase } from '../../lib/supabase';
import {
  computeIncentive, effectiveConfig, mergeVolumes, parseIncentiveConfig, payrollMonthFor, periodKey,
  DEFAULT_CONFIG_V1,
  type IncentiveConfig, type IncentiveResult, type ProductVolumes,
} from '../../../shared/incentive/incentiveEngine';
import {
  loadTeamMonth, loadStatementsForPeriod, loadPlanVersions, planForMonth, saveStatement,
  approveStatements, reopenStatement, pushToPayroll, findPayrollRun, loadEvents, createPlanVersion,
  loadMonthSetting, setMonthSetting, mandateFor, type MonthSetting,
  inr, fmtX, monthLabel, MONTHS, AUTO_PRODUCT_KEYS,
  type IncentiveStatement, type MonthInputs, type PlanVersion, type IncEvent,
} from './incentiveData';
import { Breakdown, ProductChecklist, SlabTable } from './IncentiveParts';
import {
  SectionCard, StatTile, Notice, Skeleton, Pill, Select, Input, Textarea, Field, Tabs, TableWrap,
  Drawer, ConfirmDialog, PrimaryButton, GhostButton, EmptyState,
} from '../hr/hrUi';
import { useToast } from '../hr/useToast';
import IncentiveCalculator, { type CalculatorPreset } from './IncentiveCalculator';
import { hrError } from '../hr/hrError';
import { isExcludedFromTeamCard } from '../misTeamImage';
import { exportSheet } from '../hr/hrExcel';

type Tab = 'board' | 'calculator' | 'structure' | 'audit';

interface Emp { id: string; full_name: string; employee_code: string; designation: string | null }

interface BoardRow {
  emp: Emp;
  statement: IncentiveStatement | null;
  plan: PlanVersion | null;
  /** The plan's config with this row's product mandate applied. */
  config: IncentiveConfig | null;
  productMandate: boolean;
  salary: number;
  revenueAuto: number;
  revenue: number;
  volumesAuto: ProductVolumes;
  volumesManual: ProductVolumes;
  result: IncentiveResult | null;
  payable: number;
}

const numOrNull = (s: string): number | null => {
  if (s.trim() === '') return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

export default function IncentiveAdmin({ employee }: { employee: NWEmployee }) {
  const [tab, setTab] = useState<Tab>('board');
  const toast = useToast();
  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';
  if (!isAdmin) {
    return <Notice tone="bad">Only administrators can open Incentive Admin.</Notice>;
  }
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Incentive Admin</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
          Review each employee's incentive, override where needed, approve, and send it to the next month's payroll.
        </p>
      </div>
      <Tabs<Tab> active={tab} onChange={setTab} tabs={[
        { key: 'board', label: 'Monthly board' },
        { key: 'calculator', label: 'Calculator' },
        { key: 'structure', label: 'Structure' },
        { key: 'audit', label: 'Audit log' },
      ]} />
      {tab === 'board' && <Board show={toast.show} />}
      {tab === 'structure' && <StructureEditor show={toast.show} />}
      {tab === 'calculator' && <AdminCalculator show={toast.show} />}
      {tab === 'audit' && <AuditLog />}
      {toast.node}
    </div>
  );
}

/* =========================================================== monthly board */

function Board({ show }: { show: (m: string, ok?: boolean) => void }) {
  const today = new Date();
  // Default to last month: that is the month whose incentive this month's payroll pays.
  const last = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const [year, setYear] = useState(last.getFullYear());
  const [month0, setMonth0] = useState(last.getMonth());
  const [emps, setEmps] = useState<Emp[]>([]);
  const [team, setTeam] = useState<Map<string, MonthInputs>>(new Map());
  const [statements, setStatements] = useState<IncentiveStatement[]>([]);
  const [versions, setVersions] = useState<PlanVersion[]>([]);
  const [run, setRun] = useState<{ id: string; status: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<BoardRow | null>(null);
  const [confirmPush, setConfirmPush] = useState(false);
  const [monthSetting, setMonthSettingState] = useState<MonthSetting | null>(null);
  const [mandateDialog, setMandateDialog] = useState<null | boolean>(null);
  const [mandateReason, setMandateReason] = useState('');

  const period = periodKey(year, month0);
  const pay = payrollMonthFor(period);
  const payLabel = `${MONTHS[pay.month0]} ${pay.year}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data: empData, error: empErr }, t, s, v, r, ms] = await Promise.all([
        supabase.from('nw_employees').select('id, full_name, employee_code, designation')
          .eq('status', 'active').neq('role', 'transfer_admin').order('full_name'),
        loadTeamMonth(year, month0),
        loadStatementsForPeriod(period),
        loadPlanVersions(),
        findPayrollRun(pay.year, pay.month0),
        loadMonthSetting(period),
      ]);
      if (empErr) throw empErr;
      setEmps(((empData ?? []) as Emp[]).filter(e => !isExcludedFromTeamCard(e)));
      setTeam(t); setStatements(s); setVersions(v); setRun(r); setMonthSettingState(ms);
      setSelected(new Set());
    } catch (e) {
      show(hrError(e, 'Could not load the board.'), false);
    } finally {
      setLoading(false);
    }
  }, [year, month0, period, pay.year, pay.month0, show]);

  useEffect(() => { load(); }, [load]);

  const rows: BoardRow[] = useMemo(() => {
    const monthPlan = planForMonth(versions, period);
    const byEmp = new Map(statements.map(s => [s.employee_id, s]));
    // Statements for someone no longer active still need to show.
    const extra = statements.filter(s => !emps.some(e => e.id === s.employee_id))
      .map(s => ({ id: s.employee_id, full_name: '(inactive employee)', employee_code: '', designation: null }));
    return [...emps, ...extra].map(emp => {
      const st = byEmp.get(emp.id) ?? null;
      const live = team.get(emp.id);
      const approved = st?.status === 'approved';
      // Approved months stay on the version they were frozen with; drafts follow the version in force.
      const plan = (approved && st?.plan_version_id && versions.find(v => v.id === st.plan_version_id)) || monthPlan;
      const salary = approved ? st!.salary : (live?.salary ?? 0);
      const revenueAuto = approved ? st!.revenue_auto : (live?.revenue ?? 0);
      const revenue = st?.revenue_override ?? revenueAuto;
      const volumesAuto = approved ? st!.volumes_auto : (live?.volumesAuto ?? {});
      const volumesManual = st?.volumes_manual ?? {};
      const productMandate = plan ? mandateFor(st, monthSetting, plan.config) : true;
      const config = plan ? effectiveConfig(plan.config, productMandate) : null;
      const result = config
        ? computeIncentive({ config, salary, revenue, volumes: mergeVolumes(volumesAuto, volumesManual) })
        : null;
      const payable = approved ? st!.final_amount : (st?.amount_override ?? result?.final ?? 0);
      return { emp, statement: st, plan, config, productMandate, salary, revenueAuto, revenue, volumesAuto, volumesManual, result, payable };
    });
  }, [emps, team, statements, versions, period, monthSetting]);

  const monthPlan = planForMonth(versions, period);
  const structureDefault = monthPlan?.config.rules.product_mandate ?? true;
  const mandateOn = monthSetting?.product_mandate ?? structureDefault;

  const applyMandate = async () => {
    if (mandateDialog === null) return;
    if (mandateReason.trim().length < 3) { show('Give a reason.', false); return; }
    setBusy(true);
    try {
      // Setting it back to the structure default clears the override rather
      // than pinning a value that would hide a later structure change.
      await setMonthSetting(period, mandateDialog === structureDefault ? null : mandateDialog, mandateReason.trim());
      show(`Multi-product requirement ${mandateDialog ? 'switched ON' : 'switched OFF'} for ${monthLabel(period)}.`);
      setMandateDialog(null); setMandateReason('');
      await load();
    } catch (e) {
      show(hrError(e, 'Could not change the product requirement.'), false);
    } finally {
      setBusy(false);
    }
  };

  const totals = useMemo(() => ({
    revenue: rows.reduce((s, r) => s + r.revenue, 0),
    payable: rows.reduce((s, r) => s + r.payable, 0),
    eligible: rows.filter(r => r.payable > 0).length,
    approved: rows.filter(r => r.statement?.status === 'approved').length,
    pendingPush: rows.filter(r => r.statement?.status === 'approved' && !r.statement.payroll_adjustment_id && r.payable > 0),
  }), [rows]);

  /** Save the row's CURRENT live figures as a draft (keeps manual inputs / overrides). */
  const snapshot = async (r: BoardRow, patch?: Partial<{ volumesManual: ProductVolumes; revenueOverride: number | null; amountOverride: number | null; reason: string }>) => {
    if (!r.plan || !r.config) throw new Error('No incentive structure is in force for this month.');
    const volumesManual = patch?.volumesManual ?? r.volumesManual;
    const revenueOverride = patch && 'revenueOverride' in patch ? patch.revenueOverride ?? null : r.statement?.revenue_override ?? null;
    const amountOverride = patch && 'amountOverride' in patch ? patch.amountOverride ?? null : r.statement?.amount_override ?? null;
    const reason = patch?.reason ?? r.statement?.override_reason ?? '';
    const result = computeIncentive({
      config: r.config, salary: r.salary,
      revenue: revenueOverride ?? r.revenueAuto,
      volumes: mergeVolumes(r.volumesAuto, volumesManual),
    });
    return saveStatement({
      employeeId: r.emp.id, period, planVersionId: r.plan.id, salary: r.salary,
      revenueAuto: r.revenueAuto, revenueOverride, volumesAuto: r.volumesAuto, volumesManual,
      result, computedAmount: result.final, amountOverride, overrideReason: reason,
      productMandate: r.productMandate,
    });
  };

  const approveSelected = async () => {
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const r of rows.filter(x => selected.has(x.emp.id) && x.statement?.status !== 'approved')) {
        ids.push(await snapshot(r));
      }
      const n = ids.length ? await approveStatements(ids) : 0;
      show(`${n} incentive${n === 1 ? '' : 's'} approved for ${monthLabel(period)}.`);
      await load();
    } catch (e) {
      show(hrError(e, 'Approval failed.'), false);
    } finally {
      setBusy(false);
    }
  };

  const doPush = async () => {
    if (!run) return;
    setBusy(true);
    try {
      const n = await pushToPayroll(period, run.id);
      show(n ? `${n} incentive${n === 1 ? '' : 's'} added to the ${payLabel} payroll. Recalculate the run to include them.`
             : 'Nothing new to send — every approved incentive is already in payroll.');
      setConfirmPush(false);
      await load();
    } catch (e) {
      show(hrError(e, 'Could not send to payroll.'), false);
    } finally {
      setBusy(false);
    }
  };

  const exportExcel = () => {
    const products = rows.find(r => r.plan)?.plan?.config.products ?? [];
    const header = ['Employee', 'Code', 'Salary', 'Revenue', 'X', 'Band', 'Eligible',
      ...products.map(p => p.label), 'Base', 'Add-on', 'OA bonus', 'Computed', 'Override', 'Payable', 'Status', 'Reason'];
    const body = rows.map(r => {
      const vols = mergeVolumes(r.volumesAuto, r.volumesManual);
      return [
        r.emp.full_name, r.emp.employee_code, r.salary, r.revenue,
        r.result ? +r.result.x.toFixed(2) : '', r.result?.band.label ?? '', r.result?.eligible ? 'Yes' : 'No',
        ...products.map(p => vols[p.key] ?? 0),
        r.result?.base ?? 0, r.result?.addon ?? 0, r.result?.oaBonus ?? 0, r.result?.final ?? 0,
        r.statement?.amount_override ?? '', r.payable,
        r.statement?.payroll_adjustment_id ? 'In payroll' : r.statement?.status ?? 'Not saved',
        r.statement?.override_reason ?? '',
      ];
    });
    exportSheet(`Incentive_${period.slice(0, 7)}`, 'Incentive', [header, ...body]);
  };

  const years = Array.from({ length: 3 }, (_, i) => today.getFullYear() - i);
  const selectable = rows.filter(r => r.statement?.status !== 'approved');
  const allSelected = selectable.length > 0 && selectable.every(r => selected.has(r.emp.id));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Select value={month0} onChange={e => setMonth0(Number(e.target.value))} style={{ width: 140 }}>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </Select>
          <Select value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 100 }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </Select>
          <button onClick={load} className="p-2.5 rounded-xl" title="Refresh"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <GhostButton onClick={exportExcel} disabled={loading}><Download className="w-4 h-4 inline mr-1.5" />Excel</GhostButton>
          <GhostButton onClick={approveSelected} disabled={busy || selected.size === 0}>
            <CheckCheck className="w-4 h-4 inline mr-1.5" />Approve selected ({selected.size})
          </GhostButton>
          <PrimaryButton onClick={() => setConfirmPush(true)} disabled={busy || totals.pendingPush.length === 0}>
            <Send className="w-4 h-4 inline mr-1.5" />Send to {payLabel} payroll ({totals.pendingPush.length})
          </PrimaryButton>
        </div>
      </div>

      <Notice tone="info">
        {monthLabel(period)} revenue is paid with the <b>{payLabel}</b> salary.{' '}
        {run ? <>The {payLabel} payroll run is <b>{run.status}</b>.</>
             : <>The {payLabel} payroll run is not open yet. Open it under HR &amp; Payroll → Payroll before sending.</>}
      </Notice>

      <div className="rounded-2xl px-4 py-3 flex items-center justify-between gap-3 flex-wrap"
        style={{ background: 'var(--bg-surface)', border: `1px solid ${mandateOn ? 'var(--border)' : 'rgba(245,158,11,0.4)'}` }}>
        <div className="flex items-start gap-3 min-w-0">
          <Layers className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: mandateOn ? 'var(--text-muted)' : 'rgb(245,158,11)' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Multi-product requirement for {monthLabel(period)}: {mandateOn ? 'ON' : 'OFF'}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {mandateOn
                ? 'Employees must meet the minimum on enough products to be eligible.'
                : 'Waived — eligibility rests on revenue alone. The over-achievement bonus still needs its products.'}
              {monthSetting ? ` Set for this month${monthSetting.reason ? ` — ${monthSetting.reason}` : ''}.` : ' (structure default)'}
              {' '}Approved rows keep the setting they were approved under.
            </p>
          </div>
        </div>
        <button type="button" role="switch" aria-checked={mandateOn} disabled={busy || !monthPlan}
          onClick={() => { setMandateReason(''); setMandateDialog(!mandateOn); }}
          className="relative inline-flex h-7 w-12 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
          style={{ background: mandateOn ? 'rgb(16,185,129)' : 'var(--bg-base)', border: '1px solid var(--border)' }}
          title={mandateOn ? 'Switch OFF for this month' : 'Switch ON for this month'}>
          <span className="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform"
            style={{ transform: mandateOn ? 'translateX(24px)' : 'translateX(3px)' }} />
        </button>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <StatTile label="Team revenue" value={inr(totals.revenue)} />
        <StatTile label="Eligible employees" value={`${totals.eligible} / ${rows.length}`} tone="accent" />
        <StatTile label="Total payable" value={inr(totals.payable)} tone="good" />
        <StatTile label="Approved" value={`${totals.approved} / ${rows.length}`} />
      </div>

      <SectionCard padded>
        {loading ? <Skeleton rows={6} /> : rows.length === 0 ? <EmptyState title="No employees" /> : (
          <TableWrap>
            <thead>
              <tr>
                <th><input type="checkbox" checked={allSelected} aria-label="Select all"
                  onChange={e => setSelected(e.target.checked ? new Set(selectable.map(r => r.emp.id)) : new Set())} /></th>
                <th className="text-left">Employee</th>
                <th className="text-right">Salary</th>
                <th className="text-right">Revenue</th>
                <th className="text-right">X</th>
                <th className="text-left">Band</th>
                <th className="text-center">Products</th>
                <th className="text-center">OA</th>
                <th className="text-right">Computed</th>
                <th className="text-right">Payable</th>
                <th className="text-left">Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const st = r.statement;
                const status = st?.payroll_adjustment_id ? 'in_payroll' : st?.status === 'approved' ? 'approved' : st ? 'draft' : 'not_saved';
                const overridden = st?.amount_override != null || st?.revenue_override != null || Object.keys(r.volumesManual).length > 0;
                return (
                  <tr key={r.emp.id}>
                    <td>
                      {st?.status !== 'approved' && (
                        <input type="checkbox" checked={selected.has(r.emp.id)} aria-label={`Select ${r.emp.full_name}`}
                          onChange={e => setSelected(prev => {
                            const n = new Set(prev); if (e.target.checked) n.add(r.emp.id); else n.delete(r.emp.id); return n;
                          })} />
                      )}
                    </td>
                    <td>
                      <p style={{ color: 'var(--text-primary)' }}>{r.emp.full_name}</p>
                      <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{r.emp.employee_code}</p>
                    </td>
                    <td className="text-right tabular-nums">{r.salary ? inr(r.salary) : <span style={{ color: 'rgb(239,68,68)' }}>—</span>}</td>
                    <td className="text-right tabular-nums">
                      {inr(r.revenue)}
                      {st?.revenue_override != null && <span className="block text-[10px]" style={{ color: 'rgb(245,158,11)' }}>overridden</span>}
                    </td>
                    <td className="text-right tabular-nums">{r.result ? fmtX(r.result.x) : '—'}</td>
                    <td>{r.result?.band.label ?? '—'}</td>
                    <td className="text-center tabular-nums" style={{ color: r.result && r.result.productsMet >= r.result.productsRequired ? 'rgb(16,185,129)' : 'var(--text-muted)' }}>
                      {r.result ? `${r.result.productsMet}/${r.result.productsRequired}` : '—'}
                    </td>
                    <td className="text-center tabular-nums" style={{ color: r.result?.oaQualified ? 'rgb(16,185,129)' : 'var(--text-muted)' }}>
                      {r.result ? `${r.result.oaMet}/${r.result.oaRequired}` : '—'}
                    </td>
                    <td className="text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>{inr(r.result?.final ?? 0)}</td>
                    <td className="text-right tabular-nums font-semibold" style={{ color: r.payable > 0 ? 'rgb(16,185,129)' : 'var(--text-faint)' }}>
                      {inr(r.payable)}
                      {overridden && <span className="block text-[10px] font-normal" style={{ color: 'rgb(245,158,11)' }}>admin input</span>}
                    </td>
                    <td><Pill small value={status} /></td>
                    <td>
                      <button onClick={() => setEditing(r)} className="p-1.5 rounded-lg" title="Open"
                        style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </SectionCard>

      {editing && (
        <EditDrawer
          row={editing} period={period}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            await snapshot(editing, patch);
            show(`Saved ${editing.emp.full_name}'s ${monthLabel(period)} figures.`);
            setEditing(null); await load();
          }}
          onReopen={async (reason) => {
            await reopenStatement(editing.statement!.id, reason);
            show('Reopened. It can be edited again.');
            setEditing(null); await load();
          }}
          show={show}
        />
      )}

      <ConfirmDialog open={confirmPush} tone="accent" busy={busy}
        title={`Send ${totals.pendingPush.length} incentive${totals.pendingPush.length === 1 ? '' : 's'} to ${payLabel} payroll?`}
        message={run
          ? `Total ${inr(totals.pendingPush.reduce((s, r) => s + r.payable, 0))} will be added as "Incentive" earnings in the ${payLabel} run. Recalculate the run afterwards.`
          : `The ${payLabel} payroll run is not open yet. Open it under HR & Payroll → Payroll first.`}
        confirmLabel="Send to payroll"
        onConfirm={run ? doPush : () => setConfirmPush(false)}
        onCancel={() => setConfirmPush(false)} />

      <ConfirmDialog open={mandateDialog !== null} tone="accent" busy={busy}
        title={`Switch the multi-product requirement ${mandateDialog ? 'ON' : 'OFF'} for ${monthLabel(period)}?`}
        message={mandateDialog
          ? 'Employees will again need the minimum on enough products to be eligible. Draft figures recalculate; approved rows are not changed.'
          : 'Eligibility will rest on revenue alone for this month. Draft figures recalculate; approved rows are not changed — reopen them to apply it.'}
        confirmLabel={mandateDialog ? 'Switch ON' : 'Switch OFF'}
        onConfirm={applyMandate} onCancel={() => setMandateDialog(null)}>
        <Field label="Reason" required>
          <Input value={mandateReason} onChange={e => setMandateReason(e.target.value)}
            placeholder="e.g. Festive month — revenue-only incentive" />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

/* ------------------------------------------------------------ edit drawer */

function EditDrawer({ row, period, onClose, onSave, onReopen, show }: {
  row: BoardRow; period: string;
  onClose: () => void;
  onSave: (patch: { volumesManual: ProductVolumes; revenueOverride: number | null; amountOverride: number | null; reason: string }) => Promise<void>;
  onReopen: (reason: string) => Promise<void>;
  show: (m: string, ok?: boolean) => void;
}) {
  const approved = row.statement?.status === 'approved';
  const products = row.plan?.config.products ?? [];
  const [manual, setManual] = useState<Record<string, string>>(
    Object.fromEntries(products.map(p => [p.key, row.volumesManual[p.key] != null ? String(row.volumesManual[p.key]) : ''])));
  const [revOverride, setRevOverride] = useState(row.statement?.revenue_override != null ? String(row.statement.revenue_override) : '');
  const [amtOverride, setAmtOverride] = useState(row.statement?.amount_override != null ? String(row.statement.amount_override) : '');
  const [reason, setReason] = useState(row.statement?.override_reason ?? '');
  const [reopenReason, setReopenReason] = useState('');
  const [saving, setSaving] = useState(false);

  const volumesManual: ProductVolumes = {};
  for (const [k, v] of Object.entries(manual)) { const n = numOrNull(v); if (n != null) volumesManual[k] = n; }
  const revenue = numOrNull(revOverride) ?? row.revenueAuto;
  const preview = row.config
    ? computeIncentive({ config: row.config, salary: row.salary, revenue, volumes: mergeVolumes(row.volumesAuto, volumesManual) })
    : null;
  const needsReason = numOrNull(revOverride) != null || numOrNull(amtOverride) != null;

  const save = async () => {
    if (needsReason && reason.trim().length < 3) { show('Give a reason for the override.', false); return; }
    setSaving(true);
    try {
      await onSave({ volumesManual, revenueOverride: numOrNull(revOverride), amountOverride: numOrNull(amtOverride), reason: reason.trim() });
    } catch (e) { show(hrError(e, 'Could not save.'), false); } finally { setSaving(false); }
  };
  const reopen = async () => {
    if (reopenReason.trim().length < 3) { show('Give a reason for reopening.', false); return; }
    setSaving(true);
    try { await onReopen(reopenReason.trim()); } catch (e) { show(hrError(e, 'Could not reopen.'), false); } finally { setSaving(false); }
  };

  return (
    <Drawer open onClose={onClose} title={row.emp.full_name}
      subtitle={`${monthLabel(period)} · salary ${inr(row.salary)} · MIS revenue ${inr(row.revenueAuto)}`}
      footer={approved ? (
        <div className="flex items-center gap-2 w-full">
          <Input placeholder="Reason for reopening" value={reopenReason} onChange={e => setReopenReason(e.target.value)} />
          <GhostButton onClick={reopen} disabled={saving || !!row.statement?.payroll_adjustment_id}>
            <RotateCcw className="w-4 h-4 inline mr-1.5" />Reopen
          </GhostButton>
        </div>
      ) : (
        <div className="flex justify-end gap-2 w-full">
          <GhostButton onClick={onClose}>Cancel</GhostButton>
          <PrimaryButton onClick={save} disabled={saving}><Save className="w-4 h-4 inline mr-1.5" />{saving ? 'Saving…' : 'Save draft'}</PrimaryButton>
        </div>
      )}>
      <div className="space-y-5">
        {approved && (
          <Notice tone="good">
            Approved{row.statement?.payroll_adjustment_id ? ' and in payroll — delete the line in the payroll run before reopening' : ''}. Reopen to change it.
          </Notice>
        )}
        {!row.salary && <Notice tone="warn">No active salary structure for this month, so no incentive can be calculated.</Notice>}

        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Product business this month</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {products.map(p => {
              const auto = row.volumesAuto[p.key];
              const isAuto = AUTO_PRODUCT_KEYS.has(p.key);
              return (
                <Field key={p.key} label={`${p.label} (${p.unit})`}
                  hint={isAuto ? `Auto from CRM: ${inr(auto ?? 0)} — leave blank to use it` : 'Not tracked in the CRM — enter manually'}>
                  <Input inputMode="decimal" disabled={approved} placeholder={isAuto ? String(Math.round(auto ?? 0)) : '0'}
                    value={manual[p.key] ?? ''} onChange={e => setManual(m => ({ ...m, [p.key]: e.target.value }))} />
                </Field>
              );
            })}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Revenue override" hint={`Blank = MIS revenue (${inr(row.revenueAuto)})`}>
            <Input inputMode="decimal" disabled={approved} value={revOverride} onChange={e => setRevOverride(e.target.value)} />
          </Field>
          <Field label="Payable amount override" hint="Blank = the calculated amount">
            <Input inputMode="decimal" disabled={approved} value={amtOverride} onChange={e => setAmtOverride(e.target.value)} />
          </Field>
        </div>
        <Field label="Reason" required={needsReason}>
          <Textarea rows={2} disabled={approved} value={reason} onChange={e => setReason(e.target.value)} />
        </Field>

        {preview && (
          <>
            <SectionCard title={`Calculated: ${inr(preview.final)}`}
              subtitle={`X ${fmtX(preview.x)} · band ${preview.band.label}${numOrNull(amtOverride) != null ? ` · payable set to ${inr(numOrNull(amtOverride)!)}` : ''}`}>
              <Breakdown result={preview} />
            </SectionCard>
            <SectionCard title="Product qualification">
              <ProductChecklist result={preview} manualKeys={new Set(Object.keys(volumesManual))} />
            </SectionCard>
          </>
        )}
      </div>
    </Drawer>
  );
}

/* ======================================================= structure editor */

const toPct = (f: number) => +(f * 100).toFixed(4);
const fromPct = (s: string) => (Number(s) || 0) / 100;

function StructureEditor({ show }: { show: (m: string, ok?: boolean) => void }) {
  const [versions, setVersions] = useState<PlanVersion[]>([]);
  const [draft, setDraft] = useState<IncentiveConfig | null>(null);
  const [basedOn, setBasedOn] = useState<PlanVersion | null>(null);
  const today = new Date();
  const [effYear, setEffYear] = useState(today.getFullYear());
  const [effMonth0, setEffMonth0] = useState(today.getMonth());
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const load = useCallback(async () => {
    try {
      const v = await loadPlanVersions();
      setVersions(v);
      const current = planForMonth(v, periodKey(today.getFullYear(), today.getMonth())) ?? v[0] ?? null;
      setBasedOn(current);
      setDraft(structuredClone(current?.config ?? DEFAULT_CONFIG_V1));
    } catch (e) { show(hrError(e, 'Could not load the structure.'), false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);
  useEffect(() => { load(); }, [load]);

  if (!draft) return <Skeleton rows={6} />;

  const parsed = parseIncentiveConfig(draft);
  const setBand = (i: number, k: keyof IncentiveConfig['bands'][number], v: string | number) =>
    setDraft(d => d && ({ ...d, bands: d.bands.map((b, j) => j === i ? { ...b, [k]: v } : b) }));
  const setProduct = (i: number, k: keyof IncentiveConfig['products'][number], v: string | number) =>
    setDraft(d => d && ({ ...d, products: d.products.map((p, j) => j === i ? { ...p, [k]: v } : p) }));
  const setRule = (k: keyof IncentiveConfig['rules'], v: number) =>
    setDraft(d => d && ({ ...d, rules: { ...d.rules, [k]: v } }));

  const effective = periodKey(effYear, effMonth0);
  const golden = parsed.ok
    ? computeIncentive({ config: parsed.config, salary: 40000, revenue: 880000, volumes: { mf: 1_000_000, sip: 25_000, bond_fd: 5_000_000 } })
    : null;

  const save = async () => {
    if (!parsed.ok) return;
    setSaving(true);
    try {
      await createPlanVersion(effective, parsed.config, note.trim());
      show(`New structure saved, effective from ${monthLabel(effective)}.`);
      setConfirm(false); setNote('');
      await load();
    } catch (e) { show(hrError(e, 'Could not save the structure.'), false); } finally { setSaving(false); }
  };

  const numCell = (value: number, onChange: (s: string) => void, width = 90) => (
    <Input type="number" step="any" value={value} onChange={e => onChange(e.target.value)} style={{ width, textAlign: 'right' }} />
  );

  return (
    <div className="space-y-4">
      <Notice tone="info">
        Changes never rewrite the past. Saving creates a new version from the month you choose; earlier months keep the
        structure they were calculated on, and approved months keep their frozen amounts.
        {basedOn && <> Editing a copy of the version from <b>{monthLabel(basedOn.effective_from)}</b>.</>}
      </Notice>

      <SectionCard title="Bands" subtitle="X = revenue ÷ monthly gross salary. Base is % of salary; add-on and OA bonus are % of revenue."
        actions={<GhostButton onClick={() => setDraft(d => d && ({ ...d, bands: [...d.bands, { lower_x: (d.bands[d.bands.length - 1]?.lower_x ?? 0) + 1, label: 'New band', note: '', base_mult: 0, addon_pct: 0, oa_pct: 0 }] }))}>
          <Plus className="w-4 h-4 inline mr-1" />Band</GhostButton>}>
        <TableWrap>
          <thead><tr><th className="text-left">From X</th><th className="text-left">Label</th><th className="text-right">Base % salary</th><th className="text-right">Add-on % rev</th><th className="text-right">OA % rev</th><th className="text-left">Note</th><th /></tr></thead>
          <tbody>
            {draft.bands.map((b, i) => (
              <tr key={i}>
                <td>{numCell(b.lower_x, s => setBand(i, 'lower_x', Number(s)), 80)}</td>
                <td><Input value={b.label} onChange={e => setBand(i, 'label', e.target.value)} style={{ width: 110 }} /></td>
                <td>{numCell(toPct(b.base_mult), s => setBand(i, 'base_mult', fromPct(s)))}</td>
                <td>{numCell(toPct(b.addon_pct), s => setBand(i, 'addon_pct', fromPct(s)))}</td>
                <td>{numCell(toPct(b.oa_pct), s => setBand(i, 'oa_pct', fromPct(s)))}</td>
                <td><Input value={b.note} onChange={e => setBand(i, 'note', e.target.value)} /></td>
                <td>
                  <button onClick={() => setDraft(d => d && ({ ...d, bands: d.bands.filter((_, j) => j !== i) }))}
                    className="p-1.5" title="Remove band" style={{ color: 'var(--text-faint)' }}><Trash2 className="w-3.5 h-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </SectionCard>

      <SectionCard title="Products" subtitle="Minimum threshold counts towards eligibility; OA threshold counts towards the over-achievement bonus."
        actions={<GhostButton onClick={() => setDraft(d => d && ({ ...d, products: [...d.products, { key: `custom_${Date.now().toString(36)}`, label: 'New product', unit: '₹', min_threshold: 0, oa_threshold: 0 }] }))}>
          <Plus className="w-4 h-4 inline mr-1" />Product</GhostButton>}>
        <TableWrap>
          <thead><tr><th className="text-left">Product</th><th className="text-left">Unit</th><th className="text-right">Minimum ₹</th><th className="text-right">OA ₹</th><th className="text-left">Source</th><th /></tr></thead>
          <tbody>
            {draft.products.map((p, i) => (
              <tr key={p.key}>
                <td><Input value={p.label} onChange={e => setProduct(i, 'label', e.target.value)} /></td>
                <td><Input value={p.unit} onChange={e => setProduct(i, 'unit', e.target.value)} style={{ width: 140 }} /></td>
                <td>{numCell(p.min_threshold, s => setProduct(i, 'min_threshold', Number(s)), 120)}</td>
                <td>{numCell(p.oa_threshold, s => setProduct(i, 'oa_threshold', Number(s)), 120)}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{AUTO_PRODUCT_KEYS.has(p.key) ? 'Auto + manual' : 'Manual'}</td>
                <td>
                  <button onClick={() => setDraft(d => d && ({ ...d, products: d.products.filter((_, j) => j !== i) }))}
                    className="p-1.5" title="Remove product" style={{ color: 'var(--text-faint)' }}><Trash2 className="w-3.5 h-3.5" /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </SectionCard>

      <SectionCard title="Rules">
        <label className="flex items-start gap-2.5 mb-4 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={draft.rules.product_mandate}
            onChange={e => setDraft(d => d && ({ ...d, rules: { ...d.rules, product_mandate: e.target.checked } }))} />
          <span>
            <span className="block text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Multi-product requirement ON by default</span>
            <span className="block text-xs" style={{ color: 'var(--text-muted)' }}>
              When off, eligibility rests on revenue alone. You can also switch it for a single month on the Monthly board.
            </span>
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Minimum X for any incentive">{numCell(draft.rules.min_x, s => setRule('min_x', Number(s)), 120)}</Field>
          <Field label="Product rule switches at X">{numCell(draft.rules.product_switch_x, s => setRule('product_switch_x', Number(s)), 120)}</Field>
          <Field label="Products needed below switch">{numCell(draft.rules.products_required_below_switch, s => setRule('products_required_below_switch', Number(s)), 120)}</Field>
          <Field label="Products needed at/above switch">{numCell(draft.rules.products_required_at_or_above_switch, s => setRule('products_required_at_or_above_switch', Number(s)), 120)}</Field>
          <Field label="Add-on paid above X">{numCell(draft.rules.addon_min_x, s => setRule('addon_min_x', Number(s)), 120)}</Field>
          <Field label="OA products needed">{numCell(draft.rules.oa_products_required, s => setRule('oa_products_required', Number(s)), 120)}</Field>
          <Field label="Cap (% of revenue)">{numCell(toPct(draft.rules.cap_pct_revenue), s => setRule('cap_pct_revenue', fromPct(s)), 120)}</Field>
        </div>
        <div className="mt-4">
          <Field label="Policy notes shown to employees (one per line)">
            <Textarea rows={5} value={draft.policy_notes.join('\n')}
              onChange={e => setDraft(d => d && ({ ...d, policy_notes: e.target.value.split('\n') }))} />
          </Field>
        </div>
      </SectionCard>

      {!parsed.ok && <Notice tone="bad" title="Fix before saving">{parsed.errors.join(' · ')}</Notice>}
      {golden && (
        <Notice tone="info" title="Check">
          Salary ₹40,000 · revenue ₹8,80,000 (X 22) · MF ₹10L, SIP ₹25k, Bond ₹50L → base {inr(golden.base)} + add-on {inr(golden.addon)} + OA {inr(golden.oaBonus)} = {inr(golden.gross)}, payable <b>{inr(golden.final)}</b>{golden.capped ? ' (capped)' : ''}.
        </Notice>
      )}

      <SectionCard title="Save as new version">
        <div className="grid gap-3 sm:grid-cols-[auto_auto_1fr_auto] items-end">
          <Field label="Effective from">
            <Select value={effMonth0} onChange={e => setEffMonth0(Number(e.target.value))} style={{ width: 140 }}>
              {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </Select>
          </Field>
          <Field label="Year">
            <Select value={effYear} onChange={e => setEffYear(Number(e.target.value))} style={{ width: 100 }}>
              {[today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </Select>
          </Field>
          <Field label="What changed" required>
            <Input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Raised SIP minimum to ₹5,000" />
          </Field>
          <PrimaryButton disabled={!parsed.ok || note.trim().length < 3 || saving} onClick={() => setConfirm(true)}>
            <Save className="w-4 h-4 inline mr-1.5" />Save version
          </PrimaryButton>
        </div>
      </SectionCard>

      <SectionCard title="Version history">
        <TableWrap>
          <thead><tr><th className="text-left">Effective from</th><th className="text-left">Note</th><th className="text-left">Saved</th><th /></tr></thead>
          <tbody>
            {versions.map(v => (
              <tr key={v.id}>
                <td>{monthLabel(v.effective_from)}</td>
                <td>{v.note}</td>
                <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{new Date(v.created_at).toLocaleString('en-IN')}</td>
                <td>
                  <GhostButton onClick={() => { setBasedOn(v); setDraft(structuredClone(v.config)); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                    <History className="w-4 h-4 inline mr-1" />Load
                  </GhostButton>
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        {basedOn && <div className="mt-4"><p className="text-xs font-bold mb-2" style={{ color: 'var(--text-secondary)' }}>Currently loaded: {monthLabel(basedOn.effective_from)}</p><SlabTable config={basedOn.config} /></div>}
      </SectionCard>

      <ConfirmDialog open={confirm} tone="accent" busy={saving}
        title={`Apply this structure from ${monthLabel(effective)}?`}
        message={`Every month from ${monthLabel(effective)} onwards that is not yet approved will be calculated on it. Approved months are not affected.`}
        confirmLabel="Save version" onConfirm={save} onCancel={() => setConfirm(false)} />
    </div>
  );
}

/* =========================================================== calculator */

/**
 * Admin what-if: blank, or seeded from any employee's live figures for a
 * month, against any structure version (handy before saving a new one).
 */
function AdminCalculator({ show }: { show: (m: string, ok?: boolean) => void }) {
  const today = new Date();
  const [versions, setVersions] = useState<PlanVersion[]>([]);
  const [versionId, setVersionId] = useState('');
  const [emps, setEmps] = useState<Emp[]>([]);
  const [empId, setEmpId] = useState('');
  const [month0, setMonth0] = useState(today.getMonth());
  const [year] = useState(today.getFullYear());
  const [preset, setPreset] = useState<CalculatorPreset | null>(null);
  const [loadingEmp, setLoadingEmp] = useState(false);

  useEffect(() => {
    Promise.all([
      loadPlanVersions(),
      supabase.from('nw_employees').select('id, full_name, employee_code, designation')
        .eq('status', 'active').neq('role', 'transfer_admin').order('full_name'),
    ]).then(([v, { data }]) => {
      setVersions(v);
      setVersionId(planForMonth(v, periodKey(today.getFullYear(), today.getMonth()))?.id ?? v[0]?.id ?? '');
      setEmps(((data ?? []) as Emp[]).filter(e => !isExcludedFromTeamCard(e)));
    }).catch(e => show(hrError(e, 'Could not load the calculator.'), false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  useEffect(() => {
    if (!empId) { setPreset(null); return; }
    setLoadingEmp(true);
    loadTeamMonth(year, month0)
      .then(team => {
        const m = team.get(empId);
        setPreset({ salary: m?.salary ?? 0, revenue: m?.revenue ?? 0, volumes: m?.volumesAuto ?? {} });
      })
      .catch(e => show(hrError(e, 'Could not load that employee.'), false))
      .finally(() => setLoadingEmp(false));
  }, [empId, month0, year, show]);

  const plan = versions.find(v => v.id === versionId) ?? null;
  const emp = emps.find(e => e.id === empId);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Structure version">
          <Select value={versionId} onChange={e => setVersionId(e.target.value)}>
            {versions.map(v => <option key={v.id} value={v.id}>From {monthLabel(v.effective_from)} — {v.note}</option>)}
          </Select>
        </Field>
        <Field label="Start from employee (optional)" hint={loadingEmp ? 'Loading figures…' : 'Blank = enter everything by hand'}>
          <Select value={empId} onChange={e => setEmpId(e.target.value)}>
            <option value="">— Blank —</option>
            {emps.map(e => <option key={e.id} value={e.id}>{e.full_name}</option>)}
          </Select>
        </Field>
        <Field label={`Month (${year})`}>
          <Select value={month0} disabled={!empId} onChange={e => setMonth0(Number(e.target.value))}>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </Select>
        </Field>
      </div>
      {plan
        ? <IncentiveCalculator config={plan.config} preset={preset}
            presetLabel={emp ? `Reset to ${emp.full_name}'s ${MONTHS[month0]} figures` : undefined} />
        : <Skeleton rows={4} />}
    </div>
  );
}

/* ================================================================ audit */

const EVENT_LABEL: Record<string, string> = {
  plan_version_created: 'Structure changed',
  statement_saved: 'Figures saved',
  approved: 'Approved',
  reopened: 'Reopened',
  pushed_to_payroll: 'Sent to payroll',
  removed_from_payroll: 'Removed from payroll',
  month_setting_changed: 'Product requirement switched',
};

function AuditLog() {
  const [events, setEvents] = useState<IncEvent[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    Promise.all([
      loadEvents(),
      supabase.from('nw_employees').select('id, full_name'),
    ]).then(([ev, { data }]) => {
      setEvents(ev);
      setNames(new Map((data ?? []).map(e => [e.id, e.full_name])));
    }).catch(() => setEvents([]));
  }, []);
  if (!events) return <Skeleton rows={6} />;
  if (events.length === 0) return <EmptyState title="Nothing recorded yet" />;
  const detail = (e: IncEvent) => {
    const a = (e.after_value ?? {}) as Record<string, unknown>;
    if (typeof a.final_amount === 'number' || typeof a.final_amount === 'string') return `Payable ${inr(Number(a.final_amount))}`;
    if (a.amount != null) return `${inr(Number(a.amount))}`;
    if (e.event === 'month_setting_changed') {
      return a.product_mandate === null || a.product_mandate === undefined
        ? 'Back to structure default'
        : `Multi-product requirement ${a.product_mandate ? 'ON' : 'OFF'}`;
    }
    return '';
  };
  return (
    <SectionCard padded>
      <TableWrap>
        <thead><tr><th className="text-left">When</th><th className="text-left">Event</th><th className="text-left">Employee</th><th className="text-left">Month</th><th className="text-left">Detail</th><th className="text-left">By</th><th className="text-left">Reason</th></tr></thead>
        <tbody>
          {events.map(e => (
            <tr key={e.id}>
              <td className="text-xs whitespace-nowrap">{new Date(e.created_at).toLocaleString('en-IN')}</td>
              <td>{EVENT_LABEL[e.event] ?? e.event}</td>
              <td>{e.employee_id ? names.get(e.employee_id) ?? '—' : '—'}</td>
              <td>{e.period_month ? monthLabel(e.period_month) : '—'}</td>
              <td className="tabular-nums">{detail(e)}</td>
              <td>{e.actor_name || '—'}</td>
              <td className="text-xs" style={{ color: 'var(--text-muted)' }}>{e.reason}</td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </SectionCard>
  );
}
