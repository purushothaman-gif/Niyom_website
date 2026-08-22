/**
 * Attendance administration: today's board, the monthly register, the approval
 * queue, and the network allowlist.
 *
 * The approval queue is the piece that makes the network restriction survivable.
 * With enforcement on, an off-network punch is RECORDED but does not count --
 * so a changed ISP address, a client visit or a phone hotspot inconveniences
 * someone for an hour rather than stranding them at the door. Everything in
 * that queue is a real punch with a real server-detected IP; approving it is a
 * judgement call, not a data-entry exercise.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarRange, CheckCircle2, ClipboardCheck, Download, Network, RefreshCw, ShieldCheck, XCircle,
} from 'lucide-react';
import type { NWEmployee } from '../types';
import * as api from './hrApi';
import { hrError } from './hrError';
import {
  ConfirmDialog, EmptyState, Field, GhostButton, Input, Modal, Notice, Pill,
  PrimaryButton, SectionCard, Select, Skeleton, StatTile, TableWrap, Tabs, Textarea,
} from './hrUi';
import { useToast } from './useToast';
import type {
  AllowedNetwork, AttendanceAdjustment, AttendanceDaily, AttendancePunch,
  AttendanceSettings, HRAccess, HREmployee,
} from './hrTypes';
import { formatDuration } from '../../lib/hr/attendanceSummary';
import { exportSheet, exportWorkbook, periodStamp } from './hrExcel';

type Tab = 'today' | 'register' | 'approvals' | 'networks' | 'rules';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
const timeOf = (v: string | null) =>
  v ? new Date(v).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—';
const dayLabel = (v: string) =>
  new Date(v + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

export default function AttendanceAdmin({ employee, access }: { employee: NWEmployee; access: HRAccess }) {
  const [tab, setTab] = useState<Tab>('today');
  const [pendingCount, setPendingCount] = useState(0);
  const { show, node } = useToast();

  const refreshCounts = useCallback(async () => {
    try {
      const [punches, adj] = await Promise.all([
        api.listPendingPunches(),
        api.listAdjustments({ pendingOnly: true }),
      ]);
      setPendingCount(punches.length + adj.length);
    } catch { /* the badge is cosmetic; a failure here must not break the page */ }
  }, []);

  useEffect(() => { refreshCounts(); }, [refreshCounts]);

  return (
    <div className="space-y-5">
      <Tabs<Tab>
        active={tab} onChange={setTab}
        tabs={[
          { key: 'today',     label: 'Today' },
          { key: 'register',  label: 'Monthly Register' },
          { key: 'approvals', label: 'Approvals', count: pendingCount },
          { key: 'networks',  label: 'Office Networks' },
          { key: 'rules',     label: 'Rules' },
        ]}
      />

      {tab === 'today'     && <TodayBoard onToast={show} />}
      {tab === 'register'  && <Register onToast={show} canEdit={access.canEdit.attendance} />}
      {tab === 'approvals' && <Approvals onToast={show} canEdit={access.canEdit.attendance} onChanged={refreshCounts} />}
      {tab === 'networks'  && <Networks onToast={show} canEdit={access.canEdit.attendance} employee={employee} />}
      {tab === 'rules'     && <Rules onToast={show} canEdit={access.canEdit.attendance} />}

      {node}
    </div>
  );
}

/* ======================================================================== */
/* Today                                                                     */
/* ======================================================================== */

