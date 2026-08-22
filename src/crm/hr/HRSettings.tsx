/**
 * HR & Payroll settings.
 *
 * The bank template editor is the piece that earns this screen: no two banks
 * want the same bulk-upload sheet, and the format is not knowable in advance,
 * so the columns are rows in a table rather than code. The `source` list is
 * closed and contains no salary breakdown -- there is deliberately no way to
 * configure a transfer file that leaks what anyone's basic or deductions are.
 */

import { useCallback, useEffect, useState } from 'react';
import { Building2, Coins, FileSpreadsheet, GripVertical, Plus, Trash2 } from 'lucide-react';
import * as api from './hrApi';
import { supabase } from '../../lib/supabase';
import { hrError } from './hrError';
import {
  EmptyState, Field, GhostButton, Input, Modal, Notice, Pill, PrimaryButton,
  SectionCard, Select, Skeleton, TableWrap, Tabs, Textarea,
} from './hrUi';
import { useToast } from './useToast';
import type {
  AuditLog, BankTemplateColumn, BankTemplateRow, HRAccess, HRSettings as HRSettingsRow,
  PaySchedule, RolePermission, WorkSchedule,
} from './hrTypes';

type Tab = 'company' | 'payroll' | 'bank' | 'permissions' | 'audit';

const SOURCES: { value: string; label: string }[] = [
  { value: 'account_holder',  label: 'Beneficiary name (account holder)' },
  { value: 'employee_name',   label: 'Employee name' },
  { value: 'employee_code',   label: 'Employee ID' },
  { value: 'bank_name',       label: 'Bank name' },
  { value: 'bank_account',    label: 'Account number' },
  { value: 'bank_ifsc',       label: 'IFSC' },
  { value: 'net_pay',         label: 'Amount (net pay)' },
  { value: 'payment_date',    label: 'Payment date' },
  { value: 'remarks',         label: 'Remarks' },
  { value: 'debit_account',   label: 'Company debit account' },
  { value: 'debit_ifsc',      label: 'Company debit IFSC' },
  { value: 'sequence',        label: 'Row number' },
  { value: 'constant',        label: 'Fixed text' },
];

export default function HRSettings({ access }: { access: HRAccess }) {
  const [tab, setTab] = useState<Tab>('company');
  const { show, node } = useToast();

  return (
    <div className="space-y-5">
      <Tabs<Tab> active={tab} onChange={setTab}
        tabs={[
          { key: 'company',     label: 'Company & Payslip' },
          { key: 'payroll',     label: 'Pay Schedule' },
          { key: 'bank',        label: 'Bank Templates' },
          { key: 'permissions', label: 'HR Permissions' },
          { key: 'audit',       label: 'Audit Log' },
        ]} />

      {tab === 'company'     && <Company onToast={show} canEdit={access.isAdmin} />}
      {tab === 'payroll'     && <Schedules onToast={show} canEdit={access.canEdit.settings} />}
      {tab === 'bank'        && <BankTemplates onToast={show} canEdit={access.canEdit.payroll} />}
      {tab === 'permissions' && <Permissions onToast={show} canEdit={access.isAdmin} />}
      {tab === 'audit'       && <Audit onToast={show} />}

      {node}
    </div>
  );
}

/* ------------------------------------------------------------------ company */

