/**
 * Leave administration: the approval queue, balances, and the leave-type rules.
 *
 * Approving is the only place a leave request becomes real: hr_decide_leave()
 * expands it into one row per working day, consumes the balance and recomputes
 * the attendance summary for every affected date, all in one transaction. That
 * is why approval goes through the RPC rather than an UPDATE from here -- half
 * of that work landing would leave payroll disagreeing with the register.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarClock, Download, Plus, Scale } from 'lucide-react';
import * as api from './hrApi';
import { hrError } from './hrError';
import {
  ConfirmDialog, EmptyState, Field, GhostButton, Input, Modal, Notice, Pill,
  PrimaryButton, SectionCard, Select, Skeleton, StatTile, TableWrap, Tabs, Textarea,
} from './hrUi';
import { useToast } from './useToast';
import type { HRAccess, HREmployee, LeaveBalance, LeaveRequest, LeaveType } from './hrTypes';
import { exportSheet } from './hrExcel';

type Tab = 'requests' | 'balances' | 'types';

const day = (v: string) =>
  new Date(v + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

export default function LeaveAdmin({ access }: { access: HRAccess }) {
  const [tab, setTab] = useState<Tab>('requests');
  const [pending, setPending] = useState(0);
  const { show, node } = useToast();

  const refresh = useCallback(() => {
    api.listLeaveRequests({ pendingOnly: true }).then(r => setPending(r.length)).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div className="space-y-5">
      <Tabs<Tab>
        active={tab} onChange={setTab}
        tabs={[
          { key: 'requests', label: 'Requests', count: pending },
          { key: 'balances', label: 'Balances' },
          { key: 'types',    label: 'Leave Types' },
        ]}
      />
      {tab === 'requests' && <Requests onToast={show} canEdit={access.canEdit.leave} onChanged={refresh} />}
      {tab === 'balances' && <Balances onToast={show} canEdit={access.canEdit.leave} />}
      {tab === 'types'    && <Types onToast={show} canEdit={access.canEdit.leave} />}
      {node}
    </div>
  );
}

/* ------------------------------------------------------------------ requests */

