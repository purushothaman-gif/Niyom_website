/**
 * Monthly payroll: open a run, compute it, review it, approve, lock, generate
 * the bank file, publish payslips.
 *
 * WHERE THE ARITHMETIC LIVES. The engine runs here, in the browser, because the
 * reviewer needs to see figures change as they add an adjustment or fix a
 * structure. It is NOT trusted: hr_payroll_write_records() re-derives every
 * total from the lines that were submitted and refuses the payload if gross,
 * deductions, employer contributions or net do not close. A tampered request
 * fails; it does not overpay.
 *
 * WHY LOCKING MATTERS. Locking freezes the attendance days behind the run --
 * hr_recompute_daily() then refuses to touch them -- so the register can never
 * drift away from payslips that have already been issued. Getting back out is
 * deliberately awkward: Reopen requires a reason, withdraws the payslips, and
 * records before/after in the audit trail.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, Download, FileSpreadsheet, FileText, Lock,
  Play, RefreshCw, Undo2, Wallet,
} from 'lucide-react';
import * as api from './hrApi';
import { hrError } from './hrError';
import {
  ConfirmDialog, Drawer, EmptyState, Field, GhostButton, Input, Modal, Notice,
  Pill, PrimaryButton, SectionCard, Select, Skeleton, StatTile, TableWrap, Textarea,
} from './hrUi';
import { useToast } from './useToast';
import type {
  BankTemplateColumn, BankTemplateRow, HRAccess, HREmployee, LopWaiver, PaySchedule,
  PayrollAdjustmentRow, PayrollEvent, PayrollLineRow, PayrollRecord, PayrollRun,
  SalaryComponentRow, SalaryStructureRow, StructureLineRow,
} from './hrTypes';
import { calculatePayroll, summariseRun } from '../../lib/hr/payrollEngine';
import { summariseAttendance, applyLopWaiver, type DailyRow } from '../../lib/hr/attendanceSummary';
import { buildBankFile, type BankTemplate } from '../../lib/hr/bankFile';
import type { PayrollResult } from '../../lib/hr/types';
import { toEngineComponent, toEngineStructure } from './engineMappers';
import { inr } from '../../lib/money';
import { exportWorkbook, periodStamp } from './hrExcel';

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleDateString('en-IN', { month: 'long' }));

const periodLabel = (r: PayrollRun) => `${MONTHS[r.period_month - 1]} ${r.period_year}`;

export default function PayrollAdmin({ employeeId, access }: { employeeId: string; access: HRAccess }) {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [schedules, setSchedules] = useState<PaySchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { show, node } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([api.listRuns(), api.listPaySchedules()]);
      setRuns(r); setSchedules(s);
    } catch (err) {
      show(hrError(err), false);
    } finally {
      setLoading(false);
    }
  }, [show]);

  useEffect(() => { load(); }, [load]);

  if (openRunId) {
    return (
      <>
        <PayrollWorkspace
          runId={openRunId}
          employeeId={employeeId}
          access={access}
          onBack={() => { setOpenRunId(null); load(); }}
          onToast={show}
        />
        {node}
      </>
    );
  }

  const draft = runs.find(r => r.status === 'draft');

  return (
    <div className="space-y-5">
      {draft && (
        <Notice tone="warn" title={`${periodLabel(draft)} payroll is ready to review`}>
          A draft was opened automatically on the last working day. Nothing has been calculated or paid yet —
          open it to compute, review and approve.{' '}
          <button onClick={() => setOpenRunId(draft.id)} className="underline font-semibold">Review payroll</button>
        </Notice>
      )}

      <SectionCard
        title="Payroll runs"
        subtitle="One run per month. Historical runs keep their own snapshot of salary, attendance and bank details."
        actions={access.canEdit.payroll && <PrimaryButton onClick={() => setCreating(true)}>
          <Play className="w-3.5 h-3.5 inline mr-1" />Start a Payroll Run
        </PrimaryButton>}
        padded={false}
      >
        <div className="p-5">
          {loading ? <Skeleton rows={5} /> : runs.length === 0 ? (
            <EmptyState icon={Wallet} title="No payroll runs yet"
              message="Start one for the current month, or wait for the automatic draft on the last working day." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className="text-left">Period</th><th className="text-left">Status</th>
                  <th className="text-right">Employees</th><th className="text-right">Gross</th>
                  <th className="text-right">Deductions</th><th className="text-right">Net Payable</th>
                  <th className="text-right"></th>
                </tr>
              </thead>
              <tbody>
                {runs.map(r => (
                  <tr key={r.id}>
                    <td className="font-semibold" style={{ color: 'var(--text-primary)' }}>{periodLabel(r)}</td>
                    <td>
                      <Pill value={r.status} kind="payroll" small />
                      {r.reopen_count > 0 && (
                        <span className="ml-1.5 text-xs" style={{ color: 'rgb(245,158,11)' }}>
                          reopened ×{r.reopen_count}
                        </span>
                      )}
                    </td>
                    <td className="text-right tabular-nums">{r.employee_count}</td>
                    <td className="text-right tabular-nums">{inr(Number(r.total_gross))}</td>
                    <td className="text-right tabular-nums">{inr(Number(r.total_deductions))}</td>
                    <td className="text-right tabular-nums font-bold" style={{ color: 'rgb(16,185,129)' }}>
                      {inr(Number(r.total_net))}
                    </td>
                    <td className="text-right">
                      <button onClick={() => setOpenRunId(r.id)} className="text-xs font-semibold"
                        style={{ color: 'var(--accent-soft)' }}>Open</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
      </SectionCard>

      {creating && (
        <NewRun
          schedules={schedules}
          existing={runs}
          onClose={() => setCreating(false)}
          onDone={id => { setCreating(false); setOpenRunId(id); }}
          onError={m => show(m, false)}
        />
      )}

      {node}
    </div>
  );
}

function NewRun({ schedules, existing, onClose, onDone, onError }: {
  schedules: PaySchedule[]; existing: PayrollRun[];
  onClose: () => void; onDone: (id: string) => void; onError: (m: string) => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [scheduleId, setScheduleId] = useState(schedules.find(s => s.is_default)?.id ?? '');
  const [busy, setBusy] = useState(false);

  const clash = existing.find(r => r.period_year === year && r.period_month === month);

  const go = async () => {
    setBusy(true);
    try {
      const id = await api.openRun(year, month, scheduleId || null);
      onDone(id);
    } catch (err) {
      onError(hrError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Start a payroll run">
      <div className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Month">
            <Select value={month} onChange={e => setMonth(Number(e.target.value))}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
          </Field>
          <Field label="Year">
            <Select value={year} onChange={e => setYear(Number(e.target.value))}>
              {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </Select>
          </Field>
        </div>
        <Field label="Pay schedule" hint="Decides the LOP divisor and the payment date.">
          <Select value={scheduleId} onChange={e => setScheduleId(e.target.value)}>
            {schedules.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        {clash && (
          <Notice tone="info">
            A run already exists for this period ({clash.status}). Opening it again will take you to the existing run
            rather than creating a second one.
          </Notice>
        )}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            Cancel
          </button>
          <PrimaryButton onClick={go} disabled={busy}>{busy ? 'Opening…' : 'Open Run'}</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

/* ======================================================================== */
/* Workspace                                                                 */
/* ======================================================================== */

