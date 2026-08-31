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
  CalendarRange, CheckCircle2, ClipboardCheck, Download, MapPin, Network, PauseCircle, RefreshCw, ShieldCheck, XCircle,
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
  AttendanceSettings, EmployeeBreak, HRAccess, HREmployee, OfficeLocation, WorkArrangement,
} from './hrTypes';
import { formatDuration } from '../../lib/hr/attendanceSummary';
import { exportSheet, exportWorkbook, periodStamp } from './hrExcel';
import { looksLikeInfrastructure } from './infrastructureIp';
import { getPosition, type GeoResult } from './geolocation';

type Tab = 'today' | 'register' | 'approvals' | 'arrangements' | 'offices' | 'networks' | 'rules';

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
          { key: 'arrangements', label: 'Arrangements & Breaks' },
          { key: 'offices',   label: 'Office Locations' },
          { key: 'networks',  label: 'Networks (audit)' },
          { key: 'rules',     label: 'Rules' },
        ]}
      />

      {tab === 'today'     && <TodayBoard onToast={show} />}
      {tab === 'register'  && <Register onToast={show} canEdit={access.canEdit.attendance} />}
      {tab === 'approvals' && <Approvals onToast={show} canEdit={access.canEdit.attendance} onChanged={refreshCounts} />}
      {tab === 'arrangements' && <Arrangements onToast={show} canEdit={access.canEdit.attendance} employee={employee} />}
      {tab === 'offices'   && <Offices onToast={show} canEdit={access.canEdit.attendance} employee={employee} />}
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
      const [d, s] = await Promise.all([api.listDailyForDate(date), api.listHREmployees(false, true)]);
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
                      !['weekly_off', 'holiday', 'paid_leave', 'unpaid_leave', 'not_joined', 'exited',
                        'working', 'upcoming'].includes(m.day?.status ?? '')).length;
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
  // A day still running, and one that has not arrived. Neither is attendance
  // yet, so neither gets a letter that reads as a verdict.
  working: '•', upcoming: '·',
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
      const [d, s] = await Promise.all([api.listDailyForRange(from, to), api.listHREmployees(true, true)]);
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
        count(r => !['weekly_off', 'holiday', 'not_joined', 'exited', 'upcoming'].includes(r.status)),
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
                          : c.status === 'paid_leave' || c.status === 'working' ? '59,130,246'
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
/* Work arrangements                                                         */
/* ======================================================================== */

const ARRANGEMENT_KINDS: { value: string; label: string }[] = [
  { value: 'remote',     label: 'Working from home' },
  { value: 'field',      label: 'Field work' },
  { value: 'deputation', label: 'Deputation / client site' },
  { value: 'other',      label: 'Other' },
];

