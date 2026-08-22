/**
 * Entry point for every HR & Payroll screen.
 *
 * Resolves what the signed-in user may reach ONCE, through the same
 * SECURITY DEFINER helpers the RLS policies call, and then hands that down. The
 * menu can therefore never offer a screen the database will refuse -- and,
 * equally important, hiding a screen is never the thing protecting it. Every
 * table underneath enforces the same answer independently.
 */

import { useEffect, useState } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { NWEmployee, CRMPage } from '../types';
import { loadAccess } from './hrApi';
import type { HRAccess } from './hrTypes';
import { EmptyState, Skeleton } from './hrUi';

import HRDashboard from './HRDashboard';
import EmployeesAdmin from './EmployeesAdmin';
import AttendanceAdmin from './AttendanceAdmin';
import LeaveAdmin from './LeaveAdmin';
import HolidaysAdmin from './HolidaysAdmin';
import SalaryAdmin from './SalaryAdmin';
import PayrollAdmin from './PayrollAdmin';
import PayslipsAdmin from './PayslipsAdmin';
import HRReports from './HRReports';
import HRSettings from './HRSettings';
import MyHR from './MyHR';

export type HRSection =
  | 'hr_dashboard' | 'hr_employees' | 'hr_attendance' | 'hr_leave' | 'hr_holidays'
  | 'hr_salary' | 'hr_payroll' | 'hr_payslips' | 'hr_reports' | 'hr_settings' | 'my_hr';

/** Which capability each section needs. `my_hr` needs none — it is self-service. */
const REQUIRES: Record<Exclude<HRSection, 'my_hr' | 'hr_dashboard'>, keyof HRAccess['canView']> = {
  hr_employees:  'employees',
  hr_attendance: 'attendance',
  hr_leave:      'leave',
  hr_holidays:   'holidays',
  hr_salary:     'salary',
  hr_payroll:    'payroll',
  hr_payslips:   'payslips',
  hr_reports:    'reports',
  hr_settings:   'settings',
};

export default function HR({ employee, section, onNavigate }: {
  employee: NWEmployee;
  section: HRSection;
  onNavigate: (page: CRMPage) => void;
}) {
  const [access, setAccess] = useState<HRAccess | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    loadAccess(employee.role)
      .then(a => { if (!cancelled) setAccess(a); })
      .catch(() => {
        // Fail CLOSED: if capabilities cannot be resolved, offer self-service
        // only rather than guessing that this person is an administrator.
        if (!cancelled) {
          setAccess({
            isAdmin: false, hrRole: 'none',
            canView: emptyModules(), canEdit: emptyModules(), anyAdminAccess: false,
            // Self-service stays reachable: hiding someone's own attendance
            // because a capability lookup failed is the wrong way to fail.
            onPayroll: true,
          });
        }
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [employee.role]);

  if (loading || !access) return <Skeleton rows={6} height={70} />;

  // Self-service needs no HR capability at all -- but it needs the person to be
  // on payroll. A partner reaching this by URL gets an explanation rather than
  // empty attendance, an empty leave balance and an empty payslip list.
  if (section === 'my_hr') {
    if (!access.onPayroll) return <NotOnPayroll />;
    return <MyHR employee={employee} />;
  }

  const needed = section === 'hr_dashboard' ? null : REQUIRES[section];
  if (needed && !access.canView[needed]) return <NoAccess />;
  if (section === 'hr_dashboard' && !access.anyAdminAccess) return <NoAccess />;

  switch (section) {
    case 'hr_dashboard':  return <HRDashboard access={access} onNavigate={onNavigate} />;
    case 'hr_employees':  return <EmployeesAdmin employee={employee} access={access} />;
    case 'hr_attendance': return <AttendanceAdmin employee={employee} access={access} />;
    case 'hr_leave':      return <LeaveAdmin access={access} />;
    case 'hr_holidays':   return <HolidaysAdmin employeeId={employee.id} access={access} />;
    case 'hr_salary':     return <SalaryAdmin access={access} />;
    case 'hr_payroll':    return <PayrollAdmin employeeId={employee.id} access={access} />;
    case 'hr_payslips':   return <PayslipsAdmin access={access} />;
    case 'hr_reports':    return <HRReports access={access} />;
    case 'hr_settings':   return <HRSettings access={access} />;
    default:              return <MyHR employee={employee} />;
  }
}

function emptyModules(): HRAccess['canView'] {
  return {
    employees: false, attendance: false, leave: false, holidays: false,
    salary: false, payroll: false, payslips: false, reports: false, settings: false,
  };
}

function NotOnPayroll() {
  return (
    <EmptyState
      icon={ShieldAlert}
      title="Not applicable to your record"
      message="Attendance, leave and payslips apply to salaried employees. Your record is marked as not on payroll,
               so there is nothing to show here. An administrator can change that in HR → Employees if it is wrong."
    />
  );
}

function NoAccess() {
  return (
    <EmptyState
      icon={ShieldAlert}
      title="You do not have access to this"
      message="HR and payroll data is restricted. Ask an administrator if you need it — access is granted per module in HR Settings."
    />
  );
}