function Company({ onToast, canEdit }: { onToast: (m: string, ok?: boolean) => void; canEdit: boolean }) {
  const [s, setS] = useState<HRSettingsRow | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { api.getHRSettings().then(setS); }, []);

  const save = async () => {
    if (!s) return;
    setSaving(true);
    try {
      await api.saveHRSettings({
        company_name: s.company_name, company_address: s.company_address,
        company_logo_url: s.company_logo_url, payslip_number_format: s.payslip_number_format,
        payslip_footer_note: s.payslip_footer_note,
        attendance_tracking_from: s.attendance_tracking_from,
        employee_can_view_salary: s.employee_can_view_salary,
        notify_payroll_ready: s.notify_payroll_ready, notify_missing_punch: s.notify_missing_punch,
        notify_payslip_published: s.notify_payslip_published,
      });
      onToast('Settings saved.');
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setSaving(false);
    }
  };

  if (!s) return <Skeleton rows={6} />;

  return (
    <div className="space-y-5">
      <SectionCard title="Company details" subtitle="Printed on every payslip."
        actions={canEdit && <PrimaryButton onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</PrimaryButton>}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Company name">
            <Input value={s.company_name} disabled={!canEdit} onChange={e => setS({ ...s, company_name: e.target.value })} />
          </Field>
          <Field label="Logo URL" hint="Served from /public. Defaults to the Niyom mark.">
            <Input value={s.company_logo_url} disabled={!canEdit} onChange={e => setS({ ...s, company_logo_url: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Registered address">
              <Textarea rows={2} value={s.company_address} disabled={!canEdit}
                onChange={e => setS({ ...s, company_address: e.target.value })} />
            </Field>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Payslip">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Payslip numbering"
            hint="Tokens: {YYYY} {YY} {MM} {MMM} {EMPCODE} {SEQ}">
            <Input value={s.payslip_number_format} disabled={!canEdit}
              onChange={e => setS({ ...s, payslip_number_format: e.target.value })} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Footer note">
              <Textarea rows={2} value={s.payslip_footer_note} disabled={!canEdit}
                onChange={e => setS({ ...s, payslip_footer_note: e.target.value })} />
            </Field>
          </div>
        </div>
        <p className="text-xs mt-3" style={{ color: 'var(--text-faint)' }}>
          Payslips carry no signature block. A signature line on a computer-generated document invites someone to
          sign a figure they did not compute; the footer note below states that instead.<br />
          Preview of the next number: <span className="font-mono">
            {s.payslip_number_format
              .replace('{YYYY}', String(new Date().getFullYear()))
              .replace('{YY}', String(new Date().getFullYear()).slice(2))
              .replace('{MM}', String(new Date().getMonth() + 1).padStart(2, '0'))
              .replace('{MMM}', new Date().toLocaleDateString('en-IN', { month: 'short' }).toUpperCase())
              .replace('{EMPCODE}', 'NIYOM-001')
              .replace('{SEQ}', '0001')}
          </span>
        </p>
      </SectionCard>

      <SectionCard
        title="Attendance cut-over"
        subtitle="The first day attendance was actually tracked here."
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Attendance tracked from"
            hint="Leave blank only if attendance has always been tracked in this system.">
            <Input type="date" value={s.attendance_tracking_from ?? ''} disabled={!canEdit}
              onChange={e => setS({ ...s, attendance_tracking_from: e.target.value || null })} />
          </Field>
        </div>
        <div className="mt-3">
          <Notice tone="info">
            A working day before this date with no punches is recorded as <strong>on duty</strong>, not absent —
            there could be no punch data, so treating it as absence would turn history into loss of pay. Holidays,
            weekly offs and approved leave still take precedence, and any day that does have punches is computed
            from them. Moving this date <strong>changes past pay</strong>: everything after it becomes ordinary
            attendance, where an unpunched working day is absence.
          </Notice>
        </div>
      </SectionCard>

      <SectionCard title="Visibility and notifications">
        <div className="space-y-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <label className="flex items-start gap-2.5 cursor-pointer">
            <input type="checkbox" checked={s.employee_can_view_salary} disabled={!canEdit} className="mt-0.5"
              onChange={e => setS({ ...s, employee_can_view_salary: e.target.checked })} />
            <span>
              <strong>Employees can see their own salary structure.</strong> Enforced in the database, not just in the
              UI — turning this off makes the rows unreadable to them, not merely hidden. Published payslips are
              unaffected.
            </span>
          </label>
          {([
            ['notify_payroll_ready', 'Alert admins when a payroll run is prepared'],
            ['notify_missing_punch', 'Remind employees who have not punched out'],
            ['notify_payslip_published', 'Notify employees when a payslip is published'],
          ] as const).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2.5 cursor-pointer">
              <input type="checkbox" checked={s[k]} disabled={!canEdit}
                onChange={e => setS({ ...s, [k]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}

/* ---------------------------------------------------------------- schedules */

function Schedules({ onToast, canEdit }: { onToast: (m: string, ok?: boolean) => void; canEdit: boolean }) {
  const [pay, setPay] = useState<PaySchedule[]>([]);
  const [work, setWork] = useState<WorkSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PaySchedule | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, w] = await Promise.all([api.listPaySchedules(), api.listWorkSchedules()]);
    setPay(p); setWork(w); setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await api.savePaySchedule(editing.id, {
        lop_divisor_mode: editing.lop_divisor_mode,
        last_working_day_rule: editing.last_working_day_rule,
        last_working_fixed_day: editing.last_working_fixed_day,
        payment_day: editing.payment_day,
        attendance_cutoff_day: editing.attendance_cutoff_day,
        round_net_to_rupee: editing.round_net_to_rupee,
        round_components_to_rupee: editing.round_components_to_rupee,
      });
      onToast('Pay schedule saved. It applies to runs calculated from now on.');
      setEditing(null);
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
      <SectionCard title="Pay schedules" subtitle="Decides the LOP divisor, the automatic preparation day and rounding." padded={false}>
        <div className="p-5">
          <TableWrap>
            <thead>
              <tr><th className="text-left">Name</th><th className="text-left">LOP divisor</th>
                <th className="text-left">Prepared on</th><th className="text-left">Rounding</th>
                <th className="text-left">Default</th><th className="text-right"></th></tr>
            </thead>
            <tbody>
              {pay.map(s => (
                <tr key={s.id}>
                  <td className="font-semibold" style={{ color: 'var(--text-primary)' }}>{s.name}</td>
                  <td>{s.lop_divisor_mode.replace(/_/g, ' ')}</td>
                  <td>{s.last_working_day_rule.replace(/_/g, ' ')}
                    {s.last_working_day_rule === 'fixed_day' ? ` (${s.last_working_fixed_day})` : ''}</td>
                  <td>{s.round_net_to_rupee ? 'Net to the rupee' : 'Paise kept'}</td>
                  <td>{s.is_default && <Pill value="default" small />}</td>
                  <td className="text-right">
                    {canEdit && <button onClick={() => setEditing(s)} className="text-xs font-semibold"
                      style={{ color: 'var(--accent-soft)' }}>Edit</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      </SectionCard>

      <SectionCard title="Work schedules" subtitle="Decides weekly offs, and therefore working days and LOP." padded={false}>
        <div className="p-5">
          <TableWrap>
            <thead>
              <tr><th className="text-left">Name</th><th className="text-left">Weekly offs</th>
                <th className="text-left">Saturdays</th><th className="text-left">Default</th></tr>
            </thead>
            <tbody>
              {work.map(s => (
                <tr key={s.id}>
                  <td className="font-semibold" style={{ color: 'var(--text-primary)' }}>{s.name}</td>
                  <td>{(s.weekly_offs ?? []).map(d => ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][d]).join(', ')}</td>
                  <td>{s.saturday_rule === 'none' ? 'Working' : s.saturday_rule.replace(/_/g, ' & ')}</td>
                  <td>{s.is_default && <Pill value="default" small />}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </div>
      </SectionCard>

      {editing && (
        <Modal open onClose={() => setEditing(null)} title={`Pay schedule — ${editing.name}`}>
          <div className="p-5 space-y-4">
            <Field label="LOP divisor"
              hint="Per-day pay = monthly gross ÷ this. Organisations genuinely differ; there is no default that is right for everyone.">
              <Select value={editing.lop_divisor_mode}
                onChange={e => setEditing({ ...editing, lop_divisor_mode: e.target.value })}>
                <option value="calendar_days">Calendar days in the month (28–31)</option>
                <option value="working_days">Working days in the month</option>
                <option value="payable_days">Pay strictly for days earned</option>
                <option value="fixed_30">A flat 30 days</option>
              </Select>
            </Field>
            <Field label="Prepare payroll on" hint="The day the draft is opened and admins are alerted. No money moves.">
              <Select value={editing.last_working_day_rule}
                onChange={e => setEditing({ ...editing, last_working_day_rule: e.target.value })}>
                <option value="last_working_day">The last working day of the month</option>
                <option value="last_calendar_day">The last calendar day of the month</option>
                <option value="fixed_day">A fixed day of the month</option>
              </Select>
            </Field>
            {editing.last_working_day_rule === 'fixed_day' && (
              <Field label="Day of the month">
                <Input type="number" min="1" max="28" value={String(editing.last_working_fixed_day ?? 25)}
                  onChange={e => setEditing({ ...editing, last_working_fixed_day: Number(e.target.value) })} />
              </Field>
            )}
            <label className="flex items-center gap-2.5 cursor-pointer text-xs" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={editing.round_net_to_rupee}
                onChange={e => setEditing({ ...editing, round_net_to_rupee: e.target.checked })} />
              Round net pay to the nearest rupee
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer text-xs" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={editing.round_components_to_rupee} className="mt-0.5"
                onChange={e => setEditing({ ...editing, round_components_to_rupee: e.target.checked })} />
              <span>
                Round every payslip component to the whole rupee.{' '}
                <strong>Changing this changes the figures</strong> — a percentage component is taken from the
                settled value of the one above it, so turning it off mid-year would make an employee's payslips
                disagree month to month.
              </span>
            </label>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <PrimaryButton onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- bank templates */

function BankTemplates({ onToast, canEdit }: { onToast: (m: string, ok?: boolean) => void; canEdit: boolean }) {
  const [templates, setTemplates] = useState<BankTemplateRow[]>([]);
  const [selected, setSelected] = useState<BankTemplateRow | null>(null);
  const [columns, setColumns] = useState<Partial<BankTemplateColumn>[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    const t = await api.listBankTemplates();
    setTemplates(t);
    if (t.length && !selected) setSelected(t.find(x => x.is_default) ?? t[0]);
    setLoading(false);
  }, [selected]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (selected) api.listTemplateColumns(selected.id).then(setColumns);
  }, [selected]);

  const saveColumns = async () => {
    if (!selected) return;
    if (columns.some(c => !c.header_label?.trim())) { onToast('Every column needs a header label.', false); return; }
    setBusy(true);
    try {
      await api.saveBankTemplate(selected.id, {
        sheet_name: selected.sheet_name, include_header: selected.include_header,
        date_format: selected.date_format, amount_format: selected.amount_format,
        debit_account: selected.debit_account, debit_ifsc: selected.debit_ifsc,
        bank_name: selected.bank_name, notes: selected.notes,
      });
      await api.replaceTemplateColumns(selected.id, columns.map(c => ({
        header_label: c.header_label, source: c.source, constant_value: c.constant_value ?? '',
        required: c.required ?? false, transform: c.transform ?? 'none',
        max_length: c.max_length ?? null,
      })));
      onToast('Bank template saved.');
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!newName.trim()) { onToast('Give the template a name.', false); return; }
    setBusy(true);
    try {
      const t = await api.saveBankTemplate(null, {
        name: newName.trim(), file_format: 'xlsx', sheet_name: 'Salary',
        include_header: true, date_format: 'DD/MM/YYYY', amount_format: '2dp', active: true,
      });
      setCreating(false); setNewName('');
      setSelected(t);
      load();
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setBusy(false);
    }
  };

  const move = (i: number, dir: -1 | 1) => {
    const next = [...columns];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    setColumns(next);
  };

  if (loading) return <Skeleton rows={5} />;

  return (
    <div className="space-y-5">
      <Notice tone="warn" title="Match this to your bank's own template before the first live transfer">
        The seeded layout is a sensible generic one, not any particular bank's specification. Open your bank's
        bulk-upload sheet, and make the labels and order here match it exactly — a mismatch is rejected at upload, which
        is a bad thing to discover on payday.
      </Notice>

      <SectionCard
        title="Bank transfer templates"
        actions={
          <>
            <Select value={selected?.id ?? ''} style={{ width: 200 }}
              onChange={e => setSelected(templates.find(t => t.id === e.target.value) ?? null)}>
              {templates.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
            {canEdit && <GhostButton onClick={() => setCreating(true)}>
              <Plus className="w-3.5 h-3.5 inline mr-1" />New Template
            </GhostButton>}
          </>
        }
      >
        {!selected ? <EmptyState icon={FileSpreadsheet} title="No templates" /> : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Bank name">
                <Input value={selected.bank_name} disabled={!canEdit}
                  onChange={e => setSelected({ ...selected, bank_name: e.target.value })} />
              </Field>
              <Field label="Sheet name">
                <Input value={selected.sheet_name} disabled={!canEdit}
                  onChange={e => setSelected({ ...selected, sheet_name: e.target.value })} />
              </Field>
              <Field label="Date format">
                <Select value={selected.date_format} disabled={!canEdit}
                  onChange={e => setSelected({ ...selected, date_format: e.target.value })}>
                  {['DD/MM/YYYY', 'DD-MM-YYYY', 'YYYY-MM-DD', 'DD-MMM-YYYY', 'MM/DD/YYYY'].map(f =>
                    <option key={f} value={f}>{f}</option>)}
                </Select>
              </Field>
              <Field label="Amount format">
                <Select value={selected.amount_format} disabled={!canEdit}
                  onChange={e => setSelected({ ...selected, amount_format: e.target.value })}>
                  <option value="2dp">Two decimals (48000.00)</option>
                  <option value="integer">Whole rupees (48000)</option>
                </Select>
              </Field>
              <Field label="Company debit account" hint="Only used if a column sources it.">
                <Input value={selected.debit_account} disabled={!canEdit}
                  onChange={e => setSelected({ ...selected, debit_account: e.target.value })} />
              </Field>
              <Field label="Company debit IFSC">
                <Input value={selected.debit_ifsc} disabled={!canEdit}
                  onChange={e => setSelected({ ...selected, debit_ifsc: e.target.value.toUpperCase() })} />
              </Field>
            </div>

            <label className="flex items-center gap-2.5 cursor-pointer text-xs" style={{ color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={selected.include_header} disabled={!canEdit}
                onChange={e => setSelected({ ...selected, include_header: e.target.checked })} />
              Include a header row (some banks reject one)
            </label>

            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
                  Columns, in order
                </p>
                {canEdit && (
                  <GhostButton onClick={() => setColumns([...columns, {
                    header_label: '', source: 'employee_name', required: false, transform: 'none', constant_value: '',
                  }])}>
                    <Plus className="w-3.5 h-3.5 inline mr-1" />Add Column
                  </GhostButton>
                )}
              </div>

              <div className="space-y-2">
                {columns.map((c, i) => (
                  <div key={i} className="flex items-start gap-2 p-3 rounded-xl flex-wrap"
                    style={{ background: 'var(--bg-base)', border: '1px solid var(--border-subtle)' }}>
                    <div className="flex flex-col items-center pt-2" style={{ color: 'var(--text-faint)' }}>
                      <button onClick={() => move(i, -1)} disabled={i === 0 || !canEdit} className="disabled:opacity-30">▲</button>
                      <GripVertical className="w-3.5 h-3.5 my-0.5" />
                      <button onClick={() => move(i, 1)} disabled={i === columns.length - 1 || !canEdit} className="disabled:opacity-30">▼</button>
                    </div>
                    <div className="flex-1 min-w-[160px]">
                      <Field label={`Column ${i + 1} header`}>
                        <Input value={c.header_label ?? ''} disabled={!canEdit}
                          onChange={e => { const n = [...columns]; n[i] = { ...c, header_label: e.target.value }; setColumns(n); }} />
                      </Field>
                    </div>
                    <div className="flex-1 min-w-[180px]">
                      <Field label="Value">
                        <Select value={c.source ?? 'employee_name'} disabled={!canEdit}
                          onChange={e => { const n = [...columns]; n[i] = { ...c, source: e.target.value }; setColumns(n); }}>
                          {SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                        </Select>
                      </Field>
                    </div>
                    {c.source === 'constant' && (
                      <div className="min-w-[120px]">
                        <Field label="Fixed text">
                          <Input value={c.constant_value ?? ''} disabled={!canEdit}
                            onChange={e => { const n = [...columns]; n[i] = { ...c, constant_value: e.target.value }; setColumns(n); }} />
                        </Field>
                      </div>
                    )}
                    <div className="min-w-[120px]">
                      <Field label="Transform">
                        <Select value={c.transform ?? 'none'} disabled={!canEdit}
                          onChange={e => { const n = [...columns]; n[i] = { ...c, transform: e.target.value }; setColumns(n); }}>
                          <option value="none">None</option><option value="upper">UPPERCASE</option>
                          <option value="lower">lowercase</option><option value="trim">Trim</option>
                          <option value="digits_only">Digits only</option>
                        </Select>
                      </Field>
                    </div>
                    <div style={{ width: 90 }}>
                      <Field label="Max length">
                        <Input type="number" value={c.max_length == null ? '' : String(c.max_length)} disabled={!canEdit}
                          onChange={e => { const n = [...columns]; n[i] = { ...c, max_length: e.target.value === '' ? null : Number(e.target.value) }; setColumns(n); }} />
                      </Field>
                    </div>
                    <div className="pt-7 flex items-center gap-2">
                      <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                        <input type="checkbox" checked={c.required ?? false} disabled={!canEdit}
                          onChange={e => { const n = [...columns]; n[i] = { ...c, required: e.target.checked }; setColumns(n); }} />
                        Required
                      </label>
                      {canEdit && (
                        <button onClick={() => setColumns(columns.filter((_, j) => j !== i))}
                          style={{ color: 'rgb(239,68,68)' }} aria-label="Remove column">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {canEdit && (
              <div className="flex justify-end">
                <PrimaryButton onClick={saveColumns} disabled={busy}>{busy ? 'Saving…' : 'Save Template'}</PrimaryButton>
              </div>
            )}
          </div>
        )}
      </SectionCard>

      {creating && (
        <Modal open onClose={() => setCreating(false)} title="New bank template">
          <div className="p-5 space-y-4">
            <Field label="Template name" required>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="HDFC Bulk Salary" />
            </Field>
            <div className="flex justify-end gap-2">
              <button onClick={() => setCreating(false)} className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <PrimaryButton onClick={create} disabled={busy}>Create</PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------- permissions */

function Permissions({ onToast, canEdit }: { onToast: (m: string, ok?: boolean) => void; canEdit: boolean }) {
  const [rows, setRows] = useState<RolePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('hr_role_permissions').select('*').order('hr_role').order('module');
    setRows((data ?? []) as RolePermission[]);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (row: RolePermission, field: 'can_view' | 'can_edit', value: boolean) => {
    setBusy(true);
    try {
      // Edit implies view: granting edit without view would produce a role that
      // can change what it cannot see.
      const patch = field === 'can_edit' && value
        ? { can_edit: true, can_view: true }
        : field === 'can_view' && !value
          ? { can_view: false, can_edit: false }
          : { [field]: value };
      const { error } = await supabase.from('hr_role_permissions').update(patch).eq('id', row.id);
      if (error) throw error;
      load();
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Skeleton rows={6} />;

  return (
    <SectionCard
      title="HR role permissions"
      subtitle="What an HR Admin or a Manager may reach. A CRM admin or super admin always has full access regardless of this table."
      padded={false}
    >
      <div className="p-5 space-y-4">
        <Notice tone="info">
          These are enforced by the database, not by hiding menu items: every HR table's policy calls the same
          <code className="mx-1">hr_can_view</code>/<code className="mx-1">hr_can_edit</code> helpers this grid writes to.
          Approving, locking and reopening payroll are hard-gated to a CRM admin and cannot be delegated here.
        </Notice>

        {(['hr_admin', 'manager'] as const).map(role => (
          <div key={role}>
            <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>
              {role === 'hr_admin' ? 'HR Admin' : 'Manager'}
              {role === 'manager' && (
                <span className="ml-2 font-normal normal-case" style={{ color: 'var(--text-faint)' }}>
                  — a manager also always sees their own reports' attendance and can decide their leave
                </span>
              )}
            </p>
            <TableWrap>
              <thead><tr><th className="text-left">Module</th><th className="text-center">View</th><th className="text-center">Edit</th></tr></thead>
              <tbody>
                {rows.filter(r => r.hr_role === role).map(r => (
                  <tr key={r.id}>
                    <td className="capitalize">{r.module}</td>
                    <td className="text-center">
                      <input type="checkbox" checked={r.can_view} disabled={!canEdit || busy}
                        onChange={e => toggle(r, 'can_view', e.target.checked)} />
                    </td>
                    <td className="text-center">
                      <input type="checkbox" checked={r.can_edit} disabled={!canEdit || busy}
                        onChange={e => toggle(r, 'can_edit', e.target.checked)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

/* ------------------------------------------------------------------- audit */

function Audit({ onToast }: { onToast: (m: string, ok?: boolean) => void }) {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [entity, setEntity] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api.listAuditLogs(entity || undefined, 300)); }
    catch (err) { onToast(hrError(err), false); }
    finally { setLoading(false); }
  }, [entity, onToast]);

  useEffect(() => { load(); }, [load]);

  return (
    <SectionCard
      title="Audit log"
      subtitle="Append-only. There is no policy that allows an update or a delete, so the trail cannot be edited through the API by anyone."
      actions={
        <Select value={entity} onChange={e => setEntity(e.target.value)} style={{ width: 170 }}>
          <option value="">Everything</option>
          {['attendance', 'leave', 'salary', 'payroll', 'payslip', 'employee', 'bank_file', 'settings', 'network']
            .map(x => <option key={x} value={x}>{x}</option>)}
        </Select>
      }
      padded={false}
    >
      <div className="p-5">
        {loading ? <Skeleton /> : rows.length === 0 ? (
          <EmptyState icon={Building2} title="Nothing logged yet" />
        ) : (
          <TableWrap>
            <thead>
              <tr><th className="text-left">When</th><th className="text-left">Who</th>
                <th className="text-left">Entity</th><th className="text-left">Action</th>
                <th className="text-left">Reason</th><th className="text-left">IP</th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-xs">
                    {new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </td>
                  <td>
                    <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{r.actor_name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{r.actor_role}</p>
                  </td>
                  <td><Pill value={r.entity} small /></td>
                  <td className="text-xs">{r.action.replace(/_/g, ' ')}</td>
                  <td className="max-w-xs truncate text-xs">{r.reason || '—'}</td>
                  <td className="font-mono text-xs">{r.ip ? String(r.ip) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>
    </SectionCard>
  );
}

export { Coins };