function Arrangements({ onToast, canEdit, employee }: {
  onToast: (m: string, ok?: boolean) => void; canEdit: boolean; employee: NWEmployee;
}) {
  const [rows, setRows] = useState<WorkArrangement[]>([]);
  const [staff, setStaff] = useState<HREmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<WorkArrangement> | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [endDate, setEndDate] = useState(today());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, s] = await Promise.all([api.listArrangements(), api.listHREmployees(true, false)]);
      setRows(a); setStaff(s);
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => { load(); }, [load]);

  const nameOf = (id: string) => staff.find(s => s.id === id)?.full_name ?? '—';

  const save = async () => {
    if (!editing) return;
    if (!editing.employee_id) { onToast('Choose the employee.', false); return; }
    if (!editing.from_date)   { onToast('Enter the date this starts.', false); return; }
    if ((editing.label ?? '').trim().length < 3) {
      onToast('Give a short reason — it is shown against every day it settles.', false); return;
    }
    if (editing.to_date && editing.to_date < editing.from_date) {
      onToast('The end date cannot be before the start date.', false); return;
    }
    setBusy(true);
    try {
      const payload = {
        employee_id: editing.employee_id,
        kind: editing.kind ?? 'remote',
        from_date: editing.from_date,
        to_date: editing.to_date || null,
        label: (editing.label ?? '').trim(),
        status: editing.status ?? 'active',
        created_by: employee.id,
      };
      if (editing.id) await api.updateArrangement(editing.id, payload);
      else await api.createArrangement(payload);
      onToast('Saved. Recalculate attendance for the period to apply it.');
      setEditing(null);
      load();
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setBusy(false);
    }
  };

  const end = async () => {
    if (!endingId) return;
    setBusy(true);
    try {
      await api.endArrangement(endingId, endDate);
      onToast('Arrangement ended. Recalculate attendance from the day after to apply it.');
      setEndingId(null);
      load();
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Skeleton rows={4} />;

  return (
    <div className="space-y-5">
      <Notice tone="info" title="For someone who is working, but has no office to punch in at">
        Maternity working from home, a medical restriction, a posting to a client site. Days inside an arrangement
        settle as <strong>on duty</strong> and pay in full, so nobody has to waive loss of pay by hand every month.
        It never overrides a holiday, a weekly off, approved leave or an admin correction — and if they do come in
        and punch, the punch decides the day as usual.
      </Notice>

      <SectionCard
        title="Work arrangements"
        subtitle="Periods when an employee works without punching, and is paid for it."
        actions={canEdit && <PrimaryButton onClick={() => setEditing({
          kind: 'remote', from_date: today(), status: 'active',
        })}>
          <CalendarRange className="w-3.5 h-3.5 inline mr-1" />Add Arrangement
        </PrimaryButton>}
        padded={false}
      >
        <div className="p-5">
          {rows.length === 0 ? (
            <EmptyState icon={CalendarRange} title="No arrangements"
              message="Everyone is expected to punch. Add one for anyone who is working but cannot." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className="text-left">Employee</th><th className="text-left">Kind</th>
                  <th className="text-left">Reason shown on the register</th>
                  <th className="text-left">From</th><th className="text-left">To</th>
                  <th className="text-left">Status</th><th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(a => (
                  <tr key={a.id} style={{ opacity: a.status === 'active' ? 1 : 0.6 }}>
                    <td className="font-semibold" style={{ color: 'var(--text-primary)' }}>{nameOf(a.employee_id)}</td>
                    <td>{ARRANGEMENT_KINDS.find(k => k.value === a.kind)?.label ?? a.kind}</td>
                    <td className="text-xs">{a.label}</td>
                    <td className="text-xs whitespace-nowrap">{dayLabel(a.from_date)}</td>
                    <td className="text-xs whitespace-nowrap">
                      {a.to_date ? dayLabel(a.to_date)
                        : <span style={{ color: 'var(--text-faint)' }}>still running</span>}
                    </td>
                    <td><Pill value={a.status} small /></td>
                    <td className="text-right whitespace-nowrap">
                      {canEdit && (
                        <>
                          <button onClick={() => setEditing(a)} className="text-xs font-semibold mr-3"
                            style={{ color: 'var(--accent-soft)' }}>Edit</button>
                          {a.status === 'active' && (
                            <button onClick={() => { setEndingId(a.id); setEndDate(today()); }}
                              className="text-xs font-semibold" style={{ color: 'rgb(239,68,68)' }}>End</button>
                          )}
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
        <Modal open onClose={() => setEditing(null)}
          title={editing.id ? 'Edit work arrangement' : 'Add work arrangement'}>
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Employee" required>
                <Select value={editing.employee_id ?? ''} disabled={!!editing.id}
                  onChange={e => setEditing({ ...editing, employee_id: e.target.value })}>
                  <option value="">Choose…</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </Select>
              </Field>
              <Field label="Kind">
                <Select value={editing.kind ?? 'remote'}
                  onChange={e => setEditing({ ...editing, kind: e.target.value })}>
                  {ARRANGEMENT_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                </Select>
              </Field>
            </div>

            <Field label="Reason" required
              hint="Shown against every day it settles, so the register explains itself later.">
              <Input value={editing.label ?? ''} onChange={e => setEditing({ ...editing, label: e.target.value })}
                placeholder="Maternity — working from home" />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="From" required>
                <Input type="date" value={editing.from_date ?? today()}
                  onChange={e => setEditing({ ...editing, from_date: e.target.value })} />
              </Field>
              <Field label="To" hint="Leave blank while it is still running.">
                <Input type="date" value={editing.to_date ?? ''}
                  onChange={e => setEditing({ ...editing, to_date: e.target.value || null })} />
              </Field>
            </div>

            <Notice tone="info">
              Saving records the arrangement. To apply it to days already computed, use
              <strong> Recalculate</strong> on the Monthly Register for the period.
            </Notice>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <PrimaryButton onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</PrimaryButton>
            </div>
          </div>
        </Modal>
      )}

      <Breaks onToast={onToast} canEdit={canEdit} employee={employee} staff={staff} />

      {endingId && (
        <Modal open onClose={() => setEndingId(null)} title="End this arrangement">
          <div className="p-5 space-y-4">
            <Notice tone="warn">
              Days up to and including the last day keep the on-duty settlement they already have. From the day
              after, this person is expected to punch again like everyone else.
            </Notice>
            <Field label="Last day of the arrangement" required>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEndingId(null)} className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <PrimaryButton onClick={end} disabled={busy}>{busy ? 'Ending…' : 'End Arrangement'}</PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

const BREAK_KINDS: { value: string; label: string }[] = [
  { value: 'maternity',    label: 'Maternity' },
  { value: 'medical',      label: 'Medical' },
  { value: 'sabbatical',   label: 'Sabbatical' },
  { value: 'unpaid_leave', label: 'Extended unpaid leave' },
  { value: 'other',        label: 'Other' },
];

function Breaks({ onToast, canEdit, employee, staff }: {
  onToast: (m: string, ok?: boolean) => void; canEdit: boolean;
  employee: NWEmployee; staff: HREmployee[];
}) {
  const [rows, setRows] = useState<EmployeeBreak[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<EmployeeBreak> | null>(null);
  const [endingId, setEndingId] = useState<string | null>(null);
  const [endDate, setEndDate] = useState(today());
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api.listBreaks()); }
    catch (err) { onToast(hrError(err), false); }
    finally { setLoading(false); }
  }, [onToast]);

  useEffect(() => { load(); }, [load]);

  const nameOf = (id: string) => staff.find(s => s.id === id)?.full_name ?? '—';

  const save = async () => {
    if (!editing) return;
    if (!editing.employee_id) { onToast('Choose the employee.', false); return; }
    if (!editing.from_date)   { onToast('Enter the first day of the break.', false); return; }
    if ((editing.label ?? '').trim().length < 3) {
      onToast('Give a short reason — it is shown against every day it settles.', false); return;
    }
    if (editing.to_date && editing.to_date < editing.from_date) {
      onToast('The last day cannot be before the first.', false); return;
    }
    setBusy(true);
    try {
      const payload = {
        employee_id: editing.employee_id, kind: editing.kind ?? 'maternity',
        from_date: editing.from_date, to_date: editing.to_date || null,
        label: (editing.label ?? '').trim(), status: editing.status ?? 'active',
        created_by: employee.id,
      };
      if (editing.id) await api.updateBreak(editing.id, payload);
      else await api.createBreak(payload);
      onToast('Break saved. Recalculate the register for that period to apply it.');
      setEditing(null);
      load();
    } catch (err) { onToast(hrError(err), false); }
    finally { setBusy(false); }
  };

  const end = async () => {
    if (!endingId) return;
    setBusy(true);
    try {
      await api.endBreak(endingId, endDate);
      onToast('Break ended. Recalculate from the next day to put them back on payroll.');
      setEndingId(null);
      load();
    } catch (err) { onToast(hrError(err), false); }
    finally { setBusy(false); }
  };

  if (loading) return <Skeleton rows={3} />;

  return (
    <>
      <SectionCard
        title="Breaks from payroll"
        subtitle="Maternity, sabbatical, extended unpaid leave — salary stops entirely and restarts when the break ends."
        actions={canEdit && <PrimaryButton onClick={() => setEditing({
          kind: 'maternity', from_date: today(), status: 'active',
        })}>
          <PauseCircle className="w-3.5 h-3.5 inline mr-1" />Start a Break
        </PrimaryButton>}
        padded={false}
      >
        <div className="p-5">
          {rows.length === 0 ? (
            <EmptyState icon={PauseCircle} title="Nobody is on a break"
              message="Start one for anyone stepping away for a while. Their days stop being payable and never become loss of pay." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className="text-left">Employee</th><th className="text-left">Kind</th>
                  <th className="text-left">Reason shown on the register</th>
                  <th className="text-left">From</th><th className="text-left">To</th>
                  <th className="text-left">Status</th><th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(b => (
                  <tr key={b.id} style={{ opacity: b.status === 'active' ? 1 : 0.6 }}>
                    <td className="font-semibold" style={{ color: 'var(--text-primary)' }}>{nameOf(b.employee_id)}</td>
                    <td>{BREAK_KINDS.find(k => k.value === b.kind)?.label ?? b.kind}</td>
                    <td className="text-xs">{b.label}</td>
                    <td className="text-xs whitespace-nowrap">{dayLabel(b.from_date)}</td>
                    <td className="text-xs whitespace-nowrap">
                      {b.to_date ? dayLabel(b.to_date)
                        : <span style={{ color: 'rgb(245,158,11)' }}>until you end it</span>}
                    </td>
                    <td><Pill value={b.status} small /></td>
                    <td className="text-right whitespace-nowrap">
                      {canEdit && (
                        <>
                          <button onClick={() => setEditing(b)} className="text-xs font-semibold mr-3"
                            style={{ color: 'var(--accent-soft)' }}>Edit</button>
                          {b.status === 'active' && (
                            <button onClick={() => { setEndingId(b.id); setEndDate(today()); }}
                              className="text-xs font-semibold" style={{ color: 'rgb(16,185,129)' }}>
                              Return to work
                            </button>
                          )}
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
        <Modal open onClose={() => setEditing(null)} title={editing.id ? 'Edit break' : 'Start a break'}>
          <div className="p-5 space-y-4">
            <Notice tone="warn" title="Salary stops for the whole break">
              Every day inside the break — including weekends and public holidays — becomes unpaid. It is never
              recorded as absence, so it produces no loss of pay and nothing to waive. If the employee is being paid
              through this period, use <strong>Maternity Leave</strong> on the Leave screen instead.
            </Notice>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Employee" required>
                <Select value={editing.employee_id ?? ''} disabled={!!editing.id}
                  onChange={e => setEditing({ ...editing, employee_id: e.target.value })}>
                  <option value="">Choose…</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.full_name}</option>)}
                </Select>
              </Field>
              <Field label="Kind">
                <Select value={editing.kind ?? 'maternity'}
                  onChange={e => setEditing({ ...editing, kind: e.target.value })}>
                  {BREAK_KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                </Select>
              </Field>
            </div>

            <Field label="Reason" required hint="Shown against every day it settles.">
              <Input value={editing.label ?? ''} onChange={e => setEditing({ ...editing, label: e.target.value })}
                placeholder="Maternity break — resumes on notice" />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="First day" required>
                <Input type="date" value={editing.from_date ?? today()}
                  onChange={e => setEditing({ ...editing, from_date: e.target.value })} />
              </Field>
              <Field label="Last day"
                hint="Leave blank if you do not know yet — that is the usual case.">
                <Input type="date" value={editing.to_date ?? ''}
                  onChange={e => setEditing({ ...editing, to_date: e.target.value || null })} />
              </Field>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <PrimaryButton onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Break'}</PrimaryButton>
            </div>
          </div>
        </Modal>
      )}

      {endingId && (
        <Modal open onClose={() => setEndingId(null)} title="Bring them back onto payroll">
          <div className="p-5 space-y-4">
            <Notice tone="info">
              Days up to and including the last day stay unpaid. From the day after, they are back on payroll and
              expected to punch — or covered by a work arrangement, if one applies.
            </Notice>
            <Field label="Last day of the break" required>
              <Input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEndingId(null)} className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <PrimaryButton onClick={end} disabled={busy}>{busy ? 'Saving…' : 'End Break'}</PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ======================================================================== */
/* Office locations (geofences)                                              */
/* ======================================================================== */

function Offices({ onToast, canEdit, employee }: {
  onToast: (m: string, ok?: boolean) => void; canEdit: boolean; employee: NWEmployee;
}) {
  const [rows, setRows] = useState<OfficeLocation[]>([]);
  const [settings, setSettings] = useState<AttendanceSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<OfficeLocation> | null>(null);
  const [retireId, setRetireId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // This admin's own fix, used only to offer "use where I am standing now".
  // Taken on demand rather than on load: asking for GPS to render a settings
  // page trains people to dismiss the prompt.
  const [here, setHere] = useState<GeoResult | null>(null);
  const [fixing, setFixing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [o, s] = await Promise.all([api.listOffices(), api.getAttendanceSettings()]);
      setRows(o); setSettings(s);
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => { load(); }, [load]);

  const locate = async () => {
    setFixing(true);
    const fix = await getPosition();
    setHere(fix);
    setFixing(false);
    if (!fix.ok) { onToast(fix.message, false); return; }
    if (fix.accuracy > 100) {
      onToast(`Your position is only accurate to about ${Math.round(fix.accuracy)} m. `
        + 'Set the geofence from inside the office, on a device with a clear signal.', false);
    }
  };

  const save = async () => {
    if (!editing) return;
    const lat = Number(editing.latitude), lon = Number(editing.longitude);
    if (!editing.name?.trim()) { onToast('Give the office a name.', false); return; }
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) { onToast('Enter both latitude and longitude.', false); return; }
    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) { onToast('Those coordinates are out of range.', false); return; }
    if (lat === 0 && lon === 0) { onToast('0, 0 is in the Atlantic — that is an empty coordinate, not an office.', false); return; }
    const radius = Number(editing.radius_metres ?? 100);
    if (!Number.isFinite(radius) || radius < 20 || radius > 5000) {
      onToast('The radius must be between 20 and 5000 metres.', false); return;
    }
    setBusy(true);
    try {
      const payload = {
        name: editing.name.trim(),
        address: editing.address?.trim() ?? '',
        latitude: lat,
        longitude: lon,
        radius_metres: Math.round(radius),
        status: editing.status ?? 'active',
        description: editing.description ?? '',
        effective_from: editing.effective_from ?? today(),
        effective_to: editing.effective_to || null,
        created_by: employee.id,
      };
      if (editing.id) await api.updateOffice(editing.id, payload);
      else await api.createOffice(payload);
      onToast('Office location saved. It applies to the next punch.');
      setEditing(null);
      load();
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setBusy(false);
    }
  };

  const retire = async () => {
    if (!retireId) return;
    setBusy(true);
    try {
      await api.retireOffice(retireId);
      onToast('Office retired. Punches already recorded keep their location history.');
      setRetireId(null);
      load();
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setBusy(false);
    }
  };

  const setMode = async (location_mode: 'off' | 'observe' | 'enforce') => {
    if (location_mode === 'enforce' && !rows.some(o => o.status === 'active')) {
      onToast('Add an active office location first — enforcing with none configured would refuse everybody.', false);
      return;
    }
    try {
      setSettings(await api.saveAttendanceSettings({ location_mode }));
      onToast(
        location_mode === 'enforce' ? 'Location checks are being enforced. Off-site punches are held for approval.'
        : location_mode === 'observe' ? 'Observe mode. Locations are recorded on every punch, nothing is refused.'
        : 'Location checks are off. Punches record no position at all.');
    } catch (err) {
      onToast(hrError(err), false);
    }
  };

  const saveSetting = async (patch: Partial<AttendanceSettings>) => {
    try {
      setSettings(await api.saveAttendanceSettings(patch));
      onToast('Saved.');
    } catch (err) {
      onToast(hrError(err), false);
    }
  };

  if (loading) return <Skeleton rows={5} />;

  const mode = (settings?.location_mode ?? 'off') as 'off' | 'observe' | 'enforce';
  const active = rows.filter(o => o.status === 'active');

  return (
    <div className="space-y-5">
      {mode === 'enforce' && active.length === 0 && (
        <Notice tone="bad" title="Enforcing with no office configured">
          Location checks are switched on but no geofence has been drawn, so there is nothing to measure against and
          every punch is being accepted unverified. Add the office below.
        </Notice>
      )}

      {mode === 'observe' && (
        <Notice tone="info" title="Observe mode — nothing is being refused yet">
          Every punch records where it was made and how far that is from the office, but none are refused. Let a
          normal week run, check the register, confirm that people genuinely at their desks read as <em>inside</em>,
          and only then enforce. A radius set too tight rejects the far end of the floor.
        </Notice>
      )}

      <SectionCard
        title="Location verification"
        subtitle="Where attendance may be marked from. The distance is computed on the server for every punch — the browser is only asked for a position, never trusted to judge it."
        actions={canEdit && (
          <div className="flex items-center gap-2">
            {(['off', 'observe', 'enforce'] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold capitalize"
                style={{
                  background: mode === m ? 'rgba(59,130,246,0.15)' : 'var(--bg-base)',
                  color: mode === m ? 'rgb(59,130,246)' : 'var(--text-muted)',
                  border: `1px solid ${mode === m ? 'rgba(59,130,246,0.35)' : 'var(--border)'}`,
                }}>{m}</button>
            ))}
          </div>
        )}
      >
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          <strong style={{ color: 'var(--text-secondary)' }}>Off</strong> asks for no position at all.{' '}
          <strong style={{ color: 'var(--text-secondary)' }}>Observe</strong> records the position and distance on
          every punch and allows it either way.{' '}
          <strong style={{ color: 'var(--text-secondary)' }}>Enforce</strong> accepts a punch made inside an office
          geofence and refuses one made demonstrably outside it. What happens when the position simply cannot be
          read is set by <em>Missing or unusable position</em> below.
        </p>

        {canEdit && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mt-4">
            <Field label="Accuracy limit (metres)"
              hint="A fix vaguer than this is refused rather than guessed at. 150 suits indoor Wi-Fi positioning.">
              <Input type="number" min={20} max={2000} defaultValue={settings?.max_accuracy_metres ?? 150}
                onBlur={e => {
                  const v = Number(e.target.value);
                  if (v >= 20 && v <= 2000 && v !== settings?.max_accuracy_metres) saveSetting({ max_accuracy_metres: v });
                }} />
            </Field>
            <Field label="Simulated locations"
              hint="Android and desktop browsers can report a faked position. Refusing them is the default.">
              <Select value={settings?.reject_mock_location ? 'reject' : 'flag'}
                onChange={e => saveSetting({ reject_mock_location: e.target.value === 'reject' })}>
                <option value="reject">Refuse the punch</option>
                <option value="flag">Record and flag only</option>
              </Select>
            </Field>
            <Field label="Missing or unusable position"
              hint="A punch made demonstrably outside the office is always refused. This covers the case where the position could not be read at all.">
              <Select value={settings?.require_gps ? 'refuse' : 'pending'}
                onChange={e => saveSetting({ require_gps: e.target.value === 'refuse' })}>
                <option value="refuse">Refuse the punch</option>
                <option value="pending">Accept, hold for admin approval</option>
              </Select>
            </Field>
            <Field label="Network address"
              hint="The IP is kept on every punch as an audit trail. It no longer decides anything on its own.">
              <Select value={settings?.network_check ?? 'audit'}
                onChange={e => saveSetting({ network_check: e.target.value })}>
                <option value="audit">Record only</option>
                <option value="corroborate">Record, and treat office network as supporting evidence</option>
              </Select>
            </Field>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Office locations"
        subtitle="Set the geofence from inside the office on a phone with a clear view of the sky. Coordinates are never shown to employees — they are told only whether they are inside, and roughly how far away."
        actions={canEdit && <PrimaryButton onClick={() => setEditing({
          status: 'active', radius_metres: 100, effective_from: today(), name: 'Niyom Chennai Office',
        })}>
          <MapPin className="w-3.5 h-3.5 inline mr-1" />Add Office
        </PrimaryButton>}
        padded={false}
      >
        <div className="p-5">
          {rows.length === 0 ? (
            <EmptyState icon={MapPin} title="No office location set yet"
              message="Until one is added, location verification can only observe. Nobody's coordinates are invented for them — the office must be recorded from the office." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className="text-left">Name</th><th className="text-left">Address</th>
                  <th className="text-left">Coordinates</th><th className="text-right">Radius</th>
                  <th className="text-left">Effective</th><th className="text-left">Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(o => (
                  <tr key={o.id}>
                    <td>
                      <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{o.name}</p>
                      {o.description && <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{o.description}</p>}
                    </td>
                    <td className="text-xs">{o.address || '—'}</td>
                    <td className="font-mono text-xs whitespace-nowrap">
                      {Number(o.latitude).toFixed(6)}, {Number(o.longitude).toFixed(6)}
                    </td>
                    <td className="text-right tabular-nums">{o.radius_metres} m</td>
                    <td className="text-xs whitespace-nowrap">
                      {dayLabel(o.effective_from)}{o.effective_to ? ` → ${dayLabel(o.effective_to)}` : ''}
                    </td>
                    <td><Pill value={o.status} small /></td>
                    <td className="text-right whitespace-nowrap">
                      {canEdit && (
                        <>
                          <button onClick={() => setEditing(o)} className="text-xs font-semibold mr-3"
                            style={{ color: 'var(--accent-soft)' }}>Edit</button>
                          {o.status === 'active' && (
                            <button onClick={() => setRetireId(o.id)} className="text-xs font-semibold"
                              style={{ color: 'rgb(239,68,68)' }}>Retire</button>
                          )}
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
        <Modal open onClose={() => setEditing(null)} title={editing.id ? 'Edit office location' : 'Add office location'}>
          <div className="p-5 space-y-4">
            <Notice tone="info">
              Stand in the middle of the office and use <strong>the position I am at now</strong> below, or paste the
              coordinates from a maps app. The radius should cover the whole floor plus a little — a fence drawn tight
              around the reception desk rejects people at the far window.
            </Notice>

            <div className="px-4 py-3 rounded-xl" style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>
                    Your current position
                  </p>
                  <p className="text-sm font-bold font-mono mt-0.5" style={{ color: 'var(--text-primary)' }}>
                    {here?.ok
                      ? `${here.latitude.toFixed(6)}, ${here.longitude.toFixed(6)}`
                      : fixing ? 'Checking…' : 'Not checked yet'}
                  </p>
                  {here?.ok && (
                    <p className="text-[11px] mt-0.5" style={{ color: here.accuracy > 100 ? 'rgb(245,158,11)' : 'var(--text-faint)' }}>
                      Accurate to about {Math.round(here.accuracy)} m
                      {here.accuracy > 100 && ' — too vague to anchor a geofence on'}
                    </p>
                  )}
                  {here && !here.ok && (
                    <p className="text-[11px] mt-0.5" style={{ color: 'rgb(239,68,68)' }}>{here.message}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <GhostButton onClick={locate} disabled={fixing}>{fixing ? 'Checking…' : 'Check my position'}</GhostButton>
                  {here?.ok && (
                    <GhostButton onClick={() => setEditing({
                      ...editing, latitude: here.latitude, longitude: here.longitude,
                    })}>Use this position</GhostButton>
                  )}
                </div>
              </div>
            </div>

            <Field label="Office name" required>
              <Input value={editing.name ?? ''} onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="Niyom Chennai Office" />
            </Field>

            <Field label="Address">
              <Input value={editing.address ?? ''} onChange={e => setEditing({ ...editing, address: e.target.value })}
                placeholder="Street, area, city" />
            </Field>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Latitude" required>
                <Input value={editing.latitude ?? ''} placeholder="13.082680"
                  onChange={e => setEditing({ ...editing, latitude: e.target.value as never })} />
              </Field>
              <Field label="Longitude" required>
                <Input value={editing.longitude ?? ''} placeholder="80.270721"
                  onChange={e => setEditing({ ...editing, longitude: e.target.value as never })} />
              </Field>
              <Field label="Radius (m)" hint="20–5000">
                <Input type="number" min={20} max={5000} value={editing.radius_metres ?? 100}
                  onChange={e => setEditing({ ...editing, radius_metres: Number(e.target.value) })} />
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <Field label="Status">
                <Select value={editing.status ?? 'active'} onChange={e => setEditing({ ...editing, status: e.target.value })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </Field>
              <Field label="Effective from">
                <Input type="date" value={editing.effective_from ?? today()}
                  onChange={e => setEditing({ ...editing, effective_from: e.target.value })} />
              </Field>
              <Field label="Effective to" hint="Blank = open-ended">
                <Input type="date" value={editing.effective_to ?? ''}
                  onChange={e => setEditing({ ...editing, effective_to: e.target.value || null })} />
              </Field>
            </div>

            <Field label="Description">
              <Input value={editing.description ?? ''} onChange={e => setEditing({ ...editing, description: e.target.value })}
                placeholder="Second floor, main entrance side" />
            </Field>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <PrimaryButton onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Office'}</PrimaryButton>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={!!retireId}
        title="Retire this office location?"
        message="Punches already recorded keep the office they were judged against and their distances. Future punches will be measured against the remaining active offices only."
        confirmLabel="Retire"
        busy={busy}
        onCancel={() => setRetireId(null)}
        onConfirm={retire}
      />
    </div>
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
  // The whole forwarded chain and the hop setting, shown beside the chosen
  // address. Without this the only symptom of a wrong hop setting is a slow
  // drip of "trust this network" prompts, which reads as a flaky ISP rather
  // than a misconfiguration.
  const [chain, setChain] = useState<string | null>(null);
  const [hops, setHops] = useState(0);
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
      setChain(state.forwarded_for ?? null);
      // From settings, not from the punch state: hr_37 stopped returning the
      // hop count to every caller, and this screen already has the row.
      setHops(s?.trusted_proxy_hops ?? 0);
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
      {myIp && looksLikeInfrastructure(myIp) && (
        <Notice tone="bad" title="The detected address looks like cloud infrastructure, not an office">
          <strong className="font-mono">{myIp}</strong> is in a hosting provider's range, which means the server is
          reading a proxy in front of the API rather than the person punching. Allowlisting it would approve
          <em> every</em> punch from anywhere, because they all arrive through that same proxy. Raise
          <strong> Trusted proxy hops</strong> on the Rules tab by one and check this again — the chain below shows
          which entry is being taken.
        </Notice>
      )}

      <Notice tone="info" title="The IP address is an audit field, not the door">
        A public IP identifies an internet connection, not a place: it rotates, it can be reached from anywhere over a
        VPN, and it changed often enough here to demand a fresh approval most days. Attendance is now judged by
        distance from the office on the <strong>Office Locations</strong> tab. Every punch still records the address it
        came from, and it is still worth keeping the office connections listed below — corroborating evidence when a
        position looks wrong is exactly what it is good for.
      </Notice>

      <SectionCard
        title="Network enforcement (legacy)"
        subtitle="Superseded by Office Locations. Kept because it still decides what happens when a punch arrives with no usable position at all."
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
          Attendance eligibility is now decided by <strong style={{ color: 'var(--text-secondary)' }}>where</strong> the
          punch was made, on the <strong style={{ color: 'var(--text-secondary)' }}>Office Locations</strong> tab. This
          setting only applies to a punch that carried no position — <strong style={{ color: 'var(--text-secondary)' }}>Observe</strong>{' '}
          lets it through, <strong style={{ color: 'var(--text-secondary)' }}>Enforce</strong> holds it as <em>pending</em>{' '}
          for an administrator.
        </p>
      </SectionCard>

      <SectionCard
        title="Known office networks"
        subtitle="Recorded alongside each punch as supporting evidence. Public IPs only — a private address such as 192.168.x.x identifies nothing."
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
              {chain && (
                <p className="text-[11px] mt-1 font-mono break-all" style={{ color: 'var(--text-faint)' }}>
                  Full chain: {chain}
                  <span className="ml-1" style={{ color: 'var(--text-muted)' }}>
                    (taking entry {hops + 1} from the right)
                  </span>
                </p>
              )}
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
        enforce_punch_window: s.enforce_punch_window,
        punch_window_start: s.punch_window_start,
        punch_window_end: s.punch_window_end,
        allow_out_punch_anytime: s.allow_out_punch_anytime,
        block_on_weekly_off: s.block_on_weekly_off,
        block_on_holiday: s.block_on_holiday,
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

      <SectionCard
        title="Permitted punching hours"
        subtitle="Refuses punches made at times nobody should be working. Separate from office hours — lateness is already handled by the late threshold above, which marks the day rather than blocking it."
      >
        <label className="flex items-start gap-2.5 cursor-pointer text-xs mb-4" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={s.enforce_punch_window} disabled={!canEdit} className="mt-0.5"
            onChange={e => setS({ ...s, enforce_punch_window: e.target.checked })} />
          <span><strong>Refuse punches outside the hours below.</strong> Off by default.</span>
        </label>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Field label="Punching allowed from">
            <Input type="time" value={s.punch_window_start?.slice(0, 5)} disabled={!canEdit || !s.enforce_punch_window}
              onChange={e => setS({ ...s, punch_window_start: e.target.value })} />
          </Field>
          <Field label="Punching allowed until" hint="Set this earlier than the start for a window that crosses midnight.">
            <Input type="time" value={s.punch_window_end?.slice(0, 5)} disabled={!canEdit || !s.enforce_punch_window}
              onChange={e => setS({ ...s, punch_window_end: e.target.value })} />
          </Field>
        </div>

        <div className="mt-4">
          <Notice tone="warn" title="Keep punch-outs exempt unless you are sure">
            Refusing a late punch-out cannot un-work the time already spent — it just leaves the person punched in,
            flags a missing punch-out, and makes someone raise a correction the next morning to fix a person's honesty.
            It also makes overtime unrecordable.
          </Notice>
        </div>

        <div className="mt-4 space-y-2.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={s.allow_out_punch_anytime} disabled={!canEdit} className="mt-0.5"
              onChange={e => setS({ ...s, allow_out_punch_anytime: e.target.checked })} />
            <span>Allow punching <strong>out</strong> at any time, even outside the hours above <em>(recommended)</em>.</span>
          </label>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={s.block_on_weekly_off} disabled={!canEdit} className="mt-0.5"
              onChange={e => setS({ ...s, block_on_weekly_off: e.target.checked })} />
            <span>
              Also refuse punching <strong>in</strong> on a weekly off. Leaving this off is usually right — someone
              who comes in on a Saturday is doing work, and refusing the punch loses the record of it rather than
              preventing it.
            </span>
          </label>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={s.block_on_holiday} disabled={!canEdit} className="mt-0.5"
              onChange={e => setS({ ...s, block_on_holiday: e.target.checked })} />
            <span>Also refuse punching <strong>in</strong> on a holiday, for the same reason.</span>
          </label>
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