interface Loaded {
  run: PayrollRun;
  records: PayrollRecord[];
  lines: PayrollLineRow[];
  events: PayrollEvent[];
  adjustments: PayrollAdjustmentRow[];
  staff: HREmployee[];
  components: SalaryComponentRow[];
  structures: SalaryStructureRow[];
  structureLines: StructureLineRow[];
  schedule: PaySchedule | null;
  waivers: LopWaiver[];
}

function PayrollWorkspace({ runId, employeeId, access, onBack, onToast }: {
  runId: string; employeeId: string; access: HRAccess;
  onBack: () => void; onToast: (m: string, ok?: boolean) => void;
}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [computing, setComputing] = useState(false);
  const [results, setResults] = useState<PayrollResult[] | null>(null);
  const [detailFor, setDetailFor] = useState<PayrollRecord | null>(null);
  const [detailLines, setDetailLines] = useState<PayrollLineRow[]>([]);
  const [confirm, setConfirm] = useState<'approve' | 'lock' | 'reopen' | 'paid' | 'publish' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [adjOpen, setAdjOpen] = useState(false);
  // Waiving LOP: the employee being edited, and whether "clear all" is pending.
  const [waiveFor, setWaiveFor] = useState<{ id: string; name: string; lop: number } | null>(null);
  const [waiveDays, setWaiveDays] = useState('');
  const [waiveReason, setWaiveReason] = useState('');
  const [clearAll, setClearAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const run = await api.getRun(runId);
      if (!run) { onToast('That payroll run no longer exists.', false); onBack(); return; }

      const [records, lines, events, adjustments, staff, components, structures, schedules, waivers] =
        await Promise.all([
          api.listRunRecords(runId), api.listRunLines(runId), api.listRunEvents(runId),
          api.listRunAdjustments(runId), api.listHREmployees(true, true), api.listComponents(true),
          api.listStructures(), api.listPaySchedules(), api.listLopWaivers(runId),
        ]);
      const structureLines = await api.listStructureLines(structures.map(s => s.id));

      setData({
        run, records, lines, events, adjustments, staff, components, structures, structureLines, waivers,
        schedule: schedules.find(s => s.id === run.pay_schedule_id) ?? schedules.find(s => s.is_default) ?? null,
      });
      setResults(null);
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setLoading(false);
    }
  }, [runId, onBack, onToast]);

  useEffect(() => { load(); }, [load]);

  /* ---- Waive loss of pay ------------------------------------------------- */

  /*
   * A waiver only changes stored figures once payroll is recalculated -- it is
   * an input, not an edit to the result. Rather than leave the run showing
   * numbers that no longer follow from its inputs, saving a waiver recalculates
   * immediately. Same on removal, which is what makes "remove and recalculate"
   * a single action instead of two the user has to remember to pair.
   */
  const saveWaiver = async () => {
    if (!waiveFor) return;
    const days = Number(waiveDays);
    if (!Number.isFinite(days) || days <= 0) { onToast('Enter how many days to waive.', false); return; }
    if (days > waiveFor.lop) {
      onToast(`${waiveFor.name} has ${waiveFor.lop} day(s) of loss of pay. You cannot waive more than that.`, false);
      return;
    }
    if (waiveReason.trim().length < 3) { onToast('Give a reason for the waiver.', false); return; }
    setBusy(true);
    try {
      await api.waiveLop(runId, waiveFor.id, days, waiveReason.trim());
      setWaiveFor(null); setWaiveDays(''); setWaiveReason('');
      await load();
      onToast('Loss of pay waived. Recalculating…');
      await compute();
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setBusy(false);
    }
  };

  const removeWaiver = async (employeeId?: string) => {
    setBusy(true);
    try {
      const n = await api.clearLopWaiver(runId, employeeId);
      setClearAll(false);
      await load();
      onToast(n === 0 ? 'There was nothing to remove.'
        : `${n} waiver${n === 1 ? '' : 's'} removed. Recalculating…`);
      if (n > 0) await compute();
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setBusy(false);
    }
  };

  /* ---- Compute ---------------------------------------------------------- */

  const compute = async () => {
    if (!data) return;
    setComputing(true);
    try {
      const { run, staff, components, structures, structureLines, adjustments, schedule, waivers } = data;
      /*
       * The waiver is applied to the attendance summary before anything reads
       * it, so the engine, the exceptions and the written record all see the
       * same month. applyLopWaiver caps at the LOP actually incurred, so a
       * waiver granted before attendance changed cannot overpay.
       */
      const waivedFor = (id: string) => Number(waivers.find(w => w.employee_id === id)?.days ?? 0);
      const engineComponents = components.map(c => toEngineComponent(c));
      const daily = await api.listDailyForRange(run.period_start, run.period_end);

      const computed: PayrollResult[] = [];
      for (const s of staff) {
        // Someone who left before the period started is simply not in this run.
        if (s.status !== 'active' && !s.profile?.exit_date) continue;
        if (s.profile?.exit_date && s.profile.exit_date < run.period_start) continue;
        if (s.joining_date && s.joining_date > run.period_end) continue;

        const mine = daily.filter(d => d.employee_id === s.id);
        const attendance = applyLopWaiver(
          summariseAttendance(mine as unknown as DailyRow[]), waivedFor(s.id));

        // The structure IN FORCE for this period -- not the newest one. This is
        // the whole reason a September raise leaves August alone.
        const structureRow = structures
          .filter(x => x.employee_id === s.id && x.status !== 'draft'
            && x.effective_from <= run.period_end
            && (x.effective_to === null || x.effective_to >= run.period_start))
          .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0] ?? null;

        computed.push(calculatePayroll({
          employee: {
            employee_id: s.id, employee_code: s.employee_code, full_name: s.full_name,
            designation: s.designation ?? '', department: s.profile?.department ?? '',
            joining_date: s.joining_date, exit_date: s.profile?.exit_date ?? null,
            pan: s.profile?.pan ?? null, uan: s.profile?.uan ?? null,
            bank_name: s.bank?.bank_name ?? '', bank_account: s.bank?.account_number ?? '',
            bank_ifsc: s.bank?.ifsc ?? '', account_holder: s.bank?.account_holder_name ?? s.full_name,
          },
          structure: structureRow ? toEngineStructure(structureRow, structureLines) : null,
          components: engineComponents,
          attendance,
          adjustments: adjustments.filter(a => a.employee_id === s.id).map(a => ({
            id: a.id, component_id: a.component_id, label: a.label,
            kind: a.kind as 'earning' | 'deduction' | 'employer_contribution',
            amount: Number(a.amount), prorate_on_lop: a.prorate_on_lop, taxable: a.taxable,
          })),
          period: {
            year: run.period_year, month: run.period_month,
            start_date: run.period_start, end_date: run.period_end,
          },
          rules: {
            lop_divisor_mode: (schedule?.lop_divisor_mode ?? run.lop_divisor_mode) as 'calendar_days',
            round_net_to_rupee: schedule?.round_net_to_rupee ?? true,
            // Must come from the schedule: computing a month here with paise
            // when the historical runs were settled in whole rupees would make
            // the same employee's payslips disagree month to month.
            round_components_to_rupee: schedule?.round_components_to_rupee ?? false,
          },
        }));
      }

      setResults(computed);

      // Write it. The server re-derives every total from these lines and
      // rejects the payload if the arithmetic does not close.
      const payload = {
        records: computed.map(r => {
          const s = staff.find(x => x.id === r.employee_id)!;
          const mine = daily.filter(d => d.employee_id === s.id);
          const att = applyLopWaiver(
            summariseAttendance(mine as unknown as DailyRow[]), waivedFor(s.id));
          return {
            employee_id: r.employee_id,
            structure_id: r.structure_id,
            employee_code: s.employee_code, full_name: s.full_name,
            designation: s.designation ?? '', department: s.profile?.department ?? '',
            joining_date: s.joining_date, pan: s.profile?.pan ?? null, uan: s.profile?.uan ?? null,
            bank_name: s.bank?.bank_name ?? '', bank_account: s.bank?.account_number ?? '',
            bank_ifsc: s.bank?.ifsc ?? '', account_holder: s.bank?.account_holder_name ?? s.full_name,
            calendar_days: att.calendar_days, working_days: att.working_days,
            present_days: att.present_days, paid_leave_days: att.paid_leave_days,
            unpaid_leave_days: att.unpaid_leave_days, holiday_days: att.holiday_days,
            weekly_off_days: att.weekly_off_days, absent_days: att.absent_days,
            lop_days: att.lop_days, payable_days: att.payable_days,
            lop_waived_days: att.lop_waived_days ?? 0, lop_divisor: r.lop_divisor,
            late_days: att.late_days, early_out_days: att.early_out_days,
            overtime_minutes: att.overtime_minutes,
            ctc_annual: r.ctc_annual, gross_earnings: r.gross_earnings,
            total_deductions: r.total_deductions, employer_contrib: r.employer_contrib,
            lop_amount: r.lop_amount, net_pay: r.net_pay,
            status: r.payable ? 'included' : 'excluded',
            exclusion_reason: r.payable ? '' : r.exceptions.filter(e => e.severity === 'blocker').map(e => e.message).join(' '),
            exceptions: r.exceptions,
            lines: r.lines,
          };
        }),
      };

      const res = await api.writeRunRecords(runId, payload) as { employees: number; net: number };
      onToast(`Payroll calculated for ${res.employees} employee(s).`);
      load();
    } catch (err) {
      onToast(hrError(err, 'Could not calculate payroll.'), false);
    } finally {
      setComputing(false);
    }
  };

  /* ---- Transitions ------------------------------------------------------ */

  const act = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm === 'approve')      await api.approveRun(runId, reason);
      else if (confirm === 'lock')    await api.lockRun(runId);
      else if (confirm === 'reopen')  await api.reopenRun(runId, reason);
      else if (confirm === 'paid')    await api.markRunPaid(runId, null);
      else if (confirm === 'publish') await api.publishPayslips(runId);

      onToast({
        approve: 'Payroll approved.',
        lock: 'Payroll locked. Attendance for this period is now frozen.',
        reopen: 'Payroll reopened. Payslips have been withdrawn until it is finalised again.',
        paid: 'Payroll marked as paid.',
        publish: 'Payslips published — employees have been notified.',
      }[confirm]);

      setConfirm(null); setReason('');
      load();
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (rec: PayrollRecord) => {
    setDetailFor(rec);
    setDetailLines(await api.listRecordLines(rec.id));
  };

  if (loading || !data) return <Skeleton rows={8} />;

  const { run, records } = data;
  const editable = ['draft', 'processing', 'review'].includes(run.status);
  const canEdit = access.canEdit.payroll;
  const isAdmin = access.isAdmin;

  const exceptions = records.filter(r => (r.exceptions as unknown[])?.length > 0);
  const blocked = records.filter(r => r.status !== 'included');
  const live = results ? summariseRun(results) : null;

  const exportRegister = () => {
    const lines = data.lines;
    const codes = Array.from(new Set(lines.map(l => l.component_code)));
    exportWorkbook(`niyom_salary_register_${periodStamp(run.period_year, run.period_month)}`, [
      {
        name: 'Salary Register',
        rows: [
          ['Employee ID', 'Name', 'Department', 'Payable Days', 'LOP Days',
           ...codes, 'Gross', 'Deductions', 'Employer Cost', 'Net Pay'],
          ...records.map(r => [
            r.employee_code, r.full_name, r.department,
            Number(r.payable_days), Number(r.lop_days),
            ...codes.map(c => {
              const l = lines.find(x => x.record_id === r.id && x.component_code === c);
              return l ? Number(l.amount) : 0;
            }),
            Number(r.gross_earnings), Number(r.total_deductions),
            Number(r.employer_contrib), Number(r.net_pay),
          ]),
        ],
      },
      {
        name: 'Exceptions',
        rows: [
          ['Employee ID', 'Name', 'Severity', 'Issue'],
          ...records.flatMap(r =>
            ((r.exceptions ?? []) as { severity: string; message: string }[])
              .map(e => [r.employee_code, r.full_name, e.severity, e.message])),
        ],
      },
    ]);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <button onClick={onBack} className="text-xs font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
            ← All payroll runs
          </button>
          <h3 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
            {periodLabel(run)} Payroll
          </h3>
          <p className="text-xs mt-0.5 flex items-center gap-2" style={{ color: 'var(--text-muted)' }}>
            <Pill value={run.status} kind="payroll" small />
            {run.period_start} → {run.period_end} · LOP divided by {run.lop_divisor_mode.replace(/_/g, ' ')}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {editable && canEdit && (
            <PrimaryButton onClick={compute} disabled={computing}>
              <RefreshCw className={`w-3.5 h-3.5 inline mr-1 ${computing ? 'animate-spin' : ''}`} />
              {computing ? 'Calculating…' : records.length ? 'Recalculate' : 'Calculate Payroll'}
            </PrimaryButton>
          )}
          {editable && canEdit && records.length > 0 && (
            <GhostButton onClick={() => setAdjOpen(true)}>Adjustments</GhostButton>
          )}
          {run.status === 'review' && isAdmin && (
            <GhostButton onClick={() => setConfirm('approve')}>
              <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />Approve
            </GhostButton>
          )}
          {run.status === 'approved' && isAdmin && (
            <GhostButton onClick={() => setConfirm('lock')}>
              <Lock className="w-3.5 h-3.5 inline mr-1" />Lock Payroll
            </GhostButton>
          )}
          {['locked', 'paid'].includes(run.status) && (
            <>
              <GhostButton onClick={() => setBankOpen(true)}>
                <FileSpreadsheet className="w-3.5 h-3.5 inline mr-1" />Bank File
              </GhostButton>
              {access.canEdit.payslips && (
                <GhostButton onClick={() => setConfirm('publish')}>
                  <FileText className="w-3.5 h-3.5 inline mr-1" />Publish Payslips
                </GhostButton>
              )}
            </>
          )}
          {run.status === 'locked' && isAdmin && (
            <GhostButton onClick={() => setConfirm('paid')}>Mark as Paid</GhostButton>
          )}
          {['approved', 'locked', 'paid'].includes(run.status) && isAdmin && (
            <GhostButton onClick={() => setConfirm('reopen')}>
              <Undo2 className="w-3.5 h-3.5 inline mr-1" />Reopen
            </GhostButton>
          )}
          {records.length > 0 && (
            <GhostButton onClick={exportRegister}><Download className="w-3.5 h-3.5 inline mr-1" />Register</GhostButton>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatTile label="Employees" value={live?.employee_count ?? run.employee_count} />
        <StatTile label="Gross Payroll" value={inr(live?.total_gross ?? Number(run.total_gross))} />
        <StatTile label="Deductions" value={inr(live?.total_deductions ?? Number(run.total_deductions))} tone="warn" />
        <StatTile label="Net Payable" value={inr(live?.total_net ?? Number(run.total_net))} tone="good" />
        <StatTile label="Employer Cost" value={inr(live?.total_employer ?? Number(run.total_employer))} />
      </div>

      {run.status === 'locked' && (
        <Notice tone="good" title="This payroll is locked">
          Attendance for {run.period_start} to {run.period_end} is frozen for everyone in this run, so the register can
          no longer drift away from the payslips. To change anything, reopen the run with a reason — that withdraws the
          payslips and records what changed.
        </Notice>
      )}

      {blocked.length > 0 && (
        <Notice tone="bad" title={`${blocked.length} employee(s) are excluded from this payroll`}>
          {blocked.map(b => `${b.full_name}: ${b.exclusion_reason}`).join(' · ')}
        </Notice>
      )}

      {exceptions.length > 0 && blocked.length === 0 && (
        <Notice tone="warn" title={`${exceptions.length} employee(s) need a look`}>
          Loss of pay, mid-month joiners and similar. Open a row to see the detail.
        </Notice>
      )}

      <SectionCard title="Payroll register" padded={false}>
        <div className="p-5">
          {records.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="Not calculated yet"
              message="Calculating pulls each employee's attendance for the period and the salary structure in force at the time."
              action={editable && canEdit ? <PrimaryButton onClick={compute} disabled={computing}>
                {computing ? 'Calculating…' : 'Calculate Payroll'}
              </PrimaryButton> : undefined}
            />
          ) : (
            <>
            {data.waivers.length > 0 && (
              <div className="mb-4 px-4 py-3 rounded-xl flex items-start justify-between gap-3 flex-wrap"
                style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)' }}>
                <div className="min-w-0">
                  <p className="text-xs font-semibold" style={{ color: 'rgb(59,130,246)' }}>
                    {data.waivers.length} employee{data.waivers.length === 1 ? ' has' : 's have'} loss of pay waived
                    {' '}({data.waivers.reduce((t, w) => t + Number(w.days), 0)} day
                    {data.waivers.reduce((t, w) => t + Number(w.days), 0) === 1 ? '' : 's'} in total)
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    These are decisions someone made by hand, not something the attendance produced. Every one is in
                    the audit trail below with its reason.
                  </p>
                </div>
                {editable && canEdit && (
                  <GhostButton onClick={() => setClearAll(true)} disabled={busy}>
                    Remove all &amp; recalculate
                  </GhostButton>
                )}
              </div>
            )}
            <TableWrap>
              <thead>
                <tr>
                  <th className="text-left">Employee</th><th className="text-right">Payable</th>
                  <th className="text-right">LOP</th><th className="text-right">Waived</th>
                  <th className="text-right">Gross</th>
                  <th className="text-right">Deductions</th><th className="text-right">Net Pay</th>
                  <th className="text-left">Flags</th><th className="text-right"></th>
                </tr>
              </thead>
              <tbody>
                {records.map(r => {
                  const excs = (r.exceptions ?? []) as { severity: string }[];
                  const blockers = excs.filter(e => e.severity === 'blocker').length;
                  const waiver = data.waivers.find(w => w.employee_id === r.employee_id);
                  const waived = Number(waiver?.days ?? 0);
                  // What could still be waived. lop_days on the record is already
                  // net of any waiver, so the two add back to the original LOP.
                  const remaining = Number(r.lop_days);
                  return (
                    <tr key={r.id} style={{ opacity: r.status === 'included' ? 1 : 0.6 }}>
                      <td>
                        <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{r.full_name}</p>
                        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{r.employee_code} · {r.department}</p>
                      </td>
                      <td className="text-right tabular-nums">{Number(r.payable_days)}</td>
                      <td className="text-right tabular-nums"
                        style={{ color: Number(r.lop_days) > 0 ? 'rgb(239,68,68)' : 'inherit' }}>
                        {Number(r.lop_days)}
                      </td>
                      <td className="text-right tabular-nums">
                        {waived > 0 ? (
                          <span title={waiver?.reason} style={{ color: 'rgb(59,130,246)' }}>{waived}</span>
                        ) : <span style={{ color: 'var(--text-faint)' }}>—</span>}
                      </td>
                      <td className="text-right tabular-nums">{inr(Number(r.gross_earnings), true)}</td>
                      <td className="text-right tabular-nums">{inr(Number(r.total_deductions), true)}</td>
                      <td className="text-right tabular-nums font-bold" style={{ color: 'rgb(16,185,129)' }}>
                        {inr(Number(r.net_pay))}
                      </td>
                      <td>
                        {r.status !== 'included' && <Pill value="excluded" small />}
                        {blockers > 0 && r.status === 'included' && (
                          <AlertTriangle className="w-3.5 h-3.5 inline" style={{ color: 'rgb(239,68,68)' }} />
                        )}
                      </td>
                      <td className="text-right whitespace-nowrap">
                        {editable && canEdit && (waived > 0 || remaining > 0) && (
                          <>
                            <button
                              onClick={() => {
                                setWaiveFor({ id: r.employee_id, name: r.full_name, lop: remaining + waived });
                                setWaiveDays(waived > 0 ? String(waived) : String(remaining));
                                setWaiveReason(waiver?.reason ?? '');
                              }}
                              className="text-xs font-semibold mr-3" style={{ color: 'rgb(59,130,246)' }}>
                              {waived > 0 ? 'Edit waiver' : 'Waive LOP'}
                            </button>
                            {waived > 0 && (
                              <button onClick={() => removeWaiver(r.employee_id)} disabled={busy}
                                className="text-xs font-semibold mr-3" style={{ color: 'rgb(239,68,68)' }}>
                                Remove
                              </button>
                            )}
                          </>
                        )}
                        <button onClick={() => openDetail(r)} className="text-xs font-semibold"
                          style={{ color: 'var(--accent-soft)' }}>Detail</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
            </>
          )}
        </div>
      </SectionCard>

      {waiveFor && (
        <Modal open onClose={() => setWaiveFor(null)} title={`Waive loss of pay — ${waiveFor.name}`}>
          <div className="p-5 space-y-4">
            <Notice tone="info">
              {waiveFor.name} has <strong>{waiveFor.lop} day(s)</strong> of loss of pay this period. Waiving days pays
              them as though those days were worked. It does not change the attendance record — the absence stays on
              the register, it simply stops costing money.
            </Notice>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Days to waive" required hint={`Up to ${waiveFor.lop}`}>
                <Input type="number" min={0.5} max={waiveFor.lop} step={0.5} value={waiveDays}
                  onChange={e => setWaiveDays(e.target.value)} />
              </Field>
              <div className="col-span-2">
                <Field label="Reason" required hint="Shown in the audit trail. Say why the absence is being forgiven.">
                  <Input value={waiveReason} onChange={e => setWaiveReason(e.target.value)}
                    placeholder="Approved emergency leave — no balance left" />
                </Field>
              </div>
            </div>

            <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
              Payroll is recalculated as soon as this is saved, so the figures in the table always follow from the
              inputs above them.
            </p>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setWaiveFor(null)} className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <PrimaryButton onClick={saveWaiver} disabled={busy}>
                {busy ? 'Saving…' : 'Waive & Recalculate'}
              </PrimaryButton>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={clearAll}
        title="Remove every loss-of-pay waiver on this run?"
        message="Each employee goes back to the loss of pay their attendance actually produced, and payroll is recalculated. The waivers and this removal both stay in the audit trail."
        confirmLabel="Remove all & recalculate"
        busy={busy}
        onCancel={() => setClearAll(false)}
        onConfirm={() => removeWaiver()}
      />

      {data.events.length > 0 && (
        <SectionCard title="Audit trail" subtitle="Every state change, with who did it and why.">
          <ol className="space-y-2">
            {data.events.map(e => (
              <li key={e.id} className="flex items-start gap-3 text-xs">
                <span className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ background: 'var(--accent-soft)' }} />
                <div>
                  <p style={{ color: 'var(--text-primary)' }}>
                    <strong>{e.event.replace(/_/g, ' ')}</strong>
                    {e.actor_name && <> by {e.actor_name}</>}
                    {' · '}
                    {new Date(e.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                  {e.reason && <p style={{ color: 'var(--text-faint)' }}>{e.reason}</p>}
                </div>
              </li>
            ))}
          </ol>
        </SectionCard>
      )}

      {detailFor && (
        <Drawer open onClose={() => setDetailFor(null)} title={detailFor.full_name}
          subtitle={`${detailFor.employee_code} · ${periodLabel(run)}`} width="max-w-2xl">
          <RecordDetail record={detailFor} lines={detailLines} />
        </Drawer>
      )}

      {bankOpen && (
        <BankFileDialog runId={runId} run={run} records={records} employeeId={employeeId}
          onClose={() => setBankOpen(false)} onToast={onToast} />
      )}

      {adjOpen && (
        <AdjustmentsDialog runId={runId} staff={data.staff} components={data.components}
          existing={data.adjustments} employeeId={employeeId}
          onClose={() => setAdjOpen(false)}
          onChanged={() => { setAdjOpen(false); load(); onToast('Adjustment saved. Recalculate to apply it.'); }}
          onError={m => onToast(m, false)} />
      )}

      <ConfirmDialog
        open={!!confirm}
        tone={confirm === 'reopen' ? 'bad' : 'accent'}
        busy={busy}
        title={{
          approve: 'Approve this payroll?',
          lock: 'Lock this payroll?',
          reopen: 'Reopen this finalised payroll?',
          paid: 'Mark this payroll as paid?',
          publish: 'Publish payslips to employees?',
        }[confirm ?? 'approve']}
        message={{
          approve: `${run.employee_count} employees, ${inr(Number(run.total_net))} net payable. Approving does not pay anyone — it confirms the figures are correct.`,
          lock: 'Locking freezes the attendance behind these figures so the register can no longer drift from the payslips. You can still generate the bank file and payslips afterwards.',
          reopen: 'This withdraws every payslip for the period, unfreezes the attendance, and records the change in the audit trail. Employees who already downloaded a payslip will have an out-of-date copy.',
          paid: 'This records that the transfer has been made. It does not move any money — the system only ever generates the bank file.',
          publish: 'Each employee will be notified and will be able to download their payslip.',
        }[confirm ?? 'approve']}
        confirmLabel={{ approve: 'Approve', lock: 'Lock Payroll', reopen: 'Reopen', paid: 'Mark Paid', publish: 'Publish' }[confirm ?? 'approve']}
        onCancel={() => { setConfirm(null); setReason(''); }}
        onConfirm={act}
      >
        {(confirm === 'reopen' || confirm === 'approve') && (
          <Field label={confirm === 'reopen' ? 'Reason (required)' : 'Note'} required={confirm === 'reopen'}>
            <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)}
              placeholder={confirm === 'reopen' ? 'Why is this payroll being reopened?' : ''} />
          </Field>
        )}
      </ConfirmDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ detail */

function RecordDetail({ record, lines }: { record: PayrollRecord; lines: PayrollLineRow[] }) {
  const earnings = lines.filter(l => l.kind === 'earning');
  const deductions = lines.filter(l => l.kind === 'deduction');
  const employer = lines.filter(l => l.kind === 'employer_contribution');
  const excs = (record.exceptions ?? []) as { severity: string; message: string }[];

  return (
    <div className="p-5 space-y-5">
      {excs.length > 0 && (
        <div className="space-y-2">
          {excs.map((e, i) => (
            <Notice key={i} tone={e.severity === 'blocker' ? 'bad' : e.severity === 'warning' ? 'warn' : 'info'}>
              {e.message}
            </Notice>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {[
          ['Calendar', record.calendar_days], ['Working', record.working_days],
          ['Present', record.present_days], ['Paid Leave', record.paid_leave_days],
          ['LOP', record.lop_days], ['Payable', record.payable_days],
          // Admin-facing, so the waiver is shown here. It is deliberately NOT
          // on the payslip: waiving means the day is paid as though worked.
          ...(Number(record.lop_waived_days ?? 0) > 0
            ? [['LOP Waived', record.lop_waived_days] as [string, number]] : []),
        ].map(([l, v]) => (
          <div key={String(l)} className="px-2.5 py-2 rounded-xl text-center"
            style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
            <p className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{l}</p>
            <p className="text-sm font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{Number(v)}</p>
          </div>
        ))}
      </div>

      <LineGroup title="Earnings" lines={earnings} total={Number(record.gross_earnings)} />
      <LineGroup title="Deductions" lines={deductions} total={Number(record.total_deductions)} />
      {employer.length > 0 && (
        <LineGroup title="Employer contributions (company cost, not deducted)" lines={employer}
          total={Number(record.employer_contrib)} />
      )}

      <div className="px-4 py-3.5 rounded-xl flex items-center justify-between"
        style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)' }}>
        <span className="text-xs font-bold uppercase tracking-wider" style={{ color: 'rgb(16,185,129)' }}>Net Pay</span>
        <span className="text-xl font-bold tabular-nums" style={{ color: 'rgb(16,185,129)' }}>
          {inr(Number(record.net_pay))}
        </span>
      </div>

      <div className="text-xs space-y-1" style={{ color: 'var(--text-faint)' }}>
        <p>Bank: {record.bank_name || '—'} · {record.bank_account ? `•••• ${record.bank_account.slice(-4)}` : 'no account'} · {record.bank_ifsc || '—'}</p>
        <p>These are the details as they stood when this run was calculated — a later change to the employee's bank
           account does not alter this record.</p>
      </div>
    </div>
  );
}

function LineGroup({ title, lines, total }: { title: string; lines: PayrollLineRow[]; total: number }) {
  if (lines.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>{title}</p>
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
        <table className="nw-table w-full text-sm">
          <tbody>
            {lines.map(l => (
              <tr key={l.id}>
                <td>
                  {l.component_name}
                  {l.prorated && (
                    <span className="ml-2 text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
                      pro-rated from {inr(Number(l.base_amount), true)}
                    </span>
                  )}
                </td>
                <td className="text-right tabular-nums font-semibold">{inr(Number(l.amount), true)}</td>
              </tr>
            ))}
            <tr style={{ borderTop: '1.5px solid var(--border)' }}>
              <td className="font-bold">Total</td>
              <td className="text-right tabular-nums font-bold">{inr(total, true)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- adjustments */

function AdjustmentsDialog({ runId, staff, components, existing, employeeId, onClose, onChanged, onError }: {
  runId: string; staff: HREmployee[]; components: SalaryComponentRow[];
  existing: PayrollAdjustmentRow[]; employeeId: string;
  onClose: () => void; onChanged: () => void; onError: (m: string) => void;
}) {
  const oneOff = components.filter(c => !c.is_recurring);
  const [empId, setEmpId] = useState(staff[0]?.id ?? '');
  const [componentId, setComponentId] = useState(oneOff[0]?.id ?? '');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('0');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const component = components.find(c => c.id === componentId);

  const add = async () => {
    if (!empId || !componentId) { onError('Choose an employee and a component.'); return; }
    if (Number(amount) <= 0) { onError('Enter an amount greater than zero.'); return; }
    setBusy(true);
    try {
      await api.saveRunAdjustment({
        run_id: runId, employee_id: empId, component_id: componentId,
        label: label.trim() || component?.name || 'Adjustment',
        kind: component?.kind ?? 'earning',
        amount: Number(amount),
        prorate_on_lop: false, taxable: component?.taxable ?? true,
        reason: reason.trim(), created_by: employeeId,
      });
      onChanged();
    } catch (err) {
      onError(hrError(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try { await api.deleteRunAdjustment(id); onChanged(); }
    catch (err) { onError(hrError(err)); }
  };

  return (
    <Modal open onClose={onClose} title="Payroll adjustments" width="max-w-2xl">
      <div className="p-5 space-y-4">
        <Notice tone="info">
          One-off amounts for this run only — bonus, incentive, overtime, a loan recovery. They are not part of the
          standing salary structure and do not carry into next month. Recalculate the run after adding one.
        </Notice>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Employee" required>
            <Select value={empId} onChange={e => setEmpId(e.target.value)}>
              {staff.filter(s => s.status === 'active').map(s => (
                <option key={s.id} value={s.id}>{s.full_name} ({s.employee_code})</option>
              ))}
            </Select>
          </Field>
          <Field label="Component" required>
            <Select value={componentId} onChange={e => setComponentId(e.target.value)}>
              {oneOff.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.kind === 'deduction' ? 'deduction' : c.kind === 'earning' ? 'earning' : 'employer'})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Label on the payslip">
            <Input value={label} onChange={e => setLabel(e.target.value)} placeholder={component?.name} />
          </Field>
          <Field label="Amount" required>
            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Reason" hint="Recorded in the audit trail.">
              <Input value={reason} onChange={e => setReason(e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="flex justify-end">
          <PrimaryButton onClick={add} disabled={busy}>{busy ? 'Adding…' : 'Add Adjustment'}</PrimaryButton>
        </div>

        {existing.length > 0 && (
          <TableWrap>
            <thead>
              <tr><th className="text-left">Employee</th><th className="text-left">Item</th>
                <th className="text-right">Amount</th><th className="text-right"></th></tr>
            </thead>
            <tbody>
              {existing.map(a => (
                <tr key={a.id}>
                  <td>{staff.find(s => s.id === a.employee_id)?.full_name ?? '—'}</td>
                  <td>{a.label} <span className="text-xs" style={{ color: 'var(--text-faint)' }}>({a.kind})</span></td>
                  <td className="text-right tabular-nums">{inr(Number(a.amount), true)}</td>
                  <td className="text-right">
                    <button onClick={() => remove(a.id)} className="text-xs font-semibold"
                      style={{ color: 'rgb(239,68,68)' }}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- bank file */

function BankFileDialog({ runId, run, records, employeeId, onClose, onToast }: {
  runId: string; run: PayrollRun; records: PayrollRecord[]; employeeId: string;
  onClose: () => void; onToast: (m: string, ok?: boolean) => void;
}) {
  const [templates, setTemplates] = useState<BankTemplateRow[]>([]);
  const [columns, setColumns] = useState<BankTemplateColumn[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [paymentDate, setPaymentDate] = useState(run.payment_date ?? new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listBankTemplates().then(t => {
      setTemplates(t);
      const def = t.find(x => x.is_default) ?? t[0];
      if (def) setTemplateId(def.id);
    }).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (templateId) api.listTemplateColumns(templateId).then(setColumns);
  }, [templateId]);

  const template = templates.find(t => t.id === templateId);

  const payees = useMemo(() => records
    .filter(r => r.status === 'included' && Number(r.net_pay) > 0)
    .map(r => ({
      employee_code: r.employee_code, full_name: r.full_name,
      account_holder: r.account_holder || r.full_name,
      bank_name: r.bank_name, bank_account: r.bank_account, bank_ifsc: r.bank_ifsc,
      net_pay: Number(r.net_pay),
      remarks: `Salary ${MONTHS[run.period_month - 1].slice(0, 3)} ${run.period_year}`,
    })), [records, run]);

  const built = useMemo(() => {
    if (!template || columns.length === 0) return null;
    const t: BankTemplate = {
      name: template.name, sheet_name: template.sheet_name,
      include_header: template.include_header,
      include_instructions: template.include_instructions ?? false,
      date_format: template.date_format,
      amount_format: template.amount_format as '2dp' | 'integer',
      debit_account: template.debit_account, debit_ifsc: template.debit_ifsc,
      columns: columns.map(c => ({
        position: c.position, header_label: c.header_label,
        source: c.source as BankTemplate['columns'][number]['source'],
        constant_value: c.constant_value, required: c.required,
        transform: c.transform as BankTemplate['columns'][number]['transform'],
        max_length: c.max_length, instruction_text: c.instruction_text ?? '',
      })),
    };
    return buildBankFile(t, payees, paymentDate);
  }, [template, columns, payees, paymentDate]);

  const generate = async () => {
    if (!built || !template) return;
    setBusy(true);
    try {
      /*
       * The bank issues this template as BLKPAY_YYYYMMDD.xlsx and its upload
       * screen is matched to that name, so the generated file uses it rather
       * than a Niyom-flavoured one. Dated by the PAYMENT date, which is the
       * date inside the file, not by the payroll period.
       */
      const stamp = paymentDate.slice(0, 10).replace(/-/g, '');
      const fileName = template.include_instructions
        ? `BLKPAY_${stamp}.xlsx`
        : `niyom_salary_transfer_${periodStamp(run.period_year, run.period_month)}.xlsx`;
      await exportWorkbook(fileName, [{
        name: built.sheet_name, rows: built.grid, noHeader: !template.include_header,
        // The bank's own column widths are irrelevant to its parser, but a
        // human checks this file before uploading it.
        widths: undefined,
      }]);
      await api.recordPaymentFile({
        run_id: runId, template_id: template.id, template_name: template.name,
        file_name: fileName, row_count: built.row_count, total_amount: built.total_amount,
        payment_date: paymentDate, generated_by: employeeId,
      });
      onToast(`Bank transfer file generated: ${built.row_count} payees, ${inr(built.total_amount)}.`);
      onClose();
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Generate bank transfer file" width="max-w-3xl">
      <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
        <Notice tone="warn" title="This file moves money once your bank uploads it">
          Niyom's system never transfers anything — it only produces the file. Check the column layout against your
          bank's own template before uploading, and check the total against the payroll register.
        </Notice>

        {loading ? <Skeleton rows={3} /> : templates.length === 0 ? (
          <Notice tone="bad" title="No bank template configured">
            Create one in HR Settings first — the column names and order have to match what your bank expects.
          </Notice>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Bank template">
                <Select value={templateId} onChange={e => setTemplateId(e.target.value)}>
                  {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                </Select>
              </Field>
              <Field label="Payment date">
                <Input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)} />
              </Field>
            </div>

            {built && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <StatTile label="Payees" value={built.row_count} />
                  <StatTile label="Total Amount" value={inr(built.total_amount)} tone="good" />
                  <StatTile label="Issues" value={built.issues.length}
                    tone={built.issues.length ? 'bad' : 'good'} />
                </div>

                {built.issues.length > 0 && (
                  <Notice tone="bad" title="Fix these before uploading to the bank">
                    <ul className="mt-1 space-y-0.5 list-disc list-inside">
                      {built.issues.slice(0, 8).map((i, k) => (
                        <li key={k}>{i.employee_code ? `${i.employee_code}: ` : ''}{i.message}</li>
                      ))}
                      {built.issues.length > 8 && <li>…and {built.issues.length - 8} more.</li>}
                    </ul>
                  </Notice>
                )}

                <div>
                  <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
                    Preview
                  </p>
                  <TableWrap>
                    <tbody>
                      {built.grid.slice(0, 6).map((row, i) => (
                        <tr key={i} style={{ fontWeight: i === 0 && template?.include_header ? 700 : 400 }}>
                          {row.map((cell, j) => <td key={j} className="text-xs whitespace-nowrap">{String(cell)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </TableWrap>
                  {built.grid.length > 6 && (
                    <p className="text-xs mt-1.5" style={{ color: 'var(--text-faint)' }}>
                      Showing 6 of {built.grid.length} rows.
                    </p>
                  )}
                </div>
              </>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <PrimaryButton onClick={generate} disabled={busy || !built || built.row_count === 0}>
                {busy ? 'Generating…' : 'Generate Excel'}
              </PrimaryButton>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