function Requests({ onToast, canEdit, onChanged }: {
  onToast: (m: string, ok?: boolean) => void; canEdit: boolean; onChanged: () => void;
}) {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [staff, setStaff] = useState<HREmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'pending' | 'all'>('pending');
  const [decision, setDecision] = useState<{ req: LeaveRequest; approve: boolean } | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, t, s] = await Promise.all([
        api.listLeaveRequests(filter === 'pending' ? { pendingOnly: true } : {}),
        api.listLeaveTypes(), api.listHREmployees(true),
      ]);
      setRequests(r); setTypes(t); setStaff(s);
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setLoading(false);
    }
  }, [filter, onToast]);

  useEffect(() => { load(); }, [load]);

  const nameOf = (id: string) => staff.find(s => s.id === id)?.full_name ?? 'Unknown';
  const codeOf = (id: string) => staff.find(s => s.id === id)?.employee_code ?? '';
  const typeOf = (id: string) => types.find(t => t.id === id);

  const decide = async () => {
    if (!decision) return;
    setBusy(true);
    try {
      await api.decideLeave(decision.req.id, decision.approve, note);
      onToast(decision.approve
        ? 'Leave approved. Attendance for those dates has been recalculated.'
        : 'Leave rejected.');
      setDecision(null); setNote('');
      load(); onChanged();
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setBusy(false);
    }
  };

  const stats = useMemo(() => ({
    pending: requests.filter(r => r.status === 'pending').length,
    approved: requests.filter(r => r.status === 'approved').length,
    days: requests.filter(r => r.status === 'approved').reduce((s, r) => s + Number(r.days), 0),
  }), [requests]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Awaiting Decision" value={stats.pending} tone={stats.pending ? 'warn' : 'good'} icon={CalendarClock} />
        <StatTile label="Approved" value={stats.approved} tone="good" />
        <StatTile label="Approved Days" value={stats.days} />
      </div>

      <SectionCard
        title="Leave requests"
        actions={
          <Select value={filter} onChange={e => setFilter(e.target.value as 'pending' | 'all')} style={{ width: 160 }}>
            <option value="pending">Pending only</option>
            <option value="all">All requests</option>
          </Select>
        }
        padded={false}
      >
        <div className="p-5">
          {loading ? <Skeleton /> : requests.length === 0 ? (
            <EmptyState icon={CalendarCheck} title={filter === 'pending' ? 'Nothing waiting' : 'No leave requests'}
              message={filter === 'pending' ? 'Every leave request has been decided.' : undefined} />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className="text-left">Employee</th><th className="text-left">Type</th>
                  <th className="text-left">Dates</th><th className="text-right">Days</th>
                  <th className="text-left">Reason</th><th className="text-left">Status</th>
                  <th className="text-right">Decision</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(r => {
                  const t = typeOf(r.leave_type_id);
                  return (
                    <tr key={r.id}>
                      <td>
                        <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{nameOf(r.employee_id)}</p>
                        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{codeOf(r.employee_id)}</p>
                      </td>
                      <td>
                        {t?.name ?? '—'}
                        {t && !t.paid && <span className="ml-1 text-xs" style={{ color: 'rgb(239,68,68)' }}>(unpaid)</span>}
                      </td>
                      <td className="whitespace-nowrap text-xs">
                        {day(r.from_date)}{r.to_date !== r.from_date && <> → {day(r.to_date)}</>}
                      </td>
                      <td className="text-right tabular-nums font-semibold">{Number(r.days)}</td>
                      <td className="max-w-xs truncate">{r.reason || '—'}</td>
                      <td><Pill value={r.status} small /></td>
                      <td className="text-right whitespace-nowrap">
                        {r.status === 'pending' && canEdit ? (
                          <>
                            <button onClick={() => setDecision({ req: r, approve: true })}
                              className="text-xs font-semibold mr-3" style={{ color: 'rgb(16,185,129)' }}>Approve</button>
                            <button onClick={() => setDecision({ req: r, approve: false })}
                              className="text-xs font-semibold" style={{ color: 'rgb(239,68,68)' }}>Reject</button>
                          </>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--text-faint)' }}>{r.decision_note || '—'}</span>
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

      <ConfirmDialog
        open={!!decision}
        tone={decision?.approve ? 'accent' : 'bad'}
        title={decision?.approve ? 'Approve this leave?' : 'Reject this leave?'}
        message={decision
          ? `${nameOf(decision.req.employee_id)} — ${Number(decision.req.days)} day(s) from ${day(decision.req.from_date)}.` +
            (decision.approve && !typeOf(decision.req.leave_type_id)?.paid
              ? ' This is unpaid leave, so those days will count as loss of pay in that month’s payroll.'
              : '')
          : ''}
        confirmLabel={decision?.approve ? 'Approve' : 'Reject'}
        busy={busy}
        onCancel={() => { setDecision(null); setNote(''); }}
        onConfirm={decide}
      >
        <Field label="Note to the employee">
          <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}

/* ------------------------------------------------------------------ balances */

function Balances({ onToast, canEdit }: { onToast: (m: string, ok?: boolean) => void; canEdit: boolean }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [balances, setBalances] = useState<LeaveBalance[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [staff, setStaff] = useState<HREmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<LeaveBalance | null>(null);
  const [adjust, setAdjust] = useState('0');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, t, s] = await Promise.all([
        api.listLeaveBalances(null, year), api.listLeaveTypes(), api.listHREmployees(true),
      ]);
      setBalances(b); setTypes(t); setStaff(s);
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setLoading(false);
    }
  }, [year, onToast]);

  useEffect(() => { load(); }, [load]);

  const tracked = types.filter(t => t.accrual_mode !== 'none');

  const save = async () => {
    if (!editing) return;
    try {
      await api.adjustLeaveBalance(editing.id, Number(adjust));
      onToast('Balance adjusted.');
      setEditing(null);
      load();
    } catch (err) {
      onToast(hrError(err), false);
    }
  };

  const exportBalances = () => exportSheet(`niyom_leave_balances_${year}`, 'Balances', [
    ['Employee ID', 'Name', ...tracked.map(t => t.name)],
    ...staff.map(s => [
      s.employee_code, s.full_name,
      ...tracked.map(t => Number(balances.find(b => b.employee_id === s.id && b.leave_type_id === t.id)?.balance ?? 0)),
    ]),
  ]);

  return (
    <SectionCard
      title="Leave balances"
      subtitle="Opening balances exist so balances carried over from a previous system can be entered."
      actions={
        <>
          <Select value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 100 }}>
            {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
          </Select>
          <GhostButton onClick={exportBalances}><Download className="w-3.5 h-3.5 inline mr-1" />Excel</GhostButton>
        </>
      }
      padded={false}
    >
      <div className="p-5">
        {loading ? <Skeleton /> : staff.length === 0 ? <EmptyState icon={Scale} title="No employees" /> : (
          <TableWrap>
            <thead>
              <tr>
                <th className="text-left">Employee</th>
                {tracked.map(t => <th key={t.id} className="text-right">{t.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {staff.map(s => (
                <tr key={s.id}>
                  <td>
                    <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{s.full_name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{s.employee_code}</p>
                  </td>
                  {tracked.map(t => {
                    const b = balances.find(x => x.employee_id === s.id && x.leave_type_id === t.id);
                    return (
                      <td key={t.id} className="text-right">
                        <span className="tabular-nums font-semibold" style={{ color: 'var(--text-primary)' }}>
                          {Number(b?.balance ?? 0)}
                        </span>
                        <span className="text-xs ml-1" style={{ color: 'var(--text-faint)' }}>
                          / {Number(b?.used ?? 0)} used
                        </span>
                        {canEdit && b && (
                          <button onClick={() => { setEditing(b); setAdjust(String(b.adjusted)); }}
                            className="block ml-auto text-xs font-semibold" style={{ color: 'var(--accent-soft)' }}>
                            Adjust
                          </button>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>

      {editing && (
        <Modal open onClose={() => setEditing(null)} title="Adjust leave balance">
          <div className="p-5 space-y-4">
            <Notice tone="info">
              An adjustment is a signed correction on top of the accrued balance — use a negative number to reduce it.
              Accrued days and days used are not editable, so the arithmetic stays traceable.
            </Notice>
            <Field label="Adjustment (days)" hint="Positive adds, negative removes.">
              <Input type="number" step="0.5" value={adjust} onChange={e => setAdjust(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <PrimaryButton onClick={save}>Save Adjustment</PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
    </SectionCard>
  );
}

/* --------------------------------------------------------------------- types */

function Types({ onToast, canEdit }: { onToast: (m: string, ok?: boolean) => void; canEdit: boolean }) {
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<LeaveType> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setTypes(await api.listLeaveTypes()); }
    catch (err) { onToast(hrError(err), false); }
    finally { setLoading(false); }
  }, [onToast]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing?.code?.trim() || !editing.name?.trim()) { onToast('Code and name are required.', false); return; }
    setBusy(true);
    try {
      await api.saveLeaveType(editing.id ?? null, {
        code: editing.code.trim().toUpperCase(), name: editing.name.trim(),
        paid: editing.paid ?? true,
        accrual_mode: editing.accrual_mode ?? 'annual',
        annual_quota: Number(editing.annual_quota ?? 0),
        monthly_accrual: Number(editing.monthly_accrual ?? 0),
        carry_forward: editing.carry_forward ?? false,
        carry_forward_max: Number(editing.carry_forward_max ?? 0),
        max_balance: editing.max_balance === null || editing.max_balance === undefined ? null : Number(editing.max_balance),
        requires_approval: editing.requires_approval ?? true,
        allow_half_day: editing.allow_half_day ?? true,
        allow_negative: editing.allow_negative ?? false,
        counts_as_lop: editing.paid === false ? true : (editing.counts_as_lop ?? false),
        colour: editing.colour ?? '#6366f1',
        sort_order: Number(editing.sort_order ?? 0),
        active: editing.active ?? true,
      });
      onToast('Leave type saved.');
      setEditing(null);
      load();
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <SectionCard
      title="Leave types"
      subtitle="An unpaid type automatically becomes loss of pay in payroll."
      actions={canEdit && <PrimaryButton onClick={() => setEditing({ paid: true, accrual_mode: 'annual', active: true, allow_half_day: true, requires_approval: true })}>
        <Plus className="w-3.5 h-3.5 inline mr-1" />Add Type
      </PrimaryButton>}
      padded={false}
    >
      <div className="p-5">
        {loading ? <Skeleton /> : (
          <TableWrap>
            <thead>
              <tr>
                <th className="text-left">Code</th><th className="text-left">Name</th><th className="text-left">Paid</th>
                <th className="text-left">Accrual</th><th className="text-right">Quota</th>
                <th className="text-left">Carry forward</th><th className="text-left">Status</th>
                <th className="text-right"></th>
              </tr>
            </thead>
            <tbody>
              {types.map(t => (
                <tr key={t.id}>
                  <td className="font-mono text-xs">{t.code}</td>
                  <td><span style={{ color: t.colour }}>●</span> {t.name}</td>
                  <td>{t.paid ? 'Paid' : <span style={{ color: 'rgb(239,68,68)' }}>Unpaid (LOP)</span>}</td>
                  <td>{t.accrual_mode === 'monthly' ? `${Number(t.monthly_accrual)}/month` : t.accrual_mode === 'annual' ? 'Annual' : 'None'}</td>
                  <td className="text-right tabular-nums">{Number(t.annual_quota)}</td>
                  <td>{t.carry_forward ? `Up to ${Number(t.carry_forward_max)}` : 'No'}</td>
                  <td><Pill value={t.active ? 'active' : 'inactive'} small /></td>
                  <td className="text-right">
                    {canEdit && (
                      <button onClick={() => setEditing(t)} className="text-xs font-semibold"
                        style={{ color: 'var(--accent-soft)' }}>Edit</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </div>

      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? 'Edit leave type' : 'Add leave type'} width="max-w-lg">
          <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code" required><Input value={editing.code ?? ''} disabled={!!editing.id}
                onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase() })} /></Field>
              <Field label="Name" required><Input value={editing.name ?? ''}
                onChange={e => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Paid">
                <Select value={editing.paid === false ? 'no' : 'yes'}
                  onChange={e => setEditing({ ...editing, paid: e.target.value === 'yes' })}>
                  <option value="yes">Paid</option><option value="no">Unpaid — counts as LOP</option>
                </Select>
              </Field>
              <Field label="Accrual">
                <Select value={editing.accrual_mode ?? 'annual'}
                  onChange={e => setEditing({ ...editing, accrual_mode: e.target.value })}>
                  <option value="annual">Annual allocation</option>
                  <option value="monthly">Monthly accrual</option>
                  <option value="none">No entitlement tracking</option>
                </Select>
              </Field>
              <Field label="Annual quota (days)"><Input type="number" step="0.5" value={String(editing.annual_quota ?? 0)}
                onChange={e => setEditing({ ...editing, annual_quota: Number(e.target.value) })} /></Field>
              <Field label="Accrual per month"><Input type="number" step="0.25" value={String(editing.monthly_accrual ?? 0)}
                onChange={e => setEditing({ ...editing, monthly_accrual: Number(e.target.value) })} /></Field>
              <Field label="Carry forward max"><Input type="number" step="0.5" value={String(editing.carry_forward_max ?? 0)}
                onChange={e => setEditing({ ...editing, carry_forward_max: Number(e.target.value), carry_forward: Number(e.target.value) > 0 })} /></Field>
              <Field label="Maximum balance" hint="Blank for no cap">
                <Input type="number" step="0.5" value={editing.max_balance == null ? '' : String(editing.max_balance)}
                  onChange={e => setEditing({ ...editing, max_balance: e.target.value === '' ? null : Number(e.target.value) })} />
              </Field>
              <Field label="Colour"><Input type="color" value={editing.colour ?? '#6366f1'}
                onChange={e => setEditing({ ...editing, colour: e.target.value })} /></Field>
              <Field label="Sort order"><Input type="number" value={String(editing.sort_order ?? 0)}
                onChange={e => setEditing({ ...editing, sort_order: Number(e.target.value) })} /></Field>
            </div>

            <div className="flex flex-wrap gap-4 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editing.allow_half_day ?? true}
                  onChange={e => setEditing({ ...editing, allow_half_day: e.target.checked })} />Allow half days
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editing.allow_negative ?? false}
                  onChange={e => setEditing({ ...editing, allow_negative: e.target.checked })} />Allow negative balance
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editing.active ?? true}
                  onChange={e => setEditing({ ...editing, active: e.target.checked })} />Active
              </label>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <PrimaryButton onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Type'}</PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
    </SectionCard>
  );
}
