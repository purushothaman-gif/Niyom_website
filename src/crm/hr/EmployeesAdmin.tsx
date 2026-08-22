/**
 * Employee directory and profile for HR.
 *
 * Deliberately built ON TOP of nw_employees rather than beside it: creating an
 * employee still goes through the existing create-crm-user edge function, which
 * owns the auth user, the employee code and the welcome path. This screen adds
 * the HR half -- department, statutory identifiers, bank details, schedules --
 * as hr_employee_profiles rows.
 *
 * Bank details are HR-writable only. An employee can see their own account but
 * cannot change it: the account salary is credited to is a fraud vector, and
 * hr_employee_bank_accounts has no self-write policy to match.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Download, Plus, Search, Upload, UserCog, Users } from 'lucide-react';
import type { NWEmployee } from '../types';
import * as api from './hrApi';
import { hrError } from './hrError';
import {
  Drawer, EmptyState, Field, GhostButton, Input, Modal, Notice, Pill,
  PrimaryButton, SectionCard, Select, Skeleton, StatTile, TableWrap, Tabs, Textarea,
} from './hrUi';
import { useToast } from './useToast';
import type { BankAccount, HRAccess, HREmployee, PaySchedule, WorkSchedule } from './hrTypes';
import { EmployeeAvatar } from '../EmployeeAvatar';
import { exportSheet } from './hrExcel';
import EmployeeImport from './EmployeeImport';
import { supabase } from '../../lib/supabase';

type DrawerTab = 'overview' | 'personal' | 'employment' | 'statutory' | 'bank';

const today = () => new Date().toISOString().slice(0, 10);
const day = (v: string | null) =>
  v ? new Date(v + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function EmployeesAdmin({ employee, access }: { employee: NWEmployee; access: HRAccess }) {
  const [rows, setRows] = useState<HREmployee[]>([]);
  const [schedules, setSchedules] = useState<WorkSchedule[]>([]);
  const [paySchedules, setPaySchedules] = useState<PaySchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [dept, setDept] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [selected, setSelected] = useState<HREmployee | null>(null);
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const { show, node } = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [e, w, p] = await Promise.all([
        api.listHREmployees(true), api.listWorkSchedules(), api.listPaySchedules(),
      ]);
      setRows(e); setSchedules(w); setPaySchedules(p);
    } catch (err) {
      show(hrError(err, 'Could not load employees.'), false);
    } finally {
      setLoading(false);
    }
  }, [show]);

  useEffect(() => { load(); }, [load]);

  const departments = useMemo(
    () => Array.from(new Set(rows.map(r => r.profile?.department).filter(Boolean))).sort() as string[], [rows]);

  const filtered = useMemo(() => rows.filter(r => {
    if (!showInactive && r.status !== 'active') return false;
    if (dept && (r.profile?.department ?? '') !== dept) return false;
    if (q) {
      const n = q.toLowerCase();
      return r.full_name.toLowerCase().includes(n)
        || r.employee_code.toLowerCase().includes(n)
        || r.email.toLowerCase().includes(n);
    }
    return true;
  }), [rows, q, dept, showInactive]);

  const stats = useMemo(() => ({
    total: rows.filter(r => r.status === 'active').length,
    noSalary: 0,   // filled by the payroll dashboard, which knows the structures
    noBank: rows.filter(r => r.status === 'active' && !r.bank).length,
    noProfile: rows.filter(r => r.status === 'active' && !r.profile).length,
  }), [rows]);

  const exportDirectory = () => exportSheet('niyom_employees', 'Employees', [
    ['Employee ID', 'Name', 'Email', 'Phone', 'Designation', 'Department', 'Employment Type',
     'Location', 'Date of Joining', 'Status', 'PAN', 'UAN', 'Bank', 'Account', 'IFSC'],
    ...filtered.map(r => [
      r.employee_code, r.full_name, r.email, r.phone ?? '', r.designation ?? '',
      r.profile?.department ?? '', r.profile?.employment_type ?? '', r.profile?.work_location ?? '',
      r.joining_date ?? '', r.status, r.profile?.pan ?? '', r.profile?.uan ?? '',
      r.bank?.bank_name ?? '', r.bank?.account_number ?? '', r.bank?.ifsc ?? '',
    ]),
  ]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="Active Employees" value={stats.total} icon={Users} />
        <StatTile label="Missing HR Profile" value={stats.noProfile} tone={stats.noProfile ? 'warn' : 'good'} />
        <StatTile label="Missing Bank Details" value={stats.noBank} tone={stats.noBank ? 'bad' : 'good'}
          sub={stats.noBank ? 'Cannot be paid by transfer' : 'All payable'} />
        <StatTile label="Departments" value={departments.length} icon={Building2} />
      </div>

      <SectionCard
        title="Employee directory"
        actions={
          <>
            <GhostButton onClick={exportDirectory}><Download className="w-3.5 h-3.5 inline mr-1" />Excel</GhostButton>
            {access.canEdit.employees && (
              <>
                <GhostButton onClick={() => setImporting(true)}><Upload className="w-3.5 h-3.5 inline mr-1" />Bulk Import</GhostButton>
                <PrimaryButton onClick={() => setCreating(true)}><Plus className="w-3.5 h-3.5 inline mr-1" />Add Employee</PrimaryButton>
              </>
            )}
          </>
        }
        padded={false}
      >
        <div className="px-5 pt-4 flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-faint)' }} />
            <Input placeholder="Search name, ID or email…" value={q} onChange={e => setQ(e.target.value)}
              style={{ width: 240, paddingLeft: 32 }} />
          </div>
          <Select value={dept} onChange={e => setDept(e.target.value)} style={{ width: 180 }}>
            <option value="">All departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
            <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} />
            Include inactive
          </label>
        </div>

        <div className="p-5">
          {loading ? <Skeleton rows={6} /> : filtered.length === 0 ? (
            <EmptyState icon={Users} title="No employees match" />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className="text-left">Employee</th><th className="text-left">Designation</th>
                  <th className="text-left">Department</th><th className="text-left">Joined</th>
                  <th className="text-left">Bank</th><th className="text-left">Status</th>
                  <th className="text-right">Profile</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <EmployeeAvatar name={r.full_name} url={r.avatar_url} size={30} rounded="lg"
                          badgeStyle={{ background: 'rgba(var(--accent-soft-rgb),0.15)', color: 'var(--accent-soft)' }} />
                        <div className="min-w-0">
                          <p className="font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{r.full_name}</p>
                          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{r.employee_code}</p>
                        </div>
                      </div>
                    </td>
                    <td>{r.designation || '—'}</td>
                    <td>{r.profile?.department || <span style={{ color: 'rgb(245,158,11)' }}>not set</span>}</td>
                    <td className="whitespace-nowrap">{day(r.joining_date)}</td>
                    <td>{r.bank
                      ? <span className="font-mono text-xs">•••• {r.bank.account_number.slice(-4)}</span>
                      : <Pill value="missing" small />}</td>
                    <td><Pill value={r.status} small /></td>
                    <td className="text-right">
                      <button onClick={() => setSelected(r)} className="text-xs font-semibold"
                        style={{ color: 'var(--accent-soft)' }}>Open</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </div>
      </SectionCard>

      {selected && (
        <ProfileDrawer
          row={selected}
          schedules={schedules}
          paySchedules={paySchedules}
          canEdit={access.canEdit.employees}
          onClose={() => setSelected(null)}
          onSaved={() => { load(); show('Employee updated.'); }}
          onError={m => show(m, false)}
        />
      )}

      {creating && (
        <CreateEmployee
          actor={employee}
          schedules={schedules}
          paySchedules={paySchedules}
          onClose={() => setCreating(false)}
          onDone={code => { setCreating(false); show(`Employee created with code ${code}.`); load(); }}
          onError={m => show(m, false)}
        />
      )}

      {importing && (
        <EmployeeImport
          schedules={schedules}
          paySchedules={paySchedules}
          onClose={() => setImporting(false)}
          onDone={n => { setImporting(false); show(`${n} employee(s) imported.`); load(); }}
        />
      )}

      {node}
    </div>
  );
}

/* ======================================================================== */
/* Profile drawer                                                            */
/* ======================================================================== */

