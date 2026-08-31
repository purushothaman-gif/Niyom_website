/**
 * "My HR" -- everything an employee can do for themselves.
 *
 * One nav entry rather than six, because an employee's HR needs are occasional
 * and the CRM sidebar already carries seven sections of daily work. Tabs inside
 * keep it to a single click from the menu.
 *
 * Read-only about money and attendance by construction: the tables behind these
 * tabs give an employee SELECT on their own rows and nothing more, and the two
 * things they CAN create -- a leave request and an attendance correction --
 * both land as `pending` for someone else to decide.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, CalendarClock, FileText, Plus, Wallet } from 'lucide-react';
import type { NWEmployee } from '../types';
import PunchCard from './PunchCard';
import {
  EmptyState, Field, Input, Modal, Notice, Pill, PrimaryButton, SectionCard,
  Select, Skeleton, TableWrap, Tabs, Textarea,
} from './hrUi';
import { useToast } from './useToast';
import * as api from './hrApi';
import { hrError } from './hrError';
import { summariseAttendance, formatDuration, type DailyRow } from '../../lib/hr/attendanceSummary';
import type {
  AttendanceAdjustment, AttendanceDaily, Holiday, LeaveBalance, LeaveRequest, LeaveType,
  PayrollRecord, Payslip,
} from './hrTypes';
import { inr } from '../../lib/money';
import { downloadPayslip } from './payslipDocument';

type Tab = 'attendance' | 'leave' | 'holidays' | 'payslips' | 'profile';

const monthStart = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
const monthEnd   = (d = new Date()) => new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10);
const fmtDay = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', weekday: 'short' });
const timeOf = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—';

export default function MyHR({ employee }: { employee: NWEmployee }) {
  const [tab, setTab] = useState<Tab>('attendance');
  const { show, node: toastNode } = useToast();

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>My HR</h2>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Attendance, leave, payslips and your own details.
          </p>
        </div>
      </div>

      <Tabs<Tab>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'attendance', label: 'Attendance' },
          { key: 'leave',      label: 'Leave' },
          { key: 'holidays',   label: 'Holidays' },
          { key: 'payslips',   label: 'Payslips' },
          { key: 'profile',    label: 'My Details' },
        ]}
      />

      {tab === 'attendance' && <MyAttendance employee={employee} onToast={show} />}
      {tab === 'leave'      && <MyLeave employee={employee} onToast={show} />}
      {tab === 'holidays'   && <MyHolidays />}
      {tab === 'payslips'   && <MyPayslips employee={employee} onToast={show} />}
      {tab === 'profile'    && <MyProfile employee={employee} onToast={show} />}

      {toastNode}
    </div>
  );
}

/* ======================================================================== */
/* Attendance                                                                */
/* ======================================================================== */

