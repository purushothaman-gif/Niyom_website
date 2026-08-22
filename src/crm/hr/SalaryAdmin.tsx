/**
 * Salary components and effective-dated structures.
 *
 * Two ideas do the work here:
 *
 *   1. COMPONENTS ARE DATA. Basic, HRA, PF, ESI, professional tax and TDS are
 *      rows an admin owns, not rules in the code. The engine knows only how to
 *      evaluate `fixed`, `percent_of`, `balance` and `slab` -- which is why no
 *      budget change needs a deploy.
 *
 *   2. STRUCTURES ARE NEVER OVERWRITTEN. A revision is a new row effective from
 *      a date; the database closes the previous one the day before and refuses
 *      to touch either once a locked payroll references it. That is what makes
 *      an August payslip still reproduce after a September raise.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Coins, History, Plus, Wallet } from 'lucide-react';
import * as api from './hrApi';
import { hrError } from './hrError';
import {
  EmptyState, Field, Input, Modal, Notice, Pill, PrimaryButton, SectionCard,
  Select, Skeleton, TableWrap, Tabs, Textarea,
} from './hrUi';
import { useToast } from './useToast';
import type {
  HRAccess, HREmployee, SalaryComponentRow, SalaryStructureRow, StructureLineRow,
} from './hrTypes';
import { inr } from '../../lib/money';
import { calculatePayroll, round2 } from '../../lib/hr/payrollEngine';
import type { SalaryStructure } from '../../lib/hr/types';
import { toEngineComponent } from './engineMappers';

type Tab = 'structures' | 'components';

const day = (v: string | null) =>
  v ? new Date(v + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'open';

export default function SalaryAdmin({ access }: { access: HRAccess }) {
  const [tab, setTab] = useState<Tab>('structures');
  const { show, node } = useToast();
  return (
    <div className="space-y-5">
      <Tabs<Tab> active={tab} onChange={setTab}
        tabs={[{ key: 'structures', label: 'Salary Structures' }, { key: 'components', label: 'Components' }]} />
      {tab === 'structures' && <Structures onToast={show} canEdit={access.canEdit.salary} />}
      {tab === 'components' && <Components onToast={show} canEdit={access.canEdit.salary} />}
      {node}
    </div>
  );
}

/* --------------------------------------------------------------- structures */

