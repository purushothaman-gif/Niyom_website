/**
 * The HR overview.
 *
 * Built around exceptions rather than vanity numbers: the useful question on
 * any given morning is "what will stop this month's payroll going out", and the
 * answers are missing salary structures, missing bank details, attendance
 * nobody has approved, and leave nobody has decided. Each tile is a link into
 * the screen that fixes it.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle, CalendarCheck, CalendarClock, ClipboardCheck, ShieldAlert, UserX, Wallet,
} from 'lucide-react';
import * as api from './hrApi';
import { hrError } from './hrError';
import { EmptyState, Notice, Pill, SectionCard, Skeleton, StatTile, TableWrap } from './hrUi';
import { useToast } from './useToast';
import type { HRAccess, HREmployee, PayrollRun } from './hrTypes';
import type { CRMPage } from '../types';
import { inr } from '../../lib/money';

const MONTHS = Array.from({ length: 12 }, (_, i) =>
  new Date(2000, i, 1).toLocaleDateString('en-IN', { month: 'long' }));

interface Snapshot {
  staff: HREmployee[];
  presentToday: number;
  absentToday: number;
  onLeaveToday: number;
  notPunched: number;
  pendingPunches: number;
  pendingCorrections: number;
  pendingLeave: number;
  noStructure: HREmployee[];
  noBank: HREmployee[];
  currentRun: PayrollRun | null;
  lastRun: PayrollRun | null;
}

export default function HRDashboard({ access, onNavigate }: {
  access: HRAccess; onNavigate: (p: CRMPage) => void;
}) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const { show, node } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const [staff, daily, pendingPunches, corrections, leave, structures, runs] = await Promise.all([
        // Payroll-eligible only: a partner has no salary structure and no bank
        // details ON PURPOSE, and listing that as an exception every morning
        // trains people to ignore the exception list.
        api.listHREmployees(false, true),
        api.listDailyForDate(today),
        access.canView.attendance ? api.listPendingPunches() : Promise.resolve([]),
        access.canView.attendance ? api.listAdjustments({ pendingOnly: true }) : Promise.resolve([]),
        access.canView.leave ? api.listLeaveRequests({ pendingOnly: true }) : Promise.resolve([]),
        access.canView.salary ? api.listStructures() : Promise.resolve([]),
        access.canView.payroll ? api.listRuns() : Promise.resolve([]),
      ]);

      const status = (id: string) => daily.find(d => d.employee_id === id)?.status;
      const hasStructure = (id: string) =>
        structures.some(s => s.employee_id === id && s.effective_to === null && s.status !== 'draft');

      setSnap({
        staff,
        presentToday: staff.filter(s => ['present', 'on_duty', 'half_day'].includes(status(s.id) ?? '')).length,
        absentToday: staff.filter(s => status(s.id) === 'absent').length,
        onLeaveToday: staff.filter(s => ['paid_leave', 'unpaid_leave'].includes(status(s.id) ?? '')).length,
        notPunched: staff.filter(s => {
          const d = daily.find(x => x.employee_id === s.id);
          return !d?.first_in_at && !['weekly_off', 'holiday', 'paid_leave', 'unpaid_leave', 'not_joined', 'exited'].includes(d?.status ?? '');
        }).length,
        pendingPunches: pendingPunches.length,
        pendingCorrections: corrections.length,
        pendingLeave: leave.length,
        noStructure: access.canView.salary ? staff.filter(s => !hasStructure(s.id)) : [],
        noBank: staff.filter(s => !s.bank),
        currentRun: runs.find(r => ['draft', 'processing', 'review', 'approved'].includes(r.status)) ?? null,
        lastRun: runs.find(r => ['locked', 'paid'].includes(r.status)) ?? null,
      });
    } catch (err) {
      show(hrError(err, 'Could not load the HR overview.'), false);
    } finally {
      setLoading(false);
    }
  }, [access, show]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Skeleton rows={8} height={70} />;
  if (!snap) return <EmptyState icon={AlertTriangle} title="Could not load the overview" />;

  const blockers = snap.noStructure.length + snap.noBank.length + snap.pendingPunches;
  const approvals = snap.pendingLeave + snap.pendingCorrections + snap.pendingPunches;

  return (
    <div className="space-y-5">
      {snap.currentRun && (
        <Notice
          tone={snap.currentRun.status === 'draft' ? 'warn' : 'info'}
          title={`${MONTHS[snap.currentRun.period_month - 1]} ${snap.currentRun.period_year} payroll is ${snap.currentRun.status}`}
        >
          {snap.currentRun.status === 'draft'
            ? 'Prepared automatically and waiting to be calculated. Nothing is paid until an administrator reviews and approves it.'
            : `${snap.currentRun.employee_count} employees · ${inr(Number(snap.currentRun.total_net))} net payable.`}
          {' '}
          <button onClick={() => onNavigate('hr_payroll' as CRMPage)} className="underline font-semibold">
            Review payroll
          </button>
        </Notice>
      )}

      {/* Today */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatTile label="Employees" value={snap.staff.length} icon={ClipboardCheck}
          onClick={() => onNavigate('hr_employees' as CRMPage)} />
        <StatTile label="Present Today" value={snap.presentToday} tone="good"
          onClick={() => onNavigate('hr_attendance' as CRMPage)} />
        <StatTile label="On Leave" value={snap.onLeaveToday} tone="accent"
          onClick={() => onNavigate('hr_leave' as CRMPage)} />
        <StatTile label="Not Punched" value={snap.notPunched} tone={snap.notPunched ? 'warn' : 'neutral'}
          onClick={() => onNavigate('hr_attendance' as CRMPage)} />
        <StatTile label="Awaiting Approval" value={approvals} tone={approvals ? 'warn' : 'good'}
          icon={CalendarCheck} onClick={() => onNavigate('hr_attendance' as CRMPage)} />
      </div>

      {/* Payroll readiness */}
      <SectionCard
        title="Payroll readiness"
        subtitle="Everything here stops an employee being paid correctly. Payroll refuses rather than quietly paying zero."
      >
        {blockers === 0 ? (
          <div className="flex items-center gap-3 py-2">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(16,185,129,0.12)', color: 'rgb(16,185,129)' }}>
              <Wallet className="w-4 h-4" />
            </span>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Everyone is ready to be paid
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Every active employee has a salary structure and bank details, and no attendance is awaiting approval.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {snap.noStructure.length > 0 && (
              <Issue icon={Wallet} tone="bad" count={snap.noStructure.length}
                title="No salary structure"
                names={snap.noStructure.map(s => s.full_name)}
                action="Set up salary" onClick={() => onNavigate('hr_salary' as CRMPage)} />
            )}
            {snap.noBank.length > 0 && (
              <Issue icon={UserX} tone="bad" count={snap.noBank.length}
                title="No bank details — cannot be included in a transfer file"
                names={snap.noBank.map(s => s.full_name)}
                action="Add bank details" onClick={() => onNavigate('hr_employees' as CRMPage)} />
            )}
            {snap.pendingPunches > 0 && (
              <Issue icon={ShieldAlert} tone="warn" count={snap.pendingPunches}
                title="Off-network punches awaiting approval — these hours do not count yet"
                names={[]} action="Review punches" onClick={() => onNavigate('hr_attendance' as CRMPage)} />
            )}
          </div>
        )}
      </SectionCard>

      {/* Approvals */}
      {approvals > 0 && (
        <SectionCard title="Waiting on you" padded={false}>
          <div className="p-5">
            <TableWrap>
              <thead><tr><th className="text-left">Queue</th><th className="text-right">Waiting</th><th className="text-right"></th></tr></thead>
              <tbody>
                {snap.pendingLeave > 0 && (
                  <tr>
                    <td><CalendarClock className="w-3.5 h-3.5 inline mr-2" style={{ color: 'var(--text-faint)' }} />Leave requests</td>
                    <td className="text-right font-bold tabular-nums">{snap.pendingLeave}</td>
                    <td className="text-right">
                      <button onClick={() => onNavigate('hr_leave' as CRMPage)} className="text-xs font-semibold"
                        style={{ color: 'var(--accent-soft)' }}>Review</button>
                    </td>
                  </tr>
                )}
                {snap.pendingPunches > 0 && (
                  <tr>
                    <td><ShieldAlert className="w-3.5 h-3.5 inline mr-2" style={{ color: 'var(--text-faint)' }} />Off-network punches</td>
                    <td className="text-right font-bold tabular-nums">{snap.pendingPunches}</td>
                    <td className="text-right">
                      <button onClick={() => onNavigate('hr_attendance' as CRMPage)} className="text-xs font-semibold"
                        style={{ color: 'var(--accent-soft)' }}>Review</button>
                    </td>
                  </tr>
                )}
                {snap.pendingCorrections > 0 && (
                  <tr>
                    <td><ClipboardCheck className="w-3.5 h-3.5 inline mr-2" style={{ color: 'var(--text-faint)' }} />Attendance corrections</td>
                    <td className="text-right font-bold tabular-nums">{snap.pendingCorrections}</td>
                    <td className="text-right">
                      <button onClick={() => onNavigate('hr_attendance' as CRMPage)} className="text-xs font-semibold"
                        style={{ color: 'var(--accent-soft)' }}>Review</button>
                    </td>
                  </tr>
                )}
              </tbody>
            </TableWrap>
          </div>
        </SectionCard>
      )}

      {/* Last finalised run */}
      {snap.lastRun && (
        <SectionCard title="Last finalised payroll">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                {MONTHS[snap.lastRun.period_month - 1]} {snap.lastRun.period_year}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {snap.lastRun.employee_count} employees · gross {inr(Number(snap.lastRun.total_gross))} ·
                deductions {inr(Number(snap.lastRun.total_deductions))}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Pill value={snap.lastRun.status} kind="payroll" />
              <div className="text-right">
                <p className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>Net paid</p>
                <p className="text-lg font-bold tabular-nums" style={{ color: 'rgb(16,185,129)' }}>
                  {inr(Number(snap.lastRun.total_net))}
                </p>
              </div>
            </div>
          </div>
        </SectionCard>
      )}

      {node}
    </div>
  );
}

function Issue({ icon: Icon, tone, count, title, names, action, onClick }: {
  icon: React.ElementType; tone: 'bad' | 'warn'; count: number; title: string;
  names: string[]; action: string; onClick: () => void;
}) {
  const rgb = tone === 'bad' ? '239,68,68' : '245,158,11';
  return (
    <div className="flex items-start gap-3 px-4 py-3 rounded-xl"
      style={{ background: `rgba(${rgb},0.07)`, border: `1px solid rgba(${rgb},0.22)` }}>
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: `rgb(${rgb})` }} />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold" style={{ color: `rgb(${rgb})` }}>{count} · {title}</p>
        {names.length > 0 && (
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {names.slice(0, 6).join(', ')}{names.length > 6 ? ` and ${names.length - 6} more` : ''}
          </p>
        )}
      </div>
      <button onClick={onClick} className="text-xs font-semibold flex-shrink-0" style={{ color: `rgb(${rgb})` }}>
        {action} →
      </button>
    </div>
  );
}
