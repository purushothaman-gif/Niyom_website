/**
 * Attendance and payroll reports.
 *
 * Every report is derived from the same tables the screens read -- there is no
 * separate reporting copy of the data to fall out of step. Each one filters,
 * shows on screen, and exports the identical rows to Excel, so what someone
 * sends to a consultant is what they were looking at.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BarChart3, Download } from 'lucide-react';
import * as api from './hrApi';
import { hrError } from './hrError';
import {
  EmptyState, GhostButton, Input, SectionCard, Select, Skeleton, TableWrap, Tabs,
} from './hrUi';
import { useToast } from './useToast';
import type { AttendanceDaily, HRAccess, HREmployee, PayrollLineRow, PayrollRecord, PayrollRun } from './hrTypes';
import { summariseAttendance, formatDuration, type DailyRow } from '../../lib/hr/attendanceSummary';
import { inr } from '../../lib/money';
import { exportSheet, periodStamp } from './hrExcel';

type Report =
  | 'attendance_monthly' | 'late' | 'lop' | 'overtime'
  | 'salary_register' | 'earnings' | 'deductions' | 'payment';

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleDateString('en-IN', { month: 'long' }));

export default function HRReports({ access }: { access: HRAccess }) {
  const now = new Date();
  const [report, setReport] = useState<Report>('attendance_monthly');
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [q, setQ] = useState('');
  const { show, node } = useToast();

  const attendanceReports: { key: Report; label: string }[] = [
    { key: 'attendance_monthly', label: 'Monthly Attendance' },
    { key: 'late', label: 'Late Arrivals' },
    { key: 'lop', label: 'Loss of Pay' },
    { key: 'overtime', label: 'Overtime' },
  ];
  const payrollReports: { key: Report; label: string }[] = [
    { key: 'salary_register', label: 'Salary Register' },
    { key: 'earnings', label: 'Earnings' },
    { key: 'deductions', label: 'Deductions' },
    { key: 'payment', label: 'Payment' },
  ];

  /*
   * Memoised because the useEffect below depends on it: rebuilt inline, the
   * array was a new reference on every render and the effect re-ran every time.
   */
  const available = useMemo(() => [
    ...(access.canView.attendance ? attendanceReports : []),
    ...(access.canView.payroll ? payrollReports : []),
    // attendanceReports / payrollReports are module-level constants in all but
    // name; they are declared inside the component only for readability.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [access.canView.attendance, access.canView.payroll]);

  useEffect(() => {
    if (available.length && !available.some(r => r.key === report)) setReport(available[0].key);
  }, [available, report]);

  if (available.length === 0) {
    return <EmptyState icon={BarChart3} title="No reports available"
      message="You do not have access to attendance or payroll data." />;
  }

  const isAttendance = attendanceReports.some(r => r.key === report);

  return (
    <div className="space-y-5">
      <Tabs<Report> active={report} onChange={setReport} tabs={available} />

      <SectionCard
        title={available.find(r => r.key === report)?.label}
        subtitle={`${MONTHS[month - 1]} ${year}`}
        actions={
          <>
            <Input placeholder="Filter by name or ID…" value={q} onChange={e => setQ(e.target.value)} style={{ width: 200 }} />
            <Select value={month} onChange={e => setMonth(Number(e.target.value))} style={{ width: 140 }}>
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </Select>
            <Select value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 100 }}>
              {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </Select>
          </>
        }
        padded={false}
      >
        {isAttendance
          ? <AttendanceReport report={report} year={year} month={month} filter={q} onError={m => show(m, false)} />
          : <PayrollReport report={report} year={year} month={month} filter={q} onError={m => show(m, false)} />}
      </SectionCard>

      {node}
    </div>
  );
}

/* ------------------------------------------------------------- attendance */