function Structures({ onToast, canEdit }: { onToast: (m: string, ok?: boolean) => void; canEdit: boolean }) {
  const [staff, setStaff] = useState<HREmployee[]>([]);
  const [structures, setStructures] = useState<SalaryStructureRow[]>([]);
  const [lines, setLines] = useState<StructureLineRow[]>([]);
  const [components, setComponents] = useState<SalaryComponentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creatingFor, setCreatingFor] = useState<HREmployee | null>(null);
  const [historyFor, setHistoryFor] = useState<HREmployee | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [e, s, c] = await Promise.all([
        api.listHREmployees(true), api.listStructures(), api.listComponents(true),
      ]);
      setStaff(e); setStructures(s); setComponents(c);
      setLines(await api.listStructureLines(s.map(x => x.id)));
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setLoading(false);
    }
  }, [onToast]);

  useEffect(() => { load(); }, [load]);

  const currentFor = (empId: string) =>
    structures.find(s => s.employee_id === empId && s.effective_to === null && s.status !== 'draft');

  const missing = staff.filter(s => s.status === 'active' && !currentFor(s.id));

  return (
    <div className="space-y-5">
      {missing.length > 0 && (
        <Notice tone="warn" title={`${missing.length} employee(s) have no salary structure`}>
          Payroll refuses to pay anyone without one rather than quietly computing zero:{' '}
          {missing.map(m => m.full_name).join(', ')}.
        </Notice>
      )}

      <SectionCard title="Current salary structures" padded={false}>
        <div className="p-5">
          {loading ? <Skeleton rows={6} /> : staff.length === 0 ? <EmptyState icon={Wallet} title="No employees" /> : (
            <TableWrap>
              <thead>
                <tr>
                  <th className="text-left">Employee</th><th className="text-left">Effective From</th>
                  <th className="text-right">Monthly Gross</th><th className="text-right">Annual CTC</th>
                  <th className="text-left">Components</th><th className="text-right"></th>
                </tr>
              </thead>
              <tbody>
                {staff.filter(s => s.status === 'active').map(s => {
                  const cur = currentFor(s.id);
                  const count = cur ? lines.filter(l => l.structure_id === cur.id).length : 0;
                  return (
                    <tr key={s.id}>
                      <td>
                        <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{s.full_name}</p>
                        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>{s.employee_code}</p>
                      </td>
                      <td>{cur ? day(cur.effective_from) : <Pill value="not set" small />}</td>
                      <td className="text-right tabular-nums font-semibold">
                        {cur ? inr(Number(cur.gross_monthly)) : '—'}
                      </td>
                      <td className="text-right tabular-nums">{cur ? inr(Number(cur.ctc_annual)) : '—'}</td>
                      <td>{count || '—'}</td>
                      <td className="text-right whitespace-nowrap">
                        <button onClick={() => setHistoryFor(s)} className="text-xs font-semibold mr-3"
                          style={{ color: 'var(--text-muted)' }}>
                          <History className="w-3.5 h-3.5 inline mr-0.5" />History
                        </button>
                        {canEdit && (
                          <button onClick={() => setCreatingFor(s)} className="text-xs font-semibold"
                            style={{ color: 'var(--accent-soft)' }}>
                            {cur ? 'Revise' : 'Create'}
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

      {creatingFor && (
        <StructureEditor
          employee={creatingFor}
          components={components}
          current={currentFor(creatingFor.id) ?? null}
          currentLines={lines}
          onClose={() => setCreatingFor(null)}
          onDone={() => { setCreatingFor(null); onToast('Salary structure saved.'); load(); }}
          onError={m => onToast(m, false)}
        />
      )}

      {historyFor && (
        <Modal open onClose={() => setHistoryFor(null)} title={`Salary history — ${historyFor.full_name}`} width="max-w-2xl">
          <div className="p-5">
            <Notice tone="info">
              Every revision is kept. Payroll for a past month uses the structure that was in force then, never the
              latest one — which is what makes an old payslip reproduce exactly.
            </Notice>
            <div className="mt-4">
              <TableWrap>
                <thead>
                  <tr><th className="text-left">Effective</th><th className="text-right">Monthly Gross</th>
                    <th className="text-right">Annual CTC</th><th className="text-left">Reason</th><th className="text-left">Status</th></tr>
                </thead>
                <tbody>
                  {structures.filter(s => s.employee_id === historyFor.id).map(s => (
                    <tr key={s.id}>
                      <td className="whitespace-nowrap">{day(s.effective_from)} → {day(s.effective_to)}</td>
                      <td className="text-right tabular-nums">{inr(Number(s.gross_monthly))}</td>
                      <td className="text-right tabular-nums">{inr(Number(s.ctc_annual))}</td>
                      <td>{s.revision_reason || '—'}</td>
                      <td><Pill value={s.status} small /></td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- editor + preview */

function StructureEditor({ employee, components, current, currentLines, onClose, onDone, onError }: {
  employee: HREmployee; components: SalaryComponentRow[];
  current: SalaryStructureRow | null; currentLines: StructureLineRow[];
  onClose: () => void; onDone: () => void; onError: (m: string) => void;
}) {
  const firstOfNextMonth = () => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString().slice(0, 10);
  };

  const [effectiveFrom, setEffectiveFrom] = useState(current ? firstOfNextMonth() : (employee.joining_date ?? new Date().toISOString().slice(0, 10)));
  const [gross, setGross] = useState(current ? Number(current.gross_monthly) : 0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  // Seed from the current structure so a revision starts as an edit of what is
  // in force, not a blank form someone has to retype.
  const [rows, setRows] = useState<Record<string, { on: boolean; amount: number; percent: number }>>(() => {
    const seed: Record<string, { on: boolean; amount: number; percent: number }> = {};
    for (const c of components) {
      const existing = current ? currentLines.find(l => l.structure_id === current.id && l.component_id === c.id) : null;
      seed[c.id] = {
        on: !!existing || (!current && ['BASIC', 'HRA', 'SPECIAL'].includes(c.code)),
        amount: existing ? Number(existing.amount_monthly) : 0,
        percent: existing?.percent_value !== null && existing?.percent_value !== undefined
          ? Number(existing.percent_value) : Number(c.default_percent ?? 0),
      };
    }
    return seed;
  });

  const recurring = components.filter(c => c.is_recurring);
  const earnings = recurring.filter(c => c.kind === 'earning');
  const deductions = recurring.filter(c => c.kind === 'deduction');
  const employer = recurring.filter(c => c.kind === 'employer_contribution');

  // Live preview through the real engine on a clean full month, so what the
  // admin sees here is the same arithmetic payroll will run.
  const preview = useMemo(() => {
    const selected = recurring.filter(c => rows[c.id]?.on);
    if (selected.length === 0 || gross <= 0) return null;

    const structure: SalaryStructure = {
      id: 'preview', employee_id: employee.id,
      effective_from: effectiveFrom, effective_to: null,
      ctc_annual: 0, gross_monthly: gross,
      lines: selected.map((c, i) => ({
        component_id: c.id,
        calc_type: c.calc_type as SalaryStructure['lines'][number]['calc_type'],
        amount_monthly: rows[c.id].amount,
        percent_value: rows[c.id].percent,
        sort_order: c.sort_order || i,
      })),
    };

    return calculatePayroll({
      employee: {
        employee_id: employee.id, employee_code: employee.employee_code, full_name: employee.full_name,
        designation: employee.designation ?? '', department: employee.profile?.department ?? '',
        joining_date: employee.joining_date, exit_date: null,
        pan: employee.profile?.pan ?? null, uan: employee.profile?.uan ?? null,
        bank_name: employee.bank?.bank_name ?? 'preview', bank_account: employee.bank?.account_number ?? 'preview',
        bank_ifsc: employee.bank?.ifsc ?? 'preview', account_holder: employee.full_name,
      },
      structure,
      components: recurring.map(c => toEngineComponent(c)),
      attendance: {
        calendar_days: 30, working_days: 26, present_days: 26,
        paid_leave_days: 0, unpaid_leave_days: 0, holiday_days: 1, weekly_off_days: 3,
        absent_days: 0, lop_days: 0, payable_days: 30,
        late_days: 0, early_out_days: 0, overtime_minutes: 0, pending_punch_days: 0,
      },
      adjustments: [],
      period: { year: 2026, month: 1, start_date: '2026-01-01', end_date: '2026-01-31' },
      rules: { lop_divisor_mode: 'calendar_days', round_net_to_rupee: true },
    });
  }, [recurring, rows, gross, employee, effectiveFrom]);

  const ctcAnnual = preview ? round2((preview.gross_earnings + preview.employer_contrib) * 12) : 0;

  const save = async () => {
    const selected = recurring.filter(c => rows[c.id]?.on);
    if (selected.length === 0) { onError('Select at least one component.'); return; }
    if (gross <= 0) { onError('Enter the monthly gross.'); return; }
    if (current && effectiveFrom <= current.effective_from) {
      onError(`A revision must start after the current structure began (${day(current.effective_from)}).`); return;
    }

    setBusy(true);
    try {
      await api.createStructure(
        {
          employee_id: employee.id, effective_from: effectiveFrom, effective_to: null,
          ctc_annual: ctcAnnual, gross_monthly: gross,
          revision_reason: reason.trim(), status: 'active',
        },
        selected.map(c => ({
          component_id: c.id, calc_type: c.calc_type,
          amount_monthly: rows[c.id].amount, percent_value: rows[c.id].percent,
          sort_order: c.sort_order,
        })),
      );
      onDone();
    } catch (err) {
      onError(hrError(err));
    } finally {
      setBusy(false);
    }
  };

  const Row = ({ c }: { c: SalaryComponentRow }) => {
    const r = rows[c.id];
    const computed = preview?.lines.find(l => l.component_id === c.id);
    return (
      <tr>
        <td>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={r.on}
              onChange={e => setRows({ ...rows, [c.id]: { ...r, on: e.target.checked } })} />
            <span>
              <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>{c.name}</span>
              <span className="block text-xs" style={{ color: 'var(--text-faint)' }}>
                {c.calc_type === 'balance' ? 'balance of gross'
                  : c.calc_type === 'percent_of' ? `% of ${c.percent_of}`
                  : c.calc_type === 'slab' ? 'slab'
                  : 'fixed amount'}
                {c.cap_base ? ` · base capped at ${inr(Number(c.cap_base))}` : ''}
                {c.eligibility_max_gross ? ` · only up to ${inr(Number(c.eligibility_max_gross))} gross` : ''}
              </span>
            </span>
          </label>
        </td>
        <td className="text-right" style={{ width: 130 }}>
          {c.calc_type === 'fixed' && (
            <Input type="number" value={String(r.amount)} disabled={!r.on} style={{ textAlign: 'right' }}
              onChange={e => setRows({ ...rows, [c.id]: { ...r, amount: Number(e.target.value) } })} />
          )}
          {c.calc_type === 'percent_of' && (
            <Input type="number" step="0.01" value={String(r.percent)} disabled={!r.on} style={{ textAlign: 'right' }}
              onChange={e => setRows({ ...rows, [c.id]: { ...r, percent: Number(e.target.value) } })} />
          )}
          {(c.calc_type === 'balance' || c.calc_type === 'slab') && (
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>auto</span>
          )}
        </td>
        <td className="text-right tabular-nums font-semibold" style={{ width: 120 }}>
          {r.on && computed ? inr(computed.amount, true) : '—'}
        </td>
      </tr>
    );
  };

  return (
    <Modal open onClose={onClose}
      title={current ? `Revise salary — ${employee.full_name}` : `Salary structure — ${employee.full_name}`}
      width="max-w-4xl">
      <div className="p-5 space-y-5 max-h-[76vh] overflow-y-auto">
        {current && (
          <Notice tone="info" title="This creates a revision, it does not overwrite">
            The current structure ({inr(Number(current.gross_monthly))}/month from {day(current.effective_from)}) will be
            closed the day before the new one starts. Payroll for months before that date keeps using the old figures.
          </Notice>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Effective from" required hint={current ? 'Must be after the current structure began.' : undefined}>
            <Input type="date" value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} />
          </Field>
          <Field label="Monthly gross" required hint="The balancing component absorbs whatever is left of this.">
            <Input type="number" value={String(gross)} onChange={e => setGross(Number(e.target.value))} />
          </Field>
          <Field label="Reason">
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Annual increment" />
          </Field>
        </div>

        <Group title="Earnings" rows={earnings} Row={Row} />
        <Group title="Deductions" rows={deductions} Row={Row} />
        <Group title="Employer contributions" rows={employer} Row={Row}
          note="A company cost. Included in CTC, never deducted from take-home." />

        {preview && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Summary label="Monthly Gross" value={inr(preview.gross_earnings, true)} />
            <Summary label="Deductions" value={inr(preview.total_deductions, true)} tone="bad" />
            <Summary label="Net Pay" value={inr(preview.net_pay)} tone="good" />
            <Summary label="Annual CTC" value={inr(ctcAnnual)} />
          </div>
        )}

        {preview?.exceptions.filter(e => e.code === 'gross_mismatch').map((e, i) => (
          <Notice key={i} tone="warn">{e.message}</Notice>
        ))}

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            Cancel
          </button>
          <PrimaryButton onClick={save} disabled={busy}>{busy ? 'Saving…' : current ? 'Save Revision' : 'Save Structure'}</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}

function Group({ title, rows, Row, note }: {
  title: string; rows: SalaryComponentRow[];
  Row: (p: { c: SalaryComponentRow }) => JSX.Element; note?: string;
}) {
  if (rows.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wider mb-1" style={{ color: 'var(--text-secondary)' }}>{title}</p>
      {note && <p className="text-xs mb-2" style={{ color: 'var(--text-faint)' }}>{note}</p>}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--border-subtle)' }}>
        <table className="nw-table w-full text-sm">
          <thead>
            <tr><th className="text-left">Component</th><th className="text-right">Amount / %</th><th className="text-right">Monthly</th></tr>
          </thead>
          <tbody>{rows.map(c => <Row key={c.id} c={c} />)}</tbody>
        </table>
      </div>
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' }) {
  const rgb = tone === 'good' ? '16,185,129' : tone === 'bad' ? '239,68,68' : 'var(--accent-soft-rgb)';
  return (
    <div className="px-3.5 py-3 rounded-xl" style={{ background: `rgba(${rgb},0.08)`, border: `1px solid rgba(${rgb},0.22)` }}>
      <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-faint)' }}>{label}</p>
      <p className="text-base font-bold mt-1 tabular-nums" style={{ color: `rgb(${rgb})` }}>{value}</p>
    </div>
  );
}

/* --------------------------------------------------------------- components */

function Components({ onToast, canEdit }: { onToast: (m: string, ok?: boolean) => void; canEdit: boolean }) {
  const [rows, setRows] = useState<SalaryComponentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<SalaryComponentRow> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api.listComponents()); }
    catch (err) { onToast(hrError(err), false); }
    finally { setLoading(false); }
  }, [onToast]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing?.code?.trim() || !editing.name?.trim()) { onToast('Code and name are required.', false); return; }
    setBusy(true);
    try {
      await api.saveComponent(editing.id ?? null, {
        code: editing.code.trim().toUpperCase(), name: editing.name.trim(),
        kind: editing.kind ?? 'earning',
        calc_type: editing.calc_type ?? 'fixed',
        percent_of: editing.calc_type === 'percent_of' ? (editing.percent_of ?? 'basic') : null,
        default_percent: editing.default_percent === undefined || editing.default_percent === null ? null : Number(editing.default_percent),
        cap_base: nullableNumber(editing.cap_base),
        cap_amount: nullableNumber(editing.cap_amount),
        floor_amount: nullableNumber(editing.floor_amount),
        eligibility_max_gross: nullableNumber(editing.eligibility_max_gross),
        prorate_on_lop: editing.prorate_on_lop ?? true,
        taxable: editing.taxable ?? true,
        include_in_gross: editing.include_in_gross ?? true,
        include_in_ctc: editing.include_in_ctc ?? true,
        show_on_payslip: editing.show_on_payslip ?? true,
        is_recurring: editing.is_recurring ?? true,
        description: editing.description ?? '',
        sort_order: Number(editing.sort_order ?? 0),
        active: editing.active ?? true,
      });
      onToast('Component saved.');
      setEditing(null);
      load();
    } catch (err) {
      onToast(hrError(err), false);
    } finally {
      setBusy(false);
    }
  };

  const group = (kind: string) => rows.filter(r => r.kind === kind);

  return (
    <div className="space-y-5">
      <Notice tone="info" title="Rates here are yours, not the system's">
        PF, ESI, professional tax and TDS were seeded with the conventional rates so payroll works on day one, but
        nothing about Indian tax law is built into the engine. Confirm every rate, ceiling and eligibility limit with
        your consultant before the first live run, and change them here whenever they change.
      </Notice>

      {(['earning', 'deduction', 'employer_contribution'] as const).map(kind => (
        <SectionCard key={kind}
          title={kind === 'earning' ? 'Earnings' : kind === 'deduction' ? 'Deductions' : 'Employer Contributions'}
          actions={canEdit && (
            <PrimaryButton onClick={() => setEditing({ kind, calc_type: 'fixed', active: true, is_recurring: true, prorate_on_lop: true, show_on_payslip: true, include_in_gross: kind === 'earning', include_in_ctc: true, taxable: kind === 'earning' })}>
              <Plus className="w-3.5 h-3.5 inline mr-1" />Add
            </PrimaryButton>
          )}
          padded={false}
        >
          <div className="p-5">
            {loading ? <Skeleton rows={3} /> : group(kind).length === 0 ? (
              <EmptyState icon={Coins} title="No components" />
            ) : (
              <TableWrap>
                <thead>
                  <tr><th className="text-left">Code</th><th className="text-left">Name</th>
                    <th className="text-left">Calculation</th><th className="text-left">Limits</th>
                    <th className="text-left">LOP</th><th className="text-left">Status</th><th className="text-right"></th></tr>
                </thead>
                <tbody>
                  {group(kind).map(c => (
                    <tr key={c.id}>
                      <td className="font-mono text-xs">{c.code}</td>
                      <td>
                        <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>{c.name}</p>
                        {c.description && <p className="text-xs max-w-md" style={{ color: 'var(--text-faint)' }}>{c.description}</p>}
                      </td>
                      <td className="text-xs">
                        {c.calc_type === 'percent_of' ? `${Number(c.default_percent ?? 0)}% of ${c.percent_of}`
                          : c.calc_type === 'balance' ? 'Balance of gross'
                          : c.calc_type === 'slab' ? 'Slab lookup' : 'Fixed'}
                      </td>
                      <td className="text-xs">
                        {c.cap_base ? `base ≤ ${inr(Number(c.cap_base))}` : ''}
                        {c.eligibility_max_gross ? ` gross ≤ ${inr(Number(c.eligibility_max_gross))}` : ''}
                        {!c.cap_base && !c.eligibility_max_gross ? '—' : ''}
                      </td>
                      <td className="text-xs">{c.prorate_on_lop ? 'Pro-rated' : 'Fixed'}</td>
                      <td><Pill value={c.active ? 'active' : 'inactive'} small /></td>
                      <td className="text-right">
                        {canEdit && <button onClick={() => setEditing(c)} className="text-xs font-semibold"
                          style={{ color: 'var(--accent-soft)' }}>Edit</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
            )}
          </div>
        </SectionCard>
      ))}

      {editing && (
        <Modal open onClose={() => setEditing(null)} title={editing.id ? 'Edit component' : 'Add component'} width="max-w-lg">
          <div className="p-5 space-y-4 max-h-[72vh] overflow-y-auto">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Code" required><Input value={editing.code ?? ''} disabled={!!editing.system_seeded}
                onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase() })} /></Field>
              <Field label="Name" required><Input value={editing.name ?? ''}
                onChange={e => setEditing({ ...editing, name: e.target.value })} /></Field>
              <Field label="Kind">
                <Select value={editing.kind ?? 'earning'} disabled={!!editing.id}
                  onChange={e => setEditing({ ...editing, kind: e.target.value })}>
                  <option value="earning">Earning</option><option value="deduction">Deduction</option>
                  <option value="employer_contribution">Employer contribution</option>
                </Select>
              </Field>
              <Field label="Calculation">
                <Select value={editing.calc_type ?? 'fixed'}
                  onChange={e => setEditing({ ...editing, calc_type: e.target.value })}>
                  <option value="fixed">Fixed amount</option>
                  <option value="percent_of">Percentage of…</option>
                  <option value="balance">Balance of gross</option>
                  <option value="slab">Slab lookup</option>
                </Select>
              </Field>
              {editing.calc_type === 'percent_of' && (
                <>
                  <Field label="Percentage of">
                    <Select value={editing.percent_of ?? 'basic'}
                      onChange={e => setEditing({ ...editing, percent_of: e.target.value })}>
                      <option value="basic">Basic</option><option value="gross">Gross</option><option value="ctc">CTC</option>
                    </Select>
                  </Field>
                  <Field label="Default percentage">
                    <Input type="number" step="0.001" value={String(editing.default_percent ?? '')}
                      onChange={e => setEditing({ ...editing, default_percent: Number(e.target.value) })} />
                  </Field>
                </>
              )}
              <Field label="Cap the base at" hint="A wage ceiling, e.g. PF on the first 15,000 of basic.">
                <Input type="number" value={editing.cap_base == null ? '' : String(editing.cap_base)}
                  onChange={e => setEditing({ ...editing, cap_base: e.target.value === '' ? null : Number(e.target.value) })} />
              </Field>
              <Field label="Cap the result at">
                <Input type="number" value={editing.cap_amount == null ? '' : String(editing.cap_amount)}
                  onChange={e => setEditing({ ...editing, cap_amount: e.target.value === '' ? null : Number(e.target.value) })} />
              </Field>
              <Field label="Only applies up to gross" hint="Component switches off entirely above this, e.g. ESI.">
                <Input type="number" value={editing.eligibility_max_gross == null ? '' : String(editing.eligibility_max_gross)}
                  onChange={e => setEditing({ ...editing, eligibility_max_gross: e.target.value === '' ? null : Number(e.target.value) })} />
              </Field>
              <Field label="Sort order">
                <Input type="number" value={String(editing.sort_order ?? 0)}
                  onChange={e => setEditing({ ...editing, sort_order: Number(e.target.value) })} />
              </Field>
            </div>

            <Field label="Description / note">
              <Textarea rows={2} value={editing.description ?? ''}
                onChange={e => setEditing({ ...editing, description: e.target.value })} />
            </Field>

            <div className="grid grid-cols-2 gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              {([
                ['prorate_on_lop', 'Reduce for loss of pay'],
                ['taxable', 'Taxable'],
                ['include_in_gross', 'Counts towards gross'],
                ['include_in_ctc', 'Counts towards CTC'],
                ['show_on_payslip', 'Show on the payslip'],
                ['is_recurring', 'Part of the standing structure'],
                ['active', 'Active'],
              ] as const).map(([k, label]) => (
                <label key={k} className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={(editing as Record<string, unknown>)[k] as boolean ?? false}
                    onChange={e => setEditing({ ...editing, [k]: e.target.checked })} />
                  {label}
                </label>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <PrimaryButton onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Component'}</PrimaryButton>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function nullableNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