function ProfileDrawer({ row, schedules, paySchedules, canEdit, onClose, onSaved, onError }: {
  row: HREmployee; schedules: WorkSchedule[]; paySchedules: PaySchedule[]; canEdit: boolean;
  onClose: () => void; onSaved: () => void; onError: (m: string) => void;
}) {
  const [tab, setTab] = useState<DrawerTab>('overview');
  const [form, setForm] = useState(() => ({
    department: row.profile?.department ?? '',
    employment_type: row.profile?.employment_type ?? 'full_time',
    work_location: row.profile?.work_location ?? 'Chennai',
    reporting_manager_id: row.profile?.reporting_manager_id ?? '',
    probation_months: row.profile?.probation_months ?? 0,
    confirmation_date: row.profile?.confirmation_date ?? '',
    exit_date: row.profile?.exit_date ?? '',
    exit_reason: row.profile?.exit_reason ?? '',
    employment_status: row.profile?.employment_status ?? 'active',
    date_of_birth: row.profile?.date_of_birth ?? '',
    gender: row.profile?.gender ?? '',
    personal_email: row.profile?.personal_email ?? '',
    personal_phone: row.profile?.personal_phone ?? '',
    address: row.profile?.address ?? '',
    emergency_contact_name: row.profile?.emergency_contact_name ?? '',
    emergency_contact_phone: row.profile?.emergency_contact_phone ?? '',
    pan: row.profile?.pan ?? '',
    uan: row.profile?.uan ?? '',
    pf_number: row.profile?.pf_number ?? '',
    esi_number: row.profile?.esi_number ?? '',
    pf_applicable: row.profile?.pf_applicable ?? false,
    esi_applicable: row.profile?.esi_applicable ?? false,
    pt_applicable: row.profile?.pt_applicable ?? false,
    hr_role: row.profile?.hr_role ?? 'none',
    work_schedule_id: row.profile?.work_schedule_id ?? '',
    pay_schedule_id: row.profile?.pay_schedule_id ?? '',
    network_exempt: row.profile?.network_exempt ?? false,
    holiday_location: row.profile?.holiday_location ?? 'Chennai',
    notes: row.profile?.notes ?? '',
  }));
  const [bank, setBank] = useState<BankAccount | null>(row.bank);
  const [bankForm, setBankForm] = useState({
    account_holder_name: row.bank?.account_holder_name ?? row.full_name,
    bank_name: row.bank?.bank_name ?? '',
    account_number: row.bank?.account_number ?? '',
    ifsc: row.bank?.ifsc ?? '',
    branch: row.bank?.branch ?? '',
    account_type: row.bank?.account_type ?? 'savings',
  });
  const [saving, setSaving] = useState(false);
  const [others, setOthers] = useState<HREmployee[]>([]);

  useEffect(() => { api.listHREmployees().then(setOthers).catch(() => {}); }, []);

  const saveProfile = async () => {
    if (form.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.pan.toUpperCase())) {
      onError('PAN must look like ABCDE1234F.'); return;
    }
    setSaving(true);
    try {
      await api.saveProfile(row.id, {
        ...form,
        pan: form.pan ? form.pan.toUpperCase() : null,
        uan: form.uan || null,
        reporting_manager_id: form.reporting_manager_id || null,
        work_schedule_id: form.work_schedule_id || null,
        pay_schedule_id: form.pay_schedule_id || null,
        confirmation_date: form.confirmation_date || null,
        exit_date: form.exit_date || null,
        date_of_birth: form.date_of_birth || null,
        gender: form.gender || null,
        probation_months: Number(form.probation_months) || 0,
      });
      onSaved();
    } catch (err) {
      onError(hrError(err));
    } finally {
      setSaving(false);
    }
  };

  const saveBank = async () => {
    if (!/^[0-9]{6,20}$/.test(bankForm.account_number)) { onError('Account number must be 6–20 digits.'); return; }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankForm.ifsc.toUpperCase())) { onError('IFSC must look like IDFB0080131.'); return; }
    if (!bankForm.bank_name.trim()) { onError('Enter the bank name.'); return; }
    setSaving(true);
    try {
      const saved = await api.saveBankAccount(bank?.id ?? null, {
        ...bankForm,
        ifsc: bankForm.ifsc.toUpperCase(),
        employee_id: row.id,
        is_primary: true,
        active: true,
      });
      setBank(saved);
      onSaved();
    } catch (err) {
      onError(hrError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer open onClose={onClose} title={row.full_name} subtitle={`${row.employee_code} · ${row.designation ?? ''}`} width="max-w-3xl">
      <div className="p-5 space-y-5">
        <Tabs<DrawerTab>
          active={tab} onChange={setTab}
          tabs={[
            { key: 'overview',   label: 'Overview' },
            { key: 'personal',   label: 'Personal' },
            { key: 'employment', label: 'Employment' },
            { key: 'statutory',  label: 'Statutory' },
            { key: 'bank',       label: 'Bank' },
          ]}
        />

        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <Detail label="Employee ID" value={row.employee_code} />
              <Detail label="Email" value={row.email} />
              <Detail label="Phone" value={row.phone || '—'} />
              <Detail label="Designation" value={row.designation ?? '—'} />
              <Detail label="Department" value={form.department || '—'} />
              <Detail label="Joined" value={day(row.joining_date)} />
              <Detail label="CRM role" value={row.role} />
              <Detail label="HR role" value={form.hr_role} />
              <Detail label="Status" value={row.status} />
            </div>
            {!row.profile && (
              <Notice tone="warn" title="No HR profile yet">
                This employee has no department, schedule or statutory details recorded. Attendance still works on the
                default schedule, but fill this in before running payroll for them.
              </Notice>
            )}
            {!bank && (
              <Notice tone="warn" title="No bank account">
                They cannot be included in a salary transfer file until an account is recorded on the Bank tab.
              </Notice>
            )}
          </div>
        )}

        {tab === 'personal' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Date of birth">
              <Input type="date" value={form.date_of_birth} disabled={!canEdit}
                onChange={e => setForm({ ...form, date_of_birth: e.target.value })} />
            </Field>
            <Field label="Gender">
              <Select value={form.gender} disabled={!canEdit} onChange={e => setForm({ ...form, gender: e.target.value })}>
                <option value="">Not stated</option><option value="M">Male</option>
                <option value="F">Female</option><option value="O">Other</option>
              </Select>
            </Field>
            <Field label="Personal email">
              <Input type="email" value={form.personal_email} disabled={!canEdit}
                onChange={e => setForm({ ...form, personal_email: e.target.value })} />
            </Field>
            <Field label="Personal phone">
              <Input value={form.personal_phone} disabled={!canEdit}
                onChange={e => setForm({ ...form, personal_phone: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Address">
                <Textarea value={form.address} disabled={!canEdit}
                  onChange={e => setForm({ ...form, address: e.target.value })} />
              </Field>
            </div>
            <Field label="Emergency contact">
              <Input value={form.emergency_contact_name} disabled={!canEdit}
                onChange={e => setForm({ ...form, emergency_contact_name: e.target.value })} />
            </Field>
            <Field label="Emergency phone">
              <Input value={form.emergency_contact_phone} disabled={!canEdit}
                onChange={e => setForm({ ...form, emergency_contact_phone: e.target.value })} />
            </Field>
          </div>
        )}

        {tab === 'employment' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Department">
              <Input value={form.department} disabled={!canEdit}
                onChange={e => setForm({ ...form, department: e.target.value })} />
            </Field>
            <Field label="Employment type">
              <Select value={form.employment_type} disabled={!canEdit}
                onChange={e => setForm({ ...form, employment_type: e.target.value })}>
                <option value="full_time">Full time</option><option value="part_time">Part time</option>
                <option value="intern">Intern</option><option value="contract">Contract</option>
                <option value="consultant">Consultant</option>
              </Select>
            </Field>
            <Field label="Work location">
              <Input value={form.work_location} disabled={!canEdit}
                onChange={e => setForm({ ...form, work_location: e.target.value })} />
            </Field>
            <Field label="Reporting manager" hint="Can approve this person's leave without company-wide HR access.">
              <Select value={form.reporting_manager_id} disabled={!canEdit}
                onChange={e => setForm({ ...form, reporting_manager_id: e.target.value })}>
                <option value="">None</option>
                {others.filter(o => o.id !== row.id).map(o => (
                  <option key={o.id} value={o.id}>{o.full_name} ({o.employee_code})</option>
                ))}
              </Select>
            </Field>
            <Field label="Work schedule" hint="Decides weekly offs, and therefore working days.">
              <Select value={form.work_schedule_id} disabled={!canEdit}
                onChange={e => setForm({ ...form, work_schedule_id: e.target.value })}>
                <option value="">Organisation default</option>
                {schedules.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Pay schedule">
              <Select value={form.pay_schedule_id} disabled={!canEdit}
                onChange={e => setForm({ ...form, pay_schedule_id: e.target.value })}>
                <option value="">Organisation default</option>
                {paySchedules.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="Probation (months)">
              <Input type="number" value={String(form.probation_months)} disabled={!canEdit}
                onChange={e => setForm({ ...form, probation_months: Number(e.target.value) })} />
            </Field>
            <Field label="Confirmation date">
              <Input type="date" value={form.confirmation_date} disabled={!canEdit}
                onChange={e => setForm({ ...form, confirmation_date: e.target.value })} />
            </Field>
            <Field label="Employment status">
              <Select value={form.employment_status} disabled={!canEdit}
                onChange={e => setForm({ ...form, employment_status: e.target.value })}>
                <option value="active">Active</option><option value="probation">Probation</option>
                <option value="notice_period">Notice period</option><option value="on_hold">On hold</option>
                <option value="exited">Exited</option>
              </Select>
            </Field>
            <Field label="Exit date" hint="Days after this are not payable.">
              <Input type="date" value={form.exit_date} disabled={!canEdit}
                onChange={e => setForm({ ...form, exit_date: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Exit reason">
                <Input value={form.exit_reason} disabled={!canEdit}
                  onChange={e => setForm({ ...form, exit_reason: e.target.value })} />
              </Field>
            </div>
            <Field label="HR role" hint="Independent of the CRM role. hr_admin runs HR; a manager only sees their own team.">
              <Select value={form.hr_role} disabled={!canEdit}
                onChange={e => setForm({ ...form, hr_role: e.target.value })}>
                <option value="none">None</option><option value="manager">Manager</option>
                <option value="hr_admin">HR Admin</option>
              </Select>
            </Field>
            <Field label="Holiday calendar">
              <Input value={form.holiday_location} disabled={!canEdit}
                onChange={e => setForm({ ...form, holiday_location: e.target.value })} />
            </Field>
            <div className="sm:col-span-2">
              <label className="flex items-start gap-2.5 cursor-pointer text-xs" style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={form.network_exempt} disabled={!canEdit} className="mt-0.5"
                  onChange={e => setForm({ ...form, network_exempt: e.target.checked })} />
                <span>
                  <strong>Exempt from the office network requirement.</strong> Their punches auto-approve from anywhere.
                  Meant for genuinely field-based staff — it removes the location control entirely for this person.
                </span>
              </label>
            </div>
            <div className="sm:col-span-2">
              <Field label="HR notes">
                <Textarea value={form.notes} disabled={!canEdit}
                  onChange={e => setForm({ ...form, notes: e.target.value })} />
              </Field>
            </div>
          </div>
        )}

        {tab === 'statutory' && (
          <div className="space-y-4">
            <Notice tone="info">
              These flags record what applies to this employee. Whether PF, ESI or professional tax actually appears on
              a payslip is decided by the components in their salary structure — no tax rule is built into the payroll
              engine.
            </Notice>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="PAN">
                <Input value={form.pan} disabled={!canEdit} placeholder="ABCDE1234F"
                  onChange={e => setForm({ ...form, pan: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="UAN">
                <Input value={form.uan} disabled={!canEdit}
                  onChange={e => setForm({ ...form, uan: e.target.value })} />
              </Field>
              <Field label="PF number">
                <Input value={form.pf_number} disabled={!canEdit}
                  onChange={e => setForm({ ...form, pf_number: e.target.value })} />
              </Field>
              <Field label="ESI number">
                <Input value={form.esi_number} disabled={!canEdit}
                  onChange={e => setForm({ ...form, esi_number: e.target.value })} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-5 text-xs" style={{ color: 'var(--text-secondary)' }}>
              {(['pf_applicable', 'esi_applicable', 'pt_applicable'] as const).map(k => (
                <label key={k} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={form[k]} disabled={!canEdit}
                    onChange={e => setForm({ ...form, [k]: e.target.checked })} />
                  {k === 'pf_applicable' ? 'PF applicable' : k === 'esi_applicable' ? 'ESI applicable' : 'Professional tax applicable'}
                </label>
              ))}
            </div>
          </div>
        )}

        {tab === 'bank' && (
          <div className="space-y-4">
            <Notice tone="warn" title="HR-only">
              An employee can see their own account but cannot change it — the account salary is credited to is a fraud
              vector, so every change here is recorded in the audit trail.
            </Notice>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Account holder name" required>
                <Input value={bankForm.account_holder_name} disabled={!canEdit}
                  onChange={e => setBankForm({ ...bankForm, account_holder_name: e.target.value })} />
              </Field>
              <Field label="Bank name" required>
                <Input value={bankForm.bank_name} disabled={!canEdit} placeholder="IDFC FIRST BANK"
                  onChange={e => setBankForm({ ...bankForm, bank_name: e.target.value })} />
              </Field>
              <Field label="Account number" required>
                <Input value={bankForm.account_number} disabled={!canEdit}
                  onChange={e => setBankForm({ ...bankForm, account_number: e.target.value.replace(/\D/g, '') })} />
              </Field>
              <Field label="IFSC" required>
                <Input value={bankForm.ifsc} disabled={!canEdit} placeholder="IDFB0080131"
                  onChange={e => setBankForm({ ...bankForm, ifsc: e.target.value.toUpperCase() })} />
              </Field>
              <Field label="Branch">
                <Input value={bankForm.branch} disabled={!canEdit}
                  onChange={e => setBankForm({ ...bankForm, branch: e.target.value })} />
              </Field>
              <Field label="Account type">
                <Select value={bankForm.account_type} disabled={!canEdit}
                  onChange={e => setBankForm({ ...bankForm, account_type: e.target.value })}>
                  <option value="savings">Savings</option><option value="current">Current</option>
                </Select>
              </Field>
            </div>
            {canEdit && (
              <div className="flex justify-end">
                <PrimaryButton onClick={saveBank} disabled={saving}>{saving ? 'Saving…' : 'Save Bank Details'}</PrimaryButton>
              </div>
            )}
          </div>
        )}

        {canEdit && tab !== 'bank' && tab !== 'overview' && (
          <div className="flex justify-end pt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <PrimaryButton onClick={saveProfile} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</PrimaryButton>
          </div>
        )}
      </div>
    </Drawer>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{label}</p>
      <p className="text-sm mt-1 font-medium" style={{ color: 'var(--text-primary)' }}>{value}</p>
    </div>
  );
}

/* ======================================================================== */
/* Create employee                                                           */
/* ======================================================================== */

function CreateEmployee({ actor, schedules, paySchedules, onClose, onDone, onError }: {
  actor: NWEmployee; schedules: WorkSchedule[]; paySchedules: PaySchedule[];
  onClose: () => void; onDone: (code: string) => void; onError: (m: string) => void;
}) {
  const [f, setF] = useState({
    employee_code: '', full_name: '', email: '', password: '',
    role: 'employee', designation: 'Relationship Manager',
    department: 'Sales', employment_type: 'full_time', work_location: 'Chennai',
    joining_date: today(),
    work_schedule_id: schedules.find(s => s.is_default)?.id ?? '',
    pay_schedule_id: paySchedules.find(s => s.is_default)?.id ?? '',
    bank_name: '', account_number: '', ifsc: '', account_holder_name: '',
  });
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!/^NIYOM-\d+$/i.test(f.employee_code.trim())) { onError('Employee ID must look like NIYOM-009.'); return; }
    if (!f.full_name.trim() || !f.email.trim()) { onError('Name and email are required.'); return; }
    if (f.password.length < 8) { onError('The temporary password must be at least 8 characters.'); return; }

    setBusy(true);
    try {
      // Reuse the existing provisioning path: it owns the auth user, the
      // password-change gate and the employee code format. Duplicating it here
      // would mean two ways to create an employee that could drift apart.
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-crm-user`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({
          email: f.email.trim(), password: f.password, full_name: f.full_name.trim(),
          role: f.role, designation: f.designation, employee_code: f.employee_code.trim().toUpperCase(),
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) { onError(json.error || 'Could not create the employee.'); setBusy(false); return; }

      // Find the row that was just created so the HR half can be attached.
      const list = await api.listHREmployees(true);
      const created = list.find(e => e.employee_code === f.employee_code.trim().toUpperCase());
      if (created) {
        await api.saveProfile(created.id, {
          department: f.department, employment_type: f.employment_type,
          work_location: f.work_location, holiday_location: f.work_location,
          work_schedule_id: f.work_schedule_id || null,
          pay_schedule_id: f.pay_schedule_id || null,
          employment_status: 'active',
        });
        if (f.account_number && f.ifsc) {
          await api.saveBankAccount(null, {
            employee_id: created.id,
            account_holder_name: f.account_holder_name || f.full_name,
            bank_name: f.bank_name, account_number: f.account_number,
            ifsc: f.ifsc.toUpperCase(), is_primary: true, active: true, created_by: actor.id,
          });
        }
      }
      onDone(json.employee_code ?? f.employee_code);
    } catch (err) {
      onError(hrError(err, 'Could not create the employee.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Add employee" width="max-w-2xl">
      <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
        <Step n={1} title="Account" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Employee ID" required hint="Format NIYOM-009">
            <Input value={f.employee_code} onChange={e => setF({ ...f, employee_code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Full name" required>
            <Input value={f.full_name} onChange={e => setF({ ...f, full_name: e.target.value })} />
          </Field>
          <Field label="Official email" required>
            <Input type="email" value={f.email} onChange={e => setF({ ...f, email: e.target.value })} />
          </Field>
          <Field label="Temporary password" required hint="They must change it at first sign-in.">
            <Input type="text" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} />
          </Field>
          <Field label="CRM role">
            <Select value={f.role} onChange={e => setF({ ...f, role: e.target.value })}>
              <option value="employee">Employee</option><option value="admin">Admin</option>
            </Select>
          </Field>
          <Field label="Designation" required>
            <Input value={f.designation} onChange={e => setF({ ...f, designation: e.target.value })} />
          </Field>
        </div>

        <Step n={2} title="Employment" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Department"><Input value={f.department} onChange={e => setF({ ...f, department: e.target.value })} /></Field>
          <Field label="Employment type">
            <Select value={f.employment_type} onChange={e => setF({ ...f, employment_type: e.target.value })}>
              <option value="full_time">Full time</option><option value="part_time">Part time</option>
              <option value="intern">Intern</option><option value="contract">Contract</option>
              <option value="consultant">Consultant</option>
            </Select>
          </Field>
          <Field label="Work location"><Input value={f.work_location} onChange={e => setF({ ...f, work_location: e.target.value })} /></Field>
          <Field label="Date of joining"><Input type="date" value={f.joining_date} onChange={e => setF({ ...f, joining_date: e.target.value })} /></Field>
          <Field label="Work schedule">
            <Select value={f.work_schedule_id} onChange={e => setF({ ...f, work_schedule_id: e.target.value })}>
              {schedules.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Pay schedule">
            <Select value={f.pay_schedule_id} onChange={e => setF({ ...f, pay_schedule_id: e.target.value })}>
              {paySchedules.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        </div>

        <Step n={3} title="Bank details" hint="Optional now — but payroll cannot pay them until this exists." />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Bank name"><Input value={f.bank_name} onChange={e => setF({ ...f, bank_name: e.target.value })} /></Field>
          <Field label="Account holder"><Input value={f.account_holder_name} placeholder={f.full_name}
            onChange={e => setF({ ...f, account_holder_name: e.target.value })} /></Field>
          <Field label="Account number"><Input value={f.account_number}
            onChange={e => setF({ ...f, account_number: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="IFSC"><Input value={f.ifsc} onChange={e => setF({ ...f, ifsc: e.target.value.toUpperCase() })} /></Field>
        </div>

        <Notice tone="info">
          Salary structure and leave balances are set after the employee exists — open their profile from the directory,
          then use the Salary screen to create a structure effective from their joining date.
        </Notice>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            Cancel
          </button>
          <PrimaryButton onClick={submit} disabled={busy}>{busy ? 'Creating…' : 'Create Employee'}</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function Step({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
        style={{ background: 'rgba(var(--accent-soft-rgb),0.15)', color: 'var(--accent-soft)' }}>{n}</span>
      <div>
        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{title}</p>
        {hint && <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{hint}</p>}
      </div>
    </div>
  );
}

export { UserCog };