function MyAttendance({ employee, onToast }: { employee: NWEmployee; onToast: (m: string, ok?: boolean) => void }) {
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const [days, setDays] = useState<AttendanceDaily[]>([]);
  const [adjustments, setAdjustments] = useState<AttendanceAdjustment[]>([]);
  const [loading, setLoading] = useState(true);
  const [correctionFor, setCorrectionFor] = useState<AttendanceDaily | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, a] = await Promise.all([
        api.listMyDaily(employee.id, from, to),
        api.listAdjustments({ employeeId: employee.id }),
      ]);
      setDays(d);
      setAdjustments(a);
    } catch (err) {
      onToast(hrError(err, 'Could not load your attendance.'), false);
    } finally {
      setLoading(false);
    }
  }, [employee.id, from, to, onToast]);

  useEffect(() => { load(); }, [load]);

  const summary = useMemo(() => summariseAttendance(days as unknown as DailyRow[]), [days]);

  return (
    <div className="space-y-5">
      <PunchCard employeeName={employee.full_name} onPunched={load} />

      <SectionCard
        title="Monthly summary"
        subtitle={`${fmtDay(from)} to ${fmtDay(to)} · attendance only — your payslip is what decides pay`}
        actions={
          <div className="flex items-center gap-2">
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ width: 150 }} />
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ width: 150 }} />
          </div>
        }
      >
        {loading ? <Skeleton rows={2} height={60} /> : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            <Mini label="Calendar"   value={summary.calendar_days} />
            <Mini label="Working"    value={summary.working_days} />
            <Mini label="Present"    value={summary.present_days} />
            <Mini label="Paid Leave" value={summary.paid_leave_days} />
            {/*
              * "Unpaid", not "LOP". This tile is computed from the attendance
              * register, which knows nothing about waivers -- so after an
              * administrator forgives the absence it would still read "LOP 4"
              * beside a payslip showing none. Loss of pay is a payroll outcome,
              * not an attendance fact, and the payslip is what decides it.
              */}
            <Mini label="Unpaid"     value={summary.lop_days} tone={summary.lop_days > 0 ? 'bad' : undefined} />
            <Mini label="Holidays"   value={summary.holiday_days} />
            <Mini label="Weekly Off" value={summary.weekly_off_days} />
          </div>
        )}
      </SectionCard>

      <SectionCard title="Attendance history" padded={false}>
        <div className="p-5">
          {loading ? <Skeleton /> : days.length === 0 ? (
            <EmptyState icon={CalendarDays} title="No attendance recorded" message="Nothing has been recorded for this period yet." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className="text-left">Date</th>
                  <th className="text-left">Status</th>
                  <th className="text-left">In</th>
                  <th className="text-left">Out</th>
                  <th className="text-left">Worked</th>
                  <th className="text-left">Flags</th>
                  <th className="text-right">Correction</th>
                </tr>
              </thead>
              <tbody>
                {days.map(d => {
                  const open = adjustments.find(a => a.work_date === d.work_date && a.status === 'pending');
                  return (
                    <tr key={d.id}>
                      <td className="whitespace-nowrap">{fmtDay(d.work_date)}</td>
                      <td><Pill value={d.status} kind="attendance" small /></td>
                      <td className="tabular-nums">{timeOf(d.first_in_at)}</td>
                      <td className="tabular-nums">{timeOf(d.last_out_at)}</td>
                      <td className="tabular-nums">{formatDuration(d.worked_minutes)}</td>
                      <td className="space-x-1 whitespace-nowrap">
                        {d.is_late && <Pill value="late" small />}
                        {d.is_early_out && <Pill value="early out" small />}
                        {d.missing_punch_out && <Pill value="no punch out" small />}
                        {d.has_pending_punch && <Pill value="pending" small />}
                      </td>
                      <td className="text-right">
                        {open ? <Pill value="pending" small /> : (
                          <button onClick={() => setCorrectionFor(d)}
                            className="text-xs font-semibold" style={{ color: 'var(--accent-soft)' }}>
                            Request
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </div>
      </SectionCard>

      {adjustments.length > 0 && (
        <SectionCard title="My correction requests" padded={false}>
          <div className="p-5">
            <TableWrap>
              <thead>
                <tr>
                  <th className="text-left">Date</th><th className="text-left">Type</th>
                  <th className="text-left">Reason</th><th className="text-left">Status</th>
                  <th className="text-left">Reviewer note</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.slice(0, 20).map(a => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">{fmtDay(a.work_date)}</td>
                    <td>{a.kind.replace(/_/g, ' ')}</td>
                    <td className="max-w-xs truncate">{a.reason}</td>
                    <td><Pill value={a.status} small /></td>
                    <td className="max-w-xs truncate" style={{ color: 'var(--text-faint)' }}>{a.review_note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        </SectionCard>
      )}

      {correctionFor && (
        <CorrectionModal
          employeeId={employee.id}
          day={correctionFor}
          onClose={() => setCorrectionFor(null)}
          onDone={() => { setCorrectionFor(null); onToast('Correction request submitted for approval.'); load(); }}
          onError={m => onToast(m, false)}
        />
      )}
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: number; tone?: 'bad' }) {
  return (
    <div className="px-3 py-2.5 rounded-xl text-center" style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
      <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{label}</p>
      <p className="text-lg font-bold mt-0.5 tabular-nums"
        style={{ color: tone === 'bad' ? 'rgb(239,68,68)' : 'var(--text-primary)' }}>{value}</p>
    </div>
  );
}

function CorrectionModal({ employeeId, day, onClose, onDone, onError }: {
  employeeId: string; day: AttendanceDaily;
  onClose: () => void; onDone: () => void; onError: (m: string) => void;
}) {
  const [kind, setKind] = useState(day.first_in_at ? 'missing_punch_out' : 'missing_punch_in');
  const [inTime, setInTime] = useState('');
  const [outTime, setOutTime] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  // A wall-clock time the employee types is IST; the column is timestamptz, so
  // the offset is stated explicitly rather than left to the browser's zone.
  const toIso = (t: string) => (t ? `${day.work_date}T${t}:00+05:30` : null);

  const submit = async () => {
    if (!reason.trim()) { onError('Please say why the correction is needed.'); return; }
    if (!inTime && !outTime) { onError('Enter at least one corrected time.'); return; }
    setBusy(true);
    try {
      await api.requestAdjustment({
        employee_id: employeeId, work_date: day.work_date, kind,
        requested_in_at: toIso(inTime), requested_out_at: toIso(outTime),
        reason: reason.trim(), status: 'pending', requested_by: employeeId,
      });
      onDone();
    } catch (err) {
      onError(hrError(err, 'Could not submit that request.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Attendance correction — ${fmtDay(day.work_date)}`}>
      <div className="p-5 space-y-4">
        <Notice tone="info">
          Your original punches are never changed. An approved correction is recorded alongside them with your reason
          and the reviewer’s name.
        </Notice>

        <Field label="What needs correcting" required>
          <Select value={kind} onChange={e => setKind(e.target.value)}>
            <option value="missing_punch_in">Missing punch in</option>
            <option value="missing_punch_out">Missing punch out</option>
            <option value="wrong_time">Wrong time recorded</option>
            <option value="regularize">Regularise the day</option>
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Correct punch in" hint="IST">
            <Input type="time" value={inTime} onChange={e => setInTime(e.target.value)} />
          </Field>
          <Field label="Correct punch out" hint="IST">
            <Input type="time" value={outTime} onChange={e => setOutTime(e.target.value)} />
          </Field>
        </div>

        <Field label="Reason" required>
          <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Forgot to punch out." />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            Cancel
          </button>
          <PrimaryButton onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit Request'}</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

/* ======================================================================== */
/* Leave                                                                     */
/* ======================================================================== */

function MyLeave({ employee, onToast }: { employee: NWEmployee; onToast: (m: string, ok?: boolean) => void }) {
  const year = new Date().getFullYear();
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, b, r] = await Promise.all([
        api.listLeaveTypes(true),
        api.listLeaveBalances(employee.id, year),
        api.listLeaveRequests({ employeeId: employee.id }),
      ]);
      setTypes(t); setBalances(b); setRequests(r);
    } catch (err) {
      onToast(hrError(err, 'Could not load your leave.'), false);
    } finally {
      setLoading(false);
    }
  }, [employee.id, year, onToast]);

  useEffect(() => { load(); }, [load]);

  const cancel = async (r: LeaveRequest) => {
    try {
      await api.cancelLeave(r.id, 'Cancelled by employee');
      onToast('Leave request cancelled.');
      load();
    } catch (err) {
      onToast(hrError(err), false);
    }
  };

  return (
    <div className="space-y-5">
      <SectionCard
        title="Leave balance"
        subtitle={`For ${year}`}
        actions={<PrimaryButton onClick={() => setApplying(true)}><Plus className="w-3.5 h-3.5 inline mr-1" />Apply for Leave</PrimaryButton>}
      >
        {loading ? <Skeleton rows={2} height={60} /> : types.length === 0 ? (
          <EmptyState icon={CalendarClock} title="No leave types configured" message="HR has not set up leave types yet." />
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {types.filter(t => t.accrual_mode !== 'none').map(t => {
              const b = balances.find(x => x.leave_type_id === t.id);
              return (
                <div key={t.id} className="px-3.5 py-3 rounded-xl"
                  style={{ background: 'var(--bg-base)', border: `1px solid ${t.colour}33` }}>
                  <p className="text-xs font-semibold truncate" style={{ color: t.colour }}>{t.name}</p>
                  <p className="text-xl font-bold mt-1 tabular-nums" style={{ color: 'var(--text-primary)' }}>
                    {Number(b?.balance ?? 0)}
                  </p>
                  <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                    {Number(b?.used ?? 0)} used
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </SectionCard>

      <SectionCard title="My leave requests" padded={false}>
        <div className="p-5">
          {loading ? <Skeleton /> : requests.length === 0 ? (
            <EmptyState icon={CalendarClock} title="No leave requests yet"
              message="Apply for leave and it will appear here with its status." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className="text-left">Type</th><th className="text-left">From</th><th className="text-left">To</th>
                  <th className="text-right">Days</th><th className="text-left">Status</th>
                  <th className="text-left">Note</th><th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(r => (
                  <tr key={r.id}>
                    <td>{types.find(t => t.id === r.leave_type_id)?.name ?? '—'}</td>
                    <td className="whitespace-nowrap">{fmtDay(r.from_date)}</td>
                    <td className="whitespace-nowrap">{fmtDay(r.to_date)}</td>
                    <td className="text-right tabular-nums">{Number(r.days)}</td>
                    <td><Pill value={r.status} small /></td>
                    <td className="max-w-xs truncate" style={{ color: 'var(--text-faint)' }}>{r.decision_note || '—'}</td>
                    <td className="text-right">
                      {(r.status === 'pending' || r.status === 'approved') && (
                        <button onClick={() => cancel(r)} className="text-xs font-semibold" style={{ color: 'rgb(239,68,68)' }}>
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
      </SectionCard>

      {applying && (
        <ApplyLeaveModal
          employeeId={employee.id}
          types={types}
          balances={balances}
          onClose={() => setApplying(false)}
          onDone={() => { setApplying(false); onToast('Leave request submitted for approval.'); load(); }}
          onError={m => onToast(m, false)}
        />
      )}
    </div>
  );
}

function ApplyLeaveModal({ employeeId, types, balances, onClose, onDone, onError }: {
  employeeId: string; types: LeaveType[]; balances: LeaveBalance[];
  onClose: () => void; onDone: () => void; onError: (m: string) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const [typeId, setTypeId] = useState(types[0]?.id ?? '');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [fromHalf, setFromHalf] = useState(false);
  const [toHalf, setToHalf] = useState(false);
  const [reason, setReason] = useState('');
  const [days, setDays] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const type = types.find(t => t.id === typeId);
  const balance = Number(balances.find(b => b.leave_type_id === typeId)?.balance ?? 0);

  // The working-day count is computed by the DATABASE, against this employee's
  // own schedule and holiday calendar -- counting it in the browser would give
  // a different answer from the one approval uses.
  useEffect(() => {
    let cancelled = false;
    if (!from || !to || to < from) { setDays(null); return; }
    api.countLeaveDays(employeeId, from, to, fromHalf, toHalf)
      .then(d => { if (!cancelled) setDays(d); })
      .catch(() => { if (!cancelled) setDays(null); });
    return () => { cancelled = true; };
  }, [employeeId, from, to, fromHalf, toHalf]);

  const submit = async () => {
    if (!typeId) { onError('Choose a leave type.'); return; }
    if (to < from) { onError('The end date cannot be before the start date.'); return; }
    if (!days || days <= 0) { onError('That range contains no working days.'); return; }
    setBusy(true);
    try {
      await api.applyLeave({
        employee_id: employeeId, leave_type_id: typeId,
        from_date: from, to_date: to, from_half_day: fromHalf, to_half_day: toHalf,
        days, reason: reason.trim(), status: 'pending',
      });
      onDone();
    } catch (err) {
      onError(hrError(err, 'Could not submit that leave request.'));
    } finally {
      setBusy(false);
    }
  };

  const short = type && type.accrual_mode !== 'none' && days !== null && days > balance;

  return (
    <Modal open onClose={onClose} title="Apply for leave">
      <div className="p-5 space-y-4">
        <Field label="Leave type" required>
          <Select value={typeId} onChange={e => setTypeId(e.target.value)}>
            {types.map(t => (
              <option key={t.id} value={t.id}>
                {t.name}{t.paid ? '' : ' (unpaid)'}
              </option>
            ))}
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="From" required>
            <Input type="date" value={from} onChange={e => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value); }} />
          </Field>
          <Field label="To" required>
            <Input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} />
          </Field>
        </div>

        {type?.allow_half_day && (
          <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={fromHalf} onChange={e => setFromHalf(e.target.checked)} />
              Half day on the first day
            </label>
            {to !== from && (
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={toHalf} onChange={e => setToHalf(e.target.checked)} />
                Half day on the last day
              </label>
            )}
          </div>
        )}

        <div className="px-3.5 py-3 rounded-xl flex items-center justify-between"
          style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Working days requested (weekly offs and holidays excluded)
          </span>
          <span className="text-lg font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
            {days ?? '—'}
          </span>
        </div>

        {type && type.accrual_mode !== 'none' && (
          <p className="text-xs" style={{ color: short ? 'rgb(245,158,11)' : 'var(--text-faint)' }}>
            Balance available: {balance} day(s).
            {short && ' This request exceeds your balance and may be refused or treated as loss of pay.'}
          </p>
        )}

        {type && !type.paid && (
          <Notice tone="warn" title="Unpaid leave">
            This leave type is unpaid. Approved days will be treated as loss of pay in that month’s payroll.
          </Notice>
        )}

        <Field label="Reason">
          <Textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional" />
        </Field>

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            Cancel
          </button>
          <PrimaryButton onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit Request'}</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

/* ======================================================================== */
/* Holidays                                                                  */
/* ======================================================================== */

function MyHolidays() {
  const [year, setYear] = useState(new Date().getFullYear());
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.listHolidays(year).then(setHolidays).finally(() => setLoading(false));
  }, [year]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <SectionCard
      title="Holiday calendar"
      actions={
        <Select value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 110 }}>
          {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
        </Select>
      }
      padded={false}
    >
      <div className="p-5">
        {loading ? <Skeleton /> : holidays.length === 0 ? (
          <EmptyState icon={CalendarDays} title={`No holidays listed for ${year}`}
            message="HR publishes the holiday calendar here once it is confirmed." />
        ) : (
          <ul className="space-y-2">
            {holidays.map(h => {
              const past = h.holiday_date < today;
              return (
                <li key={h.id} className="flex items-center gap-3 px-3.5 py-3 rounded-xl"
                  style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)', opacity: past ? 0.55 : 1 }}>
                  <div className="w-12 text-center flex-shrink-0">
                    <p className="text-lg font-bold leading-none" style={{ color: 'var(--accent-soft)' }}>
                      {new Date(h.holiday_date + 'T00:00:00').getDate()}
                    </p>
                    <p className="text-[11px] uppercase" style={{ color: 'var(--text-faint)' }}>
                      {new Date(h.holiday_date + 'T00:00:00').toLocaleDateString('en-IN', { month: 'short' })}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{h.name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                      {new Date(h.holiday_date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long' })} · {h.location}
                    </p>
                  </div>
                  {h.holiday_type !== 'public' && <Pill value={h.holiday_type} small />}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

/* ======================================================================== */
/* Payslips                                                                  */
/* ======================================================================== */

function MyPayslips({ employee, onToast }: { employee: NWEmployee; onToast: (m: string, ok?: boolean) => void }) {
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [records, setRecords] = useState<PayrollRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.listPayslips({ employeeId: employee.id }),
      api.listMyPayrollRecords(employee.id),
    ])
      .then(([p, r]) => { setPayslips(p); setRecords(r); })
      .catch(err => onToast(hrError(err, 'Could not load your payslips.'), false))
      .finally(() => setLoading(false));
  }, [employee.id, onToast]);

  const download = async (p: Payslip) => {
    setBusyId(p.id);
    try {
      await downloadPayslip(p.id);
    } catch (err) {
      onToast(hrError(err, 'Could not generate that payslip.'), false);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <SectionCard title="My payslips" subtitle="Available as soon as payroll is finalised for the month." padded={false}>
      <div className="p-5">
        {loading ? <Skeleton /> : payslips.length === 0 ? (
          <EmptyState icon={Wallet} title="No payslips yet"
            message="Your payslip appears here once that month's payroll has been approved and published." />
        ) : (
          <ul className="space-y-2">
            {payslips.map(p => {
              const rec = records.find(r => r.id === p.record_id);
              return (
                <li key={p.id} className="flex items-center gap-4 px-4 py-3.5 rounded-xl flex-wrap"
                  style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                      {new Date(p.period_year, p.period_month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
                    </p>
                    <p className="text-[11px] mt-0.5 font-mono truncate" style={{ color: 'var(--text-faint)' }}>
                      {p.payslip_number}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>Net Pay</p>
                    <p className="text-base font-bold tabular-nums" style={{ color: 'rgb(16,185,129)' }}>
                      {inr(Number(p.net_pay), true)}
                    </p>
                  </div>
                  {rec && Number(rec.lop_days) > 0 && <Pill value={`${Number(rec.lop_days)} LOP`} small />}
                  <button onClick={() => download(p)} disabled={busyId === p.id}
                    className="px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 disabled:opacity-60"
                    style={{ background: 'rgba(var(--accent-soft-rgb),0.14)', color: 'var(--accent-soft)', border: '1px solid rgba(var(--accent-soft-rgb),0.3)' }}>
                    <FileText className="w-3.5 h-3.5" />
                    {busyId === p.id ? 'Preparing…' : 'Download PDF'}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </SectionCard>
  );
}

/* ======================================================================== */
/* Profile                                                                   */
/* ======================================================================== */

function MyProfile({ employee, onToast }: { employee: NWEmployee; onToast: (m: string, ok?: boolean) => void }) {
  const [profile, setProfile] = useState<Awaited<ReturnType<typeof api.listHREmployees>>[number] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    personal_email: '', personal_phone: '', address: '',
    emergency_contact_name: '', emergency_contact_phone: '',
  });

  useEffect(() => {
    api.listHREmployees(true)
      .then(list => {
        const me = list.find(e => e.id === employee.id) ?? null;
        setProfile(me);
        if (me?.profile) {
          setForm({
            personal_email: me.profile.personal_email ?? '',
            personal_phone: me.profile.personal_phone ?? '',
            address: me.profile.address ?? '',
            emergency_contact_name: me.profile.emergency_contact_name ?? '',
            emergency_contact_phone: me.profile.emergency_contact_phone ?? '',
          });
        }
      })
      .catch(err => onToast(hrError(err), false))
      .finally(() => setLoading(false));
  }, [employee.id, onToast]);

  const save = async () => {
    setSaving(true);
    try {
      await api.saveProfile(employee.id, form);
      onToast('Your details have been updated.');
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Skeleton rows={6} />;

  const p = profile?.profile;

  return (
    <div className="space-y-5">
      <SectionCard title="Employment" subtitle="Maintained by HR — get in touch if anything here is wrong.">
        <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Detail label="Employee ID" value={employee.employee_code} />
          <Detail label="Name" value={employee.full_name} />
          <Detail label="Designation" value={employee.designation ?? '—'} />
          <Detail label="Department" value={p?.department || '—'} />
          <Detail label="Employment type" value={(p?.employment_type ?? '—').replace(/_/g, ' ')} />
          <Detail label="Work location" value={p?.work_location ?? '—'} />
          <Detail label="Date of joining" value={employee.joining_date ? fmtDay(employee.joining_date) : '—'} />
          <Detail label="Official email" value={employee.email} />
          <Detail label="Status" value={p?.employment_status ?? employee.status} />
        </dl>
      </SectionCard>

      <SectionCard
        title="My details"
        subtitle="You can keep these up to date yourself."
        actions={<PrimaryButton onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</PrimaryButton>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Personal email">
            <Input type="email" value={form.personal_email} onChange={e => setForm(f => ({ ...f, personal_email: e.target.value }))} />
          </Field>
          <Field label="Personal phone">
            <Input value={form.personal_phone} onChange={e => setForm(f => ({ ...f, personal_phone: e.target.value }))} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Address">
              <Textarea value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
            </Field>
          </div>
          <Field label="Emergency contact name">
            <Input value={form.emergency_contact_name} onChange={e => setForm(f => ({ ...f, emergency_contact_name: e.target.value }))} />
          </Field>
          <Field label="Emergency contact phone">
            <Input value={form.emergency_contact_phone} onChange={e => setForm(f => ({ ...f, emergency_contact_phone: e.target.value }))} />
          </Field>
        </div>
      </SectionCard>

      {profile?.bank && (
        <SectionCard title="Salary account" subtitle="Changing this is an HR action — contact HR if it is out of date.">
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Detail label="Bank" value={profile.bank.bank_name} />
            <Detail label="Account" value={`•••• ${profile.bank.account_number.slice(-4)}`} />
            <Detail label="IFSC" value={profile.bank.ifsc} />
          </dl>
        </SectionCard>
      )}

      {p && (p.pan || p.uan) && (
        <SectionCard title="Statutory">
          <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {p.pan && <Detail label="PAN" value={p.pan} />}
            {p.uan && <Detail label="UAN" value={p.uan} />}
            <Detail label="PF applicable" value={p.pf_applicable ? 'Yes' : 'No'} />
          </dl>
        </SectionCard>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{label}</dt>
      <dd className="text-sm mt-1 font-medium" style={{ color: 'var(--text-primary)' }}>{value}</dd>
    </div>
  );
}