function AttendanceReport({ report, year, month, filter, onError }: {
  report: Report; year: number; month: number; filter: string; onError: (m: string) => void;
}) {
  const [daily, setDaily] = useState<AttendanceDaily[]>([]);
  const [staff, setStaff] = useState<HREmployee[]>([]);
  const [loading, setLoading] = useState(true);

  const from = `${year}-${String(month).padStart(2, '0')}-01`;
  const to = new Date(year, month, 0).toISOString().slice(0, 10);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [d, s] = await Promise.all([api.listDailyForRange(from, to), api.listHREmployees(true)]);
      setDaily(d); setStaff(s);
    } catch (err) {
      onError(hrError(err));
    } finally {
      setLoading(false);
    }
  }, [from, to, onError]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    // Inlined into the memo rather than closed over from outside it: as a
    // separate function it was a dependency the memo did not declare, so a
    // changed filter could serve a stale table.
    const matches = (s: HREmployee) => !filter ||
      s.full_name.toLowerCase().includes(filter.toLowerCase()) ||
      s.employee_code.toLowerCase().includes(filter.toLowerCase());

    const list = staff.filter(matches);

    if (report === 'attendance_monthly') {
      return {
        headers: ['Employee ID', 'Name', 'Department', 'Calendar', 'Working', 'Present', 'Paid Leave',
                  'Unpaid Leave', 'Holidays', 'Weekly Off', 'Absent', 'LOP', 'Payable Days'],
        data: list.map(s => {
          const a = summariseAttendance(daily.filter(d => d.employee_id === s.id) as unknown as DailyRow[]);
          return [s.employee_code, s.full_name, s.profile?.department ?? '',
            a.calendar_days, a.working_days, a.present_days, a.paid_leave_days, a.unpaid_leave_days,
            a.holiday_days, a.weekly_off_days, a.absent_days, a.lop_days, a.payable_days];
        }),
      };
    }

    if (report === 'late') {
      return {
        headers: ['Employee ID', 'Name', 'Date', 'Punch In', 'Late By (min)'],
        data: daily
          .filter(d => d.is_late && list.some(s => s.id === d.employee_id))
          .sort((a, b) => a.work_date.localeCompare(b.work_date))
          .map(d => {
            const s = staff.find(x => x.id === d.employee_id);
            return [s?.employee_code ?? '', s?.full_name ?? '', d.work_date,
              d.first_in_at ? new Date(d.first_in_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }) : '—',
              d.late_minutes];
          }),
      };
    }

    if (report === 'lop') {
      return {
        headers: ['Employee ID', 'Name', 'Department', 'LOP Days', 'Absent Days', 'Unpaid Leave Days'],
        data: list.map(s => {
          const a = summariseAttendance(daily.filter(d => d.employee_id === s.id) as unknown as DailyRow[]);
          return [s.employee_code, s.full_name, s.profile?.department ?? '',
            a.lop_days, a.absent_days, a.unpaid_leave_days];
        }).filter(r => Number(r[3]) > 0),
      };
    }

    // overtime
    return {
      headers: ['Employee ID', 'Name', 'Overtime (min)', 'Overtime', 'Days with Overtime'],
      data: list.map(s => {
        const mine = daily.filter(d => d.employee_id === s.id);
        const mins = mine.reduce((t, d) => t + d.overtime_minutes, 0);
        return [s.employee_code, s.full_name, mins, formatDuration(mins),
          mine.filter(d => d.overtime_minutes > 0).length];
      }).filter(r => Number(r[2]) > 0),
    };
  }, [report, staff, daily, filter]);

  return <ReportTable loading={loading} rows={rows}
    fileName={`niyom_${report}_${periodStamp(year, month)}`} />;
}

/* ---------------------------------------------------------------- payroll */