function TodayBoard({ onToast }: { onToast: (m: string, ok?: boolean) => void }) {
  const [date, setDate] = useState(today());
  const [rows, setRows] = useState<AttendanceDaily[]>([]);
  const [staff, setStaff] = useState<HREmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [dept, setDept] = useState('');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, s] = await Promise.all([api.listDailyForDate(date), api.listHREmployees()]);
      setRows(d); setStaff(s);
    } catch (err) {
      onToast(hrError(err, 'Could not load attendance.'), false);
    } finally {
      setLoading(false);
    }
  }, [date, onToast]);

  useEffect(() => { load(); }, [load]);

  // An employee with no row for the day simply has not punched -- the nightly
  // job has not settled the day yet. Showing them as "Not punched" rather than
  // omitting them is the whole point of this board.
  const merged = useMemo(() => staff.map(s => ({
    staff: s,
    day: rows.find(r => r.employee_id === s.id) ?? null,
  })), [staff, rows]);

  const filtered = useMemo(() => merged.filter(m => {
    if (dept && (m.staff.profile?.department ?? '') !== dept) return false;
    if (status) {
      const st = m.day?.status ?? 'not_punched';
      if (status === 'not_punched' ? !!m.day?.first_in_at : st !== status) return false;
    }
    if (q) {
      const needle = q.toLowerCase();
      if (!m.staff.full_name.toLowerCase().includes(needle) &&
          !m.staff.employee_code.toLowerCase().includes(needle)) return false;
    }
    return true;
  }), [merged, dept, status, q]);

  const stats = useMemo(() => {
    const present = merged.filter(m => m.day?.status === 'present' || m.day?.status === 'on_duty').length;
    const half    = merged.filter(m => m.day?.status === 'half_day').length;
    const leave   = merged.filter(m => m.day?.status === 'paid_leave' || m.day?.status === 'unpaid_leave').length;
    const off     = merged.filter(m => m.day?.status === 'weekly_off' || m.day?.status === 'holiday').length;
    const notIn   = merged.filter(m => !m.day?.first_in_at &&
                      !['weekly_off', 'holiday', 'paid_leave', 'unpaid_leave', 'not_joined', 'exited'].includes(m.day?.status ?? '')).length;
    const late    = merged.filter(m => m.day?.is_late).length;
    const pending = merged.filter(m => m.day?.has_pending_punch).length;
    return { total: merged.length, present, half, leave, off, notIn, late, pending };
  }, [merged]);

  const departments = useMemo(
    () => Array.from(new Set(staff.map(s => s.profile?.department).filter(Boolean))) as string[], [staff]);

  const exportToday = () => exportSheet(
    `niyom_attendance_${date}`, 'Attendance',
    [
      ['Employee ID', 'Name', 'Department', 'Status', 'Punch In', 'Punch Out', 'Worked', 'Late (min)', 'Early Out (min)', 'Remarks'],
      ...filtered.map(m => [
        m.staff.employee_code, m.staff.full_name, m.staff.profile?.department ?? '',
        m.day?.status ?? 'not punched',
        timeOf(m.day?.first_in_at ?? null), timeOf(m.day?.last_out_at ?? null),
        formatDuration(m.day?.worked_minutes ?? 0),
        m.day?.late_minutes ?? 0, m.day?.early_out_minutes ?? 0, m.day?.remarks ?? '',
      ]),
    ],
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatTile label="Employees"   value={stats.total} icon={ClipboardCheck} />
        <StatTile label="Present"     value={stats.present + stats.half} tone="good" sub={stats.half ? `${stats.half} half day` : undefined} />
        <StatTile label="On Leave"    value={stats.leave} tone="accent" />
        <StatTile label="Not Punched" value={stats.notIn} tone={stats.notIn ? 'bad' : 'neutral'} />
        <StatTile label="Late"        value={stats.late} tone={stats.late ? 'warn' : 'neutral'} />
        <StatTile label="Off / Holiday" value={stats.off} />
      </div>

      {stats.pending > 0 && (
        <Notice tone="warn" title="Punches awaiting approval">
          {stats.pending} employee(s) punched from outside the office network today. Those punches do not count towards
          their hours until you approve them in the Approvals tab.
        </Notice>
      )}

      <SectionCard
        title="Attendance board"
        subtitle={new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        actions={
          <>
            <Input type="date" value={date} max={today()} onChange={e => setDate(e.target.value)} style={{ width: 150 }} />
            <GhostButton onClick={load}><RefreshCw className="w-3.5 h-3.5 inline mr-1" />Refresh</GhostButton>
            <GhostButton onClick={exportToday}><Download className="w-3.5 h-3.5 inline mr-1" />Excel</GhostButton>
          </>
        }
        padded={false}
      >
        <div className="px-5 pt-4 flex items-center gap-2 flex-wrap">
          <Input placeholder="Search name or ID…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 200 }} />
          <Select value={dept} onChange={e => setDept(e.target.value)} style={{ width: 170 }}>
            <option value="">All departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </Select>
          <Select value={status} onChange={e => setStatus(e.target.value)} style={{ width: 170 }}>
            <option value="">All statuses</option>
            <option value="present">Present</option>
            <option value="half_day">Half day</option>
            <option value="absent">Absent</option>
            <option value="paid_leave">Paid leave</option>
            <option value="weekly_off">Weekly off</option>
            <option value="holiday">Holiday</option>
            <option value="not_punched">Not punched</option>
          </Select>
        </div>

        <div className="p-5">
          {loading ? <Skeleton /> : filtered.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="Nothing matches those filters" />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className="text-left">Employee</th><th className="text-left">Department</th>
                  <th className="text-left">Status</th><th className="text-left">In</th><th className="text-left">Out</th>
                  <th className="text-left">Worked</th><th className="text-left">Flags</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(({ staff: s, day: d }) => (
                  <tr key={s.id}>
                    <td>
                      <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{s.full_name}</p>
                      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{s.employee_code}</p>
                    </td>
                    <td>{s.profile?.department || '—'}</td>
                    <td>{d ? <Pill value={d.status} kind="attendance" small /> : <Pill value="not punched" small />}</td>
                    <td className="tabular-nums">{timeOf(d?.first_in_at ?? null)}</td>
                    <td className="tabular-nums">{timeOf(d?.last_out_at ?? null)}</td>
                    <td className="tabular-nums">{formatDuration(d?.worked_minutes ?? 0)}</td>
                    <td className="space-x-1 whitespace-nowrap">
                      {d?.is_late && <Pill value={`late ${d.late_minutes}m`} small />}
                      {d?.is_early_out && <Pill value="early out" small />}
                      {d?.has_pending_punch && <Pill value="pending" small />}
                      {d?.missing_punch_out && <Pill value="no punch out" small />}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
      </SectionCard>
    </div>
  );
}

/* ======================================================================== */
/* Monthly register                                                          */
/* ======================================================================== */

const STATUS_CODE: Record<string, string> = {
  present: 'P', half_day: 'H', absent: 'A', weekly_off: 'W', holiday: 'F',
  paid_leave: 'L', unpaid_leave: 'U', on_duty: 'D', not_joined: '-', exited: '-',
};

function Register({ onToast, canEdit }: { onToast: (m: string, ok?: boolean) => void; canEdit: boolean }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [rows, setRows] = useState<AttendanceDaily[]>([]);
  const [staff, setStaff] = useState<HREmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [recomputing, setRecomputing] = useState(false);

  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = iso(new Date(year, month, 0));
  const days = useMemo(() => {
    const n = new Date(year, month, 0).getDate();
    return Array.from({ length: n }, (_, i) => `${year}-${String(month).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`);
  }, [year, month]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, s] = await Promise.all([api.listDailyForRange(from, to), api.listHREmployees(true)]);
      setRows(d); setStaff(s);
    } catch (err) {
      onToast(hrError(err, 'Could not load the register.'), false);
    } finally {
      setLoading(false);
    }
  }, [from, to, onToast]);

  useEffect(() => { load(); }, [load]);

  const cell = (empId: string, date: string) => rows.find(r => r.employee_id === empId && r.work_date === date);

  const recompute = async () => {
    setRecomputing(true);
    try {
      const n = await api.recomputeAttendance(null, from, to);
      onToast(`Recalculated ${n} employee-days.`);
      load();
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setRecomputing(false);
    }
  };

  const exportRegister = async () => {
    // Two sheets: the day-by-day grid people read, and the totals payroll uses.
    const detail: (string | number)[][] = [
      ['Employee ID', 'Name', 'Date', 'Day', 'Status', 'Punch In', 'Punch Out', 'Worked (min)',
       'Late (min)', 'Early Out (min)', 'Overtime (min)', 'Payable', 'Remarks'],
    ];
    const summary: (string | number)[][] = [
      ['Employee ID', 'Name', 'Department', 'Calendar Days', 'Working Days', 'Present', 'Paid Leave',
       'Unpaid Leave', 'Holidays', 'Weekly Off', 'Absent', 'LOP', 'Payable Days', 'Late Days', 'Overtime (min)'],
    ];

    for (const s of staff) {
      const mine = rows.filter(r => r.employee_id === s.id);
      for (const d of mine) {
        detail.push([
          s.employee_code, s.full_name, d.work_date,
          new Date(d.work_date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' }),
          d.status, timeOf(d.first_in_at), timeOf(d.last_out_at), d.worked_minutes,
          d.late_minutes, d.early_out_minutes, d.overtime_minutes, Number(d.payable_fraction), d.remarks,
        ]);
      }
      const count = (fn: (r: AttendanceDaily) => boolean) => mine.filter(fn).length;
      const payable = mine.reduce((t, r) => t + Number(r.payable_fraction), 0);
      const employed = mine.filter(r => r.status !== 'not_joined' && r.status !== 'exited').length;
      summary.push([
        s.employee_code, s.full_name, s.profile?.department ?? '',
        mine.length,
        count(r => !['weekly_off', 'holiday', 'not_joined', 'exited'].includes(r.status)),
        count(r => r.status === 'present' || r.status === 'on_duty') + count(r => r.status === 'half_day') * 0.5,
        count(r => r.status === 'paid_leave'), count(r => r.status === 'unpaid_leave'),
        count(r => r.status === 'holiday'), count(r => r.status === 'weekly_off'),
        count(r => r.status === 'absent'),
        Math.round((employed - payable) * 100) / 100,
        Math.round(payable * 100) / 100,
        count(r => r.is_late),
        mine.reduce((t, r) => t + r.overtime_minutes, 0),
      ]);
    }

    await exportWorkbook(`niyom_attendance_${periodStamp(year, month)}`, [
      { name: 'Summary', rows: summary },
      { name: 'Daily', rows: detail },
    ]);
  };

  return (
    <SectionCard
      title="Monthly attendance register"
      subtitle="P present · H half day · A absent · L paid leave · U unpaid · W weekly off · F holiday · D on duty"
      actions={
        <>
          <Select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ width: 140 }}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Date(2000, i, 1).toLocaleDateString('en-IN', { month: 'long' })}
              </option>
            ))}
          </Select>
          <Select value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 100 }}>
            {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </Select>
          {canEdit && (
            <GhostButton onClick={recompute} disabled={recomputing}>
              <RefreshCw className="w-3.5 h-3.5 inline mr-1" />{recomputing ? 'Recalculating…' : 'Recalculate'}
            </GhostButton>
          )}
          <GhostButton onClick={exportRegister}><Download className="w-3.5 h-3.5 inline mr-1" />Excel</GhostButton>
        </>
      }
      padded={false}
    >
      <div className="p-5">
        {loading ? <Skeleton rows={8} /> : staff.length === 0 ? (
          <EmptyState icon={CalendarRange} title="No employees" />
        ) : (
          <div className="overflow-x-auto -mx-5 px-5">
            <table className="nw-table hr-register text-xs" style={{ minWidth: 900 }}>
              <thead>
                <tr>
                  <th className="hr-sticky text-left">Employee</th>
                  {days.map(d => (
                    <th key={d} className="text-center px-1" title={d}>
                      {new Date(d + 'T00:00:00').getDate()}
                    </th>
                  ))}
                  <th className="text-center">Pay</th>
                  <th className="text-center">LOP</th>
                </tr>
              </thead>
              <tbody>
                {staff.map(s => {
                  const mine = rows.filter(r => r.employee_id === s.id);
                  const payable = mine.reduce((t, r) => t + Number(r.payable_fraction), 0);
                  const employed = mine.filter(r => r.status !== 'not_joined' && r.status !== 'exited').length;
                  const lop = Math.max(0, Math.round((employed - payable) * 100) / 100);
                  return (
                    <tr key={s.id}>
                      <td className="hr-sticky whitespace-nowrap">
                        <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{s.full_name}</p>
                        <p style={{ color: 'var(--text-faint)' }}>{s.employee_code}</p>
                      </td>
                      {days.map(d => {
                        const c = cell(s.id, d);
                        const code = c ? STATUS_CODE[c.status] ?? '?' : '·';
                        const rgb = !c ? '148,163,184'
                          : c.status === 'present' || c.status === 'on_duty' ? '16,185,129'
                          : c.status === 'half_day' ? '245,158,11'
                          : c.status === 'absent' || c.status === 'unpaid_leave' ? '239,68,68'
                          : c.status === 'paid_leave' ? '59,130,246'
                          : c.status === 'holiday' ? '139,92,246'
                          : '148,163,184';
                        return (
                          <td key={d} className="text-center px-1"
                            title={c ? `${d} · ${c.status}${c.is_late ? ' · late' : ''}` : d}>
                            <span className="inline-block w-5 h-5 leading-5 rounded font-bold"
                              style={{ background: `rgba(${rgb},0.14)`, color: `rgb(${rgb})` }}>
                              {code}
                            </span>
                          </td>
                        );
                      })}
                      <td className="text-center font-bold tabular-nums">{Math.round(payable * 100) / 100}</td>
                      <td className="text-center font-bold tabular-nums"
                        style={{ color: lop > 0 ? 'rgb(239,68,68)' : 'inherit' }}>{lop}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionCard>
  );
}

/* ======================================================================== */
/* Approvals                                                                 */
/* ======================================================================== */

function Approvals({ onToast, canEdit, onChanged }: {
  onToast: (m: string, ok?: boolean) => void; canEdit: boolean; onChanged: () => void;
}) {
  const [punches, setPunches] = useState<AttendancePunch[]>([]);
  const [adjustments, setAdjustments] = useState<AttendanceAdjustment[]>([]);
  const [staff, setStaff] = useState<HREmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirm, setConfirm] = useState<
    { kind: 'punch' | 'adjustment'; id: string; approve: boolean; label: string } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  // "Trust this network" -- the address of a held punch, offered for allowlisting.
  const [trustIp, setTrustIp] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, a, s] = await Promise.all([
        api.listPendingPunches(), api.listAdjustments({ pendingOnly: true }), api.listHREmployees(true),
      ]);
      setPunches(p); setAdjustments(a); setStaff(s);
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => { load(); }, [load]);

  const nameOf = (id: string) => staff.find(s => s.id === id)?.full_name ?? 'Unknown';
  const codeOf = (id: string) => staff.find(s => s.id === id)?.employee_code ?? '';

  const decide = async () => {
    if (!confirm) return;
    setBusy(true);
    try {
      if (confirm.kind === 'punch') await api.reviewPunch(confirm.id, confirm.approve, note);
      else await api.reviewAdjustment(confirm.id, confirm.approve, note);
      onToast(confirm.approve ? 'Approved — attendance has been recalculated.' : 'Rejected.');
      setConfirm(null); setNote('');
      load(); onChanged();
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Skeleton rows={6} />;

  return (
    <div className="space-y-5">
      <SectionCard
        title="Off-network punches"
        subtitle="Recorded from outside an approved office network. They do not count towards hours or pay until approved."
        padded={false}
      >
        <div className="p-5">
          {punches.length === 0 ? (
            <EmptyState icon={ShieldCheck} title="Nothing waiting" message="Every punch so far was made from an approved office network." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className="text-left">Employee</th><th className="text-left">When</th>
                  <th className="text-left">Type</th><th className="text-left">Detected IP</th>
                  <th className="text-left">Device</th><th className="text-right">Decision</th>
                </tr>
              </thead>
              <tbody>
                {punches.map(p => (
                  <tr key={p.id}>
                    <td>
                      <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{nameOf(p.employee_id)}</p>
                      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{codeOf(p.employee_id)}</p>
                    </td>
                    <td className="whitespace-nowrap">{dayLabel(p.work_date)} · {timeOf(p.punched_at)}</td>
                    <td><Pill value={p.punch_type === 'in' ? 'Punch in' : 'Punch out'} small /></td>
                    <td className="font-mono text-xs">{p.detected_ip ? String(p.detected_ip) : 'not detected'}</td>
                    <td className="max-w-[220px] truncate text-xs" style={{ color: 'var(--text-faint)' }}>{p.user_agent}</td>
                    <td className="text-right whitespace-nowrap">
                      {canEdit ? (
                        <>
                          <button onClick={() => setConfirm({ kind: 'punch', id: p.id, approve: true, label: `${nameOf(p.employee_id)} — ${p.punch_type} at ${timeOf(p.punched_at)}` })}
                            className="text-xs font-semibold mr-3" style={{ color: 'rgb(16,185,129)' }}>
                            <CheckCircle2 className="w-3.5 h-3.5 inline mr-0.5" />Approve
                          </button>
                          <button onClick={() => setConfirm({ kind: 'punch', id: p.id, approve: false, label: `${nameOf(p.employee_id)} — ${p.punch_type} at ${timeOf(p.punched_at)}` })}
                            className="text-xs font-semibold mr-3" style={{ color: 'rgb(239,68,68)' }}>
                            <XCircle className="w-3.5 h-3.5 inline mr-0.5" />Reject
                          </button>
                          {p.detected_ip && (
                            <button onClick={() => setTrustIp(String(p.detected_ip))}
                              className="text-xs font-semibold" style={{ color: 'var(--accent-soft)' }}
                              title="Add this address as an approved office network and clear every punch held from it">
                              <ShieldCheck className="w-3.5 h-3.5 inline mr-0.5" />Trust network
                            </button>
                          )}
                        </>
                      ) : <span className="text-xs" style={{ color: 'var(--text-faint)' }}>View only</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
      </SectionCard>

      <SectionCard
        title="Attendance corrections"
        subtitle="Approving a correction never rewrites the original punches — it records an adjustment beside them."
        padded={false}
      >
        <div className="p-5">
          {adjustments.length === 0 ? (
            <EmptyState icon={ClipboardCheck} title="No correction requests" />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className="text-left">Employee</th><th className="text-left">Date</th><th className="text-left">Type</th>
                  <th className="text-left">Requested</th><th className="text-left">Reason</th><th className="text-right">Decision</th>
                </tr>
              </thead>
              <tbody>
                {adjustments.map(a => (
                  <tr key={a.id}>
                    <td>
                      <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{nameOf(a.employee_id)}</p>
                      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{codeOf(a.employee_id)}</p>
                    </td>
                    <td className="whitespace-nowrap">{dayLabel(a.work_date)}</td>
                    <td>{a.kind.replace(/_/g, ' ')}</td>
                    <td className="whitespace-nowrap tabular-nums">
                      {timeOf(a.requested_in_at)} → {timeOf(a.requested_out_at)}
                    </td>
                    <td className="max-w-xs truncate">{a.reason}</td>
                    <td className="text-right whitespace-nowrap">
                      {canEdit ? (
                        <>
                          <button onClick={() => setConfirm({ kind: 'adjustment', id: a.id, approve: true, label: `${nameOf(a.employee_id)} — ${dayLabel(a.work_date)}` })}
                            className="text-xs font-semibold mr-3" style={{ color: 'rgb(16,185,129)' }}>Approve</button>
                          <button onClick={() => setConfirm({ kind: 'adjustment', id: a.id, approve: false, label: `${nameOf(a.employee_id)} — ${dayLabel(a.work_date)}` })}
                            className="text-xs font-semibold" style={{ color: 'rgb(239,68,68)' }}>Reject</button>
                        </>
                      ) : <span className="text-xs" style={{ color: 'var(--text-faint)' }}>View only</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
      </SectionCard>

      {trustIp && (
        <TrustNetworkDialog
          ip={trustIp}
          pendingFromIp={punches.filter(x => String(x.detected_ip ?? '') === trustIp).length}
          employeesFromIp={new Set(punches.filter(x => String(x.detected_ip ?? '') === trustIp)
            .map(x => x.employee_id)).size}
          onClose={() => setTrustIp(null)}
          onDone={msg => { setTrustIp(null); onToast(msg); load(); onChanged(); }}
          onError={m => onToast(m, false)}
        />
      )}

      <ConfirmDialog
        open={!!confirm}
        tone={confirm?.approve ? 'accent' : 'bad'}
        title={confirm?.approve ? 'Approve this attendance?' : 'Reject this attendance?'}
        message={confirm?.label}
        confirmLabel={confirm?.approve ? 'Approve' : 'Reject'}
        busy={busy}
        onCancel={() => { setConfirm(null); setNote(''); }}
        onConfirm={decide}
      >
        <Field label="Note" hint="Recorded in the audit trail alongside your name.">
          <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}


/**
 * Turn a held punch's address into an approved office network.
 *
 * The address shown here was detected by the server for a real punch, so it is
 * the office's actual public IP rather than something typed from memory. That
 * is why this exists at all: on the first day of enforcement the queue IS the
 * discovery mechanism, and copying an address between two tabs to act on it is
 * pure friction.
 */
function TrustNetworkDialog({ ip, pendingFromIp, employeesFromIp, onClose, onDone, onError }: {
  ip: string;
  pendingFromIp: number;
  employeesFromIp: number;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('Niyom Chennai Office');
  const [location, setLocation] = useState('Chennai');
  const [approvePending, setApprovePending] = useState(true);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!name.trim()) { onError('Give the network a name.'); return; }
    setBusy(true);
    try {
      const res = await api.allowlistNetwork(ip, name.trim(), location.trim(), approvePending);
      onDone(res.punches_approved > 0
        ? `${ip} is now an approved office network. ${res.punches_approved} held punch(es) across ${res.employees_affected} employee(s) have been approved and their attendance recalculated.`
        : `${ip} is now an approved office network. Punches from it will be approved automatically from now on.`);
    } catch (err) {
      onError(hrError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Trust this office network">
      <div className="p-5 space-y-4">
        <div className="px-4 py-3 rounded-xl"
          style={{ background: 'rgba(var(--accent-soft-rgb),0.08)', border: '1px solid rgba(var(--accent-soft-rgb),0.25)' }}>
          <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
            Address detected by the server
          </p>
          <p className="text-lg font-bold font-mono mt-0.5" style={{ color: 'var(--accent-soft)' }}>{ip}</p>
        </div>

        <Notice tone="warn" title="Only do this if this really is a Niyom office connection">
          Every future punch from this address counts automatically, with no review. If it is someone&rsquo;s home
          broadband or a phone hotspot, approve their punches individually instead &mdash; allowlisting it would
          quietly remove the location check for them from then on.
        </Notice>

        <Field label="Network name" required hint="Shown on the punch card when someone is on this network.">
          <Input value={name} onChange={e => setName(e.target.value)} />
        </Field>

        <Field label="Location">
          <Input value={location} onChange={e => setLocation(e.target.value)} />
        </Field>

        {pendingFromIp > 0 && (
          <label className="flex items-start gap-2.5 cursor-pointer text-xs" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={approvePending} className="mt-0.5"
              onChange={e => setApprovePending(e.target.checked)} />
            <span>
              Also approve the <strong>{pendingFromIp}</strong> punch(es) already held from this address
              {employeesFromIp > 1 && <> across <strong>{employeesFromIp}</strong> employees</>}, and recalculate
              their attendance. Only punches from this exact address are affected.
            </span>
          </label>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            Cancel
          </button>
          <PrimaryButton onClick={save} disabled={busy}>
            {busy ? 'Saving\u2026' : 'Trust This Network'}
          </PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

/* ======================================================================== */
/* Office networks                                                           */
/* ======================================================================== */

function Networks({ onToast, canEdit, employee }: {
  onToast: (m: string, ok?: boolean) => void; canEdit: boolean; employee: NWEmployee;
}) {
  const [rows, setRows] = useState<AllowedNetwork[]>([]);
  const [settings, setSettings] = useState<AttendanceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<AllowedNetwork> | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [myIp, setMyIp] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [n, s] = await Promise.all([api.listNetworks(), api.getAttendanceSettings()]);
      setRows(n); setSettings(s);
      // The server's view of THIS admin's own address -- the same value a punch
      // from this machine is judged on, so the hint below can never disagree
      // with what enforcement actually does.
      const state = await api.getPunchState();
      setMyIp(state.detected_ip ?? null);
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    if (!editing.name?.trim()) { onToast('Give the network a name.', false); return; }
    if (!editing.ip_address && !editing.ip_range) { onToast('Enter either an IP address or a range.', false); return; }
    if (editing.ip_address && editing.ip_range) { onToast('Enter an address or a range, not both.', false); return; }
    setBusy(true);
    try {
      const payload = {
        name: editing.name.trim(),
        location: editing.location?.trim() || 'Chennai',
        ip_address: editing.ip_address || null,
        ip_range: editing.ip_range || null,
        status: editing.status ?? 'active',
        description: editing.description ?? '',
        effective_from: editing.effective_from ?? today(),
        effective_to: editing.effective_to || null,
        created_by: employee.id,
      };
      if (editing.id) await api.updateNetwork(editing.id, payload);
      else await api.createNetwork(payload);
      onToast('Office network saved.');
      setEditing(null);
      load();
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    setBusy(true);
    try {
      await api.deleteNetwork(deleteId);
      onToast('Network removed.');
      setDeleteId(null);
      load();
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setBusy(false);
    }
  };

  const setMode = async (mode: 'observe' | 'enforce') => {
    try {
      const s = await api.saveAttendanceSettings({ enforcement_mode: mode });
      setSettings(s);
      onToast(mode === 'enforce'
        ? 'Enforcement is on. Off-network punches are now held for approval.'
        : 'Switched to observe mode. Punches are recorded but never blocked.');
    } catch (err) {
      onToast(hrError(err), false);
    }
  };

  if (loading) return <Skeleton rows={5} />;

  const observing = settings?.enforcement_mode === 'observe';

  return (
    <div className="space-y-5">
      {observing && (
        <Notice tone="info" title="Observe mode — nothing is being blocked yet">
          Every punch is being recorded with the network it came from, but none are refused or held. Let a normal week
          run, check the detected IPs in the Approvals and Today tabs, add the ones that are genuinely the office below,
          and only then switch on enforcement. Turning it on before the real addresses are known is how people end up
          locked out at the door.
        </Notice>
      )}

      <SectionCard
        title="Network enforcement"
        subtitle="Where attendance may be punched from. Checked on the server for every punch — never in the browser."
        actions={canEdit && (
          <div className="flex items-center gap-2">
            <button onClick={() => setMode('observe')}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{
                background: observing ? 'rgba(59,130,246,0.15)' : 'var(--bg-base)',
                color: observing ? 'rgb(59,130,246)' : 'var(--text-muted)',
                border: `1px solid ${observing ? 'rgba(59,130,246,0.35)' : 'var(--border)'}`,
              }}>Observe</button>
            <button onClick={() => setMode('enforce')}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold"
              style={{
                background: !observing ? 'rgba(16,185,129,0.15)' : 'var(--bg-base)',
                color: !observing ? 'rgb(16,185,129)' : 'var(--text-muted)',
                border: `1px solid ${!observing ? 'rgba(16,185,129,0.35)' : 'var(--border)'}`,
              }}>Enforce</button>
          </div>
        )}
      >
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text-secondary)' }}>Observe</strong> records the network a punch came from and
          allows it either way. <strong style={{ color: 'var(--text-secondary)' }}>Enforce</strong> auto-approves punches
          from the networks below and holds every other punch as <em>pending</em> until an administrator approves it —
          nobody is turned away, but off-network time does not count until someone says so.
        </p>
      </SectionCard>

      <SectionCard
        title="Approved office networks"
        subtitle="Public IPs only. A private address such as 192.168.x.x identifies nothing — every office in the country has one."
        actions={canEdit && <PrimaryButton onClick={() => setEditing({ status: 'active', location: 'Chennai', effective_from: today() })}>
          <Network className="w-3.5 h-3.5 inline mr-1" />Add Network
        </PrimaryButton>}
        padded={false}
      >
        {/* The address the server sees for THIS session. Stated up front rather
            than only inside the Add dialog: if you are sitting in the office,
            this IS the value to add, and it is the same one enforcement checks. */}
        {myIp && canEdit && (
          <div className="mx-5 mt-4 px-4 py-3 rounded-xl flex items-center justify-between gap-3 flex-wrap"
            style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
                The server currently sees you at
              </p>
              <p className="text-sm font-bold font-mono mt-0.5" style={{ color: 'var(--text-primary)' }}>{myIp}</p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                {rows.some(n => String(n.ip_address ?? '') === myIp)
                  ? 'Already on the approved list.'
                  : 'Add it only if you are on the office connection right now — from home this would allowlist your home broadband.'}
              </p>
            </div>
            {!rows.some(n => String(n.ip_address ?? '') === myIp) && (
              <GhostButton onClick={() => setEditing({
                status: 'active', location: 'Chennai', effective_from: today(),
                name: 'Niyom Chennai Office', ip_address: myIp,
              })}>
                Add this address
              </GhostButton>
            )}
          </div>
        )}

        <div className="p-5">
          {rows.length === 0 ? (
            <EmptyState icon={Network} title="No approved networks yet"
              message="Until one is added, enforcement would refuse every punch — which is why the module ships in observe mode." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className="text-left">Name</th><th className="text-left">Location</th>
                  <th className="text-left">Address / Range</th><th className="text-left">Effective</th>
                  <th className="text-left">Status</th><th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(n => (
                  <tr key={n.id}>
                    <td>
                      <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{n.name}</p>
                      {n.description && <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{n.description}</p>}
                    </td>
                    <td>{n.location}</td>
                    <td className="font-mono text-xs">{String(n.ip_address ?? n.ip_range ?? '')}</td>
                    <td className="text-xs whitespace-nowrap">
                      {dayLabel(n.effective_from)}{n.effective_to ? ` → ${dayLabel(n.effective_to)}` : ''}
                    </td>
                    <td><Pill value={n.status} small /></td>
                    <td className="text-right whitespace-nowrap">
                      {canEdit && (
                        <>
                          <button onClick={() => setEditing(n)} className="text-xs font-semibold mr-3"
                            style={{ color: 'var(--accent-soft)' }}>Edit</button>
                          <button onClick={() => setDeleteId(n.id)} className="text-xs font-semibold"
                            style={{ color: 'rgb(239,68,68)' }}>Remove</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
      </SectionCard>

      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? 'Edit office network' : 'Add office network'}>
          <div className="p-5 space-y-4">
            <Notice tone="info">
              Find your office's public IP by visiting a "what is my IP" service <em>from the office connection</em>.
              If the ISP changes it periodically, add the ISP's range as a CIDR instead of a single address.
              {myIp && (
                <>
                  {' '}The server currently sees you at <strong>{myIp}</strong>.{' '}
                  <button type="button" className="underline font-semibold"
                    onClick={() => setEditing({ ...editing, ip_address: myIp, ip_range: null })}>
                    Use this address
                  </button>
                </>
              )}
            </Notice>

            <Field label="Network name" required>
              <Input value={editing.name ?? ''} onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="Niyom Chennai Office" />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Location">
                <Input value={editing.location ?? ''} onChange={e => setEditing({ ...editing, location: e.target.value })} />
              </Field>
              <Field label="Status">
                <Select value={editing.status ?? 'active'} onChange={e => setEditing({ ...editing, status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Public IP address" hint="A single fixed address">
                <Input value={(editing.ip_address as string) ?? ''} placeholder="49.37.200.5"
                  onChange={e => setEditing({ ...editing, ip_address: e.target.value || null, ip_range: null })} />
              </Field>
              <Field label="…or IP range (CIDR)" hint="For a rotating address">
                <Input value={(editing.ip_range as string) ?? ''} placeholder="49.37.200.0/24"
                  onChange={e => setEditing({ ...editing, ip_range: e.target.value || null, ip_address: null })} />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Effective from">
                <Input type="date" value={editing.effective_from ?? today()}
                  onChange={e => setEditing({ ...editing, effective_from: e.target.value })} />
              </Field>
              <Field label="Effective to" hint="Leave blank for open-ended">
                <Input type="date" value={editing.effective_to ?? ''}
                  onChange={e => setEditing({ ...editing, effective_to: e.target.value || null })} />
              </Field>
            </div>

            <Field label="Description">
              <Input value={editing.description ?? ''} onChange={e => setEditing({ ...editing, description: e.target.value })}
                placeholder="Primary broadband line" />
            </Field>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <PrimaryButton onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Network'}</PrimaryButton>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!deleteId}
        title="Remove this office network?"
        message="Punches already recorded keep the network they were made from. Future punches from this address will be treated as off-network."
        confirmLabel="Remove"
        busy={busy}
        onCancel={() => setDeleteId(null)}
        onConfirm={remove}
      />
    </div>
  );
}

/* ======================================================================== */
/* Rules                                                                     */
/* ======================================================================== */

function Rules({ onToast, canEdit }: { onToast: (m: string, ok?: boolean) => void; canEdit: boolean }) {
  const [s, setS] = useState<AttendanceSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.getAttendanceSettings().then(setS); }, []);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    try {
      await api.saveAttendanceSettings({
        office_start: s.office_start, office_end: s.office_end,
        grace_minutes: s.grace_minutes, late_after_minutes: s.late_after_minutes,
        early_out_before_minutes: s.early_out_before_minutes,
        full_day_minutes: s.full_day_minutes, half_day_minutes: s.half_day_minutes,
        overtime_after_minutes: s.overtime_after_minutes, break_minutes: s.break_minutes,
        rounding_minutes: s.rounding_minutes, punch_cooldown_seconds: s.punch_cooldown_seconds,
        max_punches_per_day: s.max_punches_per_day, rate_limit_per_minute: s.rate_limit_per_minute,
        auto_punch_out_after_minutes: s.auto_punch_out_after_minutes,
        trusted_proxy_hops: s.trusted_proxy_hops,
      });
      onToast('Attendance rules saved. They apply from the next recalculation.');
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setSaving(false);
    }
  };

  if (!s) return <Skeleton rows={6} />;

  const num = (k: keyof AttendanceSettings) => ({
    type: 'number' as const,
    value: String(s[k] ?? ''),
    disabled: !canEdit,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
      setS({ ...s, [k]: e.target.value === '' ? null : Number(e.target.value) }),
  });

  return (
    <div className="space-y-5">
      <SectionCard
        title="Office hours and thresholds"
        subtitle="Nothing here is hardcoded — these values decide late, half day, overtime and payable days."
        actions={canEdit && <PrimaryButton onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Rules'}</PrimaryButton>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="Office start">
            <Input type="time" value={s.office_start?.slice(0, 5)} disabled={!canEdit}
              onChange={e => setS({ ...s, office_start: e.target.value })} />
          </Field>
          <Field label="Office end">
            <Input type="time" value={s.office_end?.slice(0, 5)} disabled={!canEdit}
              onChange={e => setS({ ...s, office_end: e.target.value })} />
          </Field>
          <Field label="Grace period (minutes)" hint="Shown to staff as the allowance before late">
            <Input {...num('grace_minutes')} />
          </Field>
          <Field label="Late after (minutes past start)" hint="10:00 start + 15 → 10:16 is late">
            <Input {...num('late_after_minutes')} />
          </Field>
          <Field label="Early checkout before (minutes)" hint="Minutes before office end that counts as early">
            <Input {...num('early_out_before_minutes')} />
          </Field>
          <Field label="Full day (minutes worked)">
            <Input {...num('full_day_minutes')} />
          </Field>
          <Field label="Half day (minutes worked)" hint="Below this, the day counts as absent">
            <Input {...num('half_day_minutes')} />
          </Field>
          <Field label="Overtime after (minutes)">
            <Input {...num('overtime_after_minutes')} />
          </Field>
          <Field label="Unpaid break (minutes)" hint="Deducted from worked time each day">
            <Input {...num('break_minutes')} />
          </Field>
          <Field label="Round worked time to (minutes)" hint="0 = no rounding">
            <Input {...num('rounding_minutes')} />
          </Field>
          <Field label="Auto punch-out after (minutes)" hint="Blank = never; a forgotten punch-out is simply flagged">
            <Input {...num('auto_punch_out_after_minutes')} />
          </Field>
        </div>
      </SectionCard>

      <SectionCard title="Abuse control" subtitle="Applied inside the punch transaction, not in the browser.">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Field label="Cooldown between punches (seconds)" hint="Stops a double tap becoming two punches">
            <Input {...num('punch_cooldown_seconds')} />
          </Field>
          <Field label="Maximum punches per day">
            <Input {...num('max_punches_per_day')} />
          </Field>
          <Field label="Attempts allowed per minute">
            <Input {...num('rate_limit_per_minute')} />
          </Field>
          <Field label="Trusted proxy hops" hint="0 unless a CDN sits in front of the API. Changing this changes which forwarded address is trusted.">
            <Input {...num('trusted_proxy_hops')} />
          </Field>
        </div>
      </SectionCard>
    </div>
  );
}