function PayrollReport({ report, year, month, filter, onError }: {
  report: Report; year: number; month: number; filter: string; onError: (m: string) => void;
}) {
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [records, setRecords] = useState<PayrollRecord[]>([]);
  const [lines, setLines] = useState<PayrollLineRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const runs = await api.listRuns();
      const r = runs.find(x => x.period_year === year && x.period_month === month) ?? null;
      setRun(r);
      if (r) {
        const [rec, ln] = await Promise.all([api.listRunRecords(r.id), api.listRunLines(r.id)]);
        setRecords(rec); setLines(ln);
      } else {
        setRecords([]); setLines([]);
      }
    } catch (err) {
      onError(hrError(err));
    } finally {
      setLoading(false);
    }
  }, [year, month, onError]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const list = records.filter(r => !filter ||
      r.full_name.toLowerCase().includes(filter.toLowerCase()) ||
      r.employee_code.toLowerCase().includes(filter.toLowerCase()));

    if (report === 'salary_register') {
      const codes = Array.from(new Set(lines.map(l => l.component_code)));
      return {
        headers: ['Employee ID', 'Name', 'Department', 'Payable Days', 'LOP',
                  ...codes, 'Gross', 'Deductions', 'Employer Cost', 'Net Pay'],
        data: list.map(r => [
          r.employee_code, r.full_name, r.department,
          Number(r.payable_days), Number(r.lop_days),
          ...codes.map(c => Number(lines.find(l => l.record_id === r.id && l.component_code === c)?.amount ?? 0)),
          Number(r.gross_earnings), Number(r.total_deductions), Number(r.employer_contrib), Number(r.net_pay),
        ]),
      };
    }

    if (report === 'earnings' || report === 'deductions') {
      const kind = report === 'earnings' ? 'earning' : 'deduction';
      const codes = Array.from(new Set(lines.filter(l => l.kind === kind).map(l => l.component_code)));
      return {
        headers: ['Employee ID', 'Name', ...codes, 'Total'],
        data: list.map(r => {
          const vals = codes.map(c =>
            Number(lines.find(l => l.record_id === r.id && l.component_code === c)?.amount ?? 0));
          return [r.employee_code, r.full_name, ...vals,
            Math.round(vals.reduce((a, b) => a + b, 0) * 100) / 100];
        }),
      };
    }

    // payment
    return {
      headers: ['Employee ID', 'Name', 'Bank', 'Account', 'IFSC', 'Net Pay', 'Status'],
      data: list.map(r => [
        r.employee_code, r.full_name, r.bank_name,
        r.bank_account ? `••••${r.bank_account.slice(-4)}` : 'missing',
        r.bank_ifsc, Number(r.net_pay), r.status,
      ]),
    };
  }, [report, records, lines, filter]);

  if (!loading && !run) {
    return (
      <div className="p-5">
        <EmptyState icon={BarChart3} title="No payroll run for this month"
          message="Reports here read the run's snapshot, so a month has to be calculated before it can be reported on." />
      </div>
    );
  }

  return <ReportTable loading={loading} rows={rows} money
    fileName={`niyom_${report}_${periodStamp(year, month)}`} />;
}

/* ------------------------------------------------------------------ table */

function ReportTable({ loading, rows, fileName, money }: {
  loading: boolean;
  rows: { headers: string[]; data: (string | number)[][] };
  fileName: string;
  money?: boolean;
}) {
  if (loading) return <div className="p-5"><Skeleton rows={6} /></div>;

  if (rows.data.length === 0) {
    return <div className="p-5"><EmptyState icon={BarChart3} title="Nothing to report"
      message="No rows matched this period and filter." /></div>;
  }

  return (
    <div className="p-5 space-y-3">
      <div className="flex justify-between items-center">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{rows.data.length} row(s)</p>
        <GhostButton onClick={() => exportSheet(fileName, 'Report', [rows.headers, ...rows.data])}>
          <Download className="w-3.5 h-3.5 inline mr-1" />Excel
        </GhostButton>
      </div>
      <TableWrap>
        <thead>
          <tr>{rows.headers.map((h, i) => (
            <th key={h} className={i > 1 ? 'text-right' : 'text-left'}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.data.map((row, i) => (
            <tr key={i}>
              {row.map((cell, j) => (
                <td key={j} className={j > 1 ? 'text-right tabular-nums' : ''}>
                  {money && typeof cell === 'number' && j >= 2 ? inr(cell, true) : String(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </div>
  );
}
