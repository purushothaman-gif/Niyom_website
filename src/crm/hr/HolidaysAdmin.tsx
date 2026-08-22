/**
 * Holiday calendar.
 *
 * A holiday is a paid day that is excluded from working-day counts, so the
 * calendar directly changes payable days and therefore pay. Only the three
 * statutory national dates were seeded (Republic Day, Independence Day, Gandhi
 * Jayanti) -- Pongal, Diwali and the rest move each year, and putting guessed
 * dates into payroll would be worse than an empty calendar.
 */

import { useCallback, useEffect, useState } from 'react';
import { CalendarDays, Download, Plus, Upload } from 'lucide-react';
import * as api from './hrApi';
import { hrError } from './hrError';
import {
  ConfirmDialog, EmptyState, Field, GhostButton, Input, Modal, Notice, Pill,
  PrimaryButton, SectionCard, Select, Skeleton, TableWrap, Textarea,
} from './hrUi';
import { useToast } from './useToast';
import type { HRAccess, Holiday } from './hrTypes';
import { exportSheet } from './hrExcel';

export default function HolidaysAdmin({ employeeId, access }: { employeeId: string; access: HRAccess }) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [rows, setRows] = useState<Holiday[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Holiday> | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const { show, node } = useToast();

  const canEdit = access.canEdit.holidays;

  const load = useCallback(async () => {
    setLoading(true);
    try { setRows(await api.listHolidays(year)); }
    catch (err) { show(hrError(err), false); }
    finally { setLoading(false); }
  }, [year, show]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!editing?.name?.trim() || !editing.holiday_date) { show('Name and date are required.', false); return; }
    setBusy(true);
    try {
      await api.saveHoliday(editing.id ?? null, {
        name: editing.name.trim(), holiday_date: editing.holiday_date,
        holiday_type: editing.holiday_type ?? 'public',
        location: editing.location?.trim() || 'Chennai',
        paid: editing.paid ?? true,
        auto_applies: editing.auto_applies ?? true,
        description: editing.description ?? '',
        active: editing.active ?? true,
        created_by: employeeId,
      });
      show('Holiday saved. Attendance for that date will use it from the next recalculation.');
      setEditing(null);
      load();
    } catch (err) {
      show(hrError(err), false);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleteId) return;
    setBusy(true);
    try {
      await api.deleteHoliday(deleteId);
      show('Holiday removed.');
      setDeleteId(null);
      load();
    } catch (err) {
      show(hrError(err), false);
    } finally {
      setBusy(false);
    }
  };

  const exportCalendar = () => exportSheet(`niyom_holidays_${year}`, 'Holidays', [
    ['Date', 'Day', 'Name', 'Type', 'Location', 'Paid'],
    ...rows.map(h => [
      h.holiday_date,
      new Date(h.holiday_date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long' }),
      h.name, h.holiday_type, h.location, h.paid ? 'Yes' : 'No',
    ]),
  ]);

  return (
    <div className="space-y-5">
      {rows.length <= 3 && (
        <Notice tone="warn" title="The holiday calendar is nearly empty">
          Only the fixed national dates are seeded. Pongal, Tamil New Year, Diwali and the rest change every year, so
          they were deliberately not guessed — add this year's list before running payroll, because every holiday is a
          paid day excluded from working days.
        </Notice>
      )}

      <SectionCard
        title="Holiday calendar"
        subtitle="Holidays are paid and excluded from working-day counts, so they change payable days."
        actions={
          <>
            <Select value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 100 }}>
              {[year - 1, year, year + 1, year + 2].map(y => <option key={y} value={y}>{y}</option>)}
            </Select>
            <GhostButton onClick={exportCalendar}><Download className="w-3.5 h-3.5 inline mr-1" />Excel</GhostButton>
            {canEdit && (
              <>
                <GhostButton onClick={() => setImporting(true)}><Upload className="w-3.5 h-3.5 inline mr-1" />Import</GhostButton>
                <PrimaryButton onClick={() => setEditing({ holiday_type: 'public', location: 'Chennai', paid: true, auto_applies: true, active: true })}>
                  <Plus className="w-3.5 h-3.5 inline mr-1" />Add Holiday
                </PrimaryButton>
              </>
            )}
          </>
        }
        padded={false}
      >
        <div className="p-5">
          {loading ? <Skeleton /> : rows.length === 0 ? (
            <EmptyState icon={CalendarDays} title={`No holidays for ${year}`}
              message="Add them one at a time, or import a list." />
          ) : (
            <TableWrap>
              <thead>
                <tr>
                  <th className="text-left">Date</th><th className="text-left">Day</th><th className="text-left">Name</th>
                  <th className="text-left">Type</th><th className="text-left">Location</th>
                  <th className="text-left">Paid</th><th className="text-right"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(h => (
                  <tr key={h.id}>
                    <td className="whitespace-nowrap font-semibold">
                      {new Date(h.holiday_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                    </td>
                    <td>{new Date(h.holiday_date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' })}</td>
                    <td>{h.name}</td>
                    <td><Pill value={h.holiday_type} small /></td>
                    <td>{h.location}</td>
                    <td>{h.paid ? 'Yes' : 'No'}</td>
                    <td className="text-right whitespace-nowrap">
                      {canEdit && (
                        <>
                          <button onClick={() => setEditing(h)} className="text-xs font-semibold mr-3"
                            style={{ color: 'var(--accent-soft)' }}>Edit</button>
                          <button onClick={() => setDeleteId(h.id)} className="text-xs font-semibold"
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
        <Modal open onClose={() => setEditing(null)} title={editing.id ? 'Edit holiday' : 'Add holiday'}>
          <div className="p-5 space-y-4">
            <Field label="Holiday name" required>
              <Input value={editing.name ?? ''} onChange={e => setEditing({ ...editing, name: e.target.value })}
                placeholder="Pongal" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date" required>
                <Input type="date" value={editing.holiday_date ?? ''}
                  onChange={e => setEditing({ ...editing, holiday_date: e.target.value })} />
              </Field>
              <Field label="Type">
                <Select value={editing.holiday_type ?? 'public'}
                  onChange={e => setEditing({ ...editing, holiday_type: e.target.value })}>
                  <option value="public">Public</option><option value="restricted">Restricted</option>
                  <option value="optional">Optional</option><option value="company">Company</option>
                </Select>
              </Field>
              <Field label="Location">
                <Input value={editing.location ?? 'Chennai'}
                  onChange={e => setEditing({ ...editing, location: e.target.value })} />
              </Field>
              <Field label="Applies automatically" hint="Off for optional holidays staff must apply for.">
                <Select value={editing.auto_applies === false ? 'no' : 'yes'}
                  onChange={e => setEditing({ ...editing, auto_applies: e.target.value === 'yes' })}>
                  <option value="yes">Yes — a non-working paid day</option>
                  <option value="no">No — staff must apply</option>
                </Select>
              </Field>
            </div>
            <Field label="Description">
              <Textarea rows={2} value={editing.description ?? ''}
                onChange={e => setEditing({ ...editing, description: e.target.value })} />
            </Field>
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <PrimaryButton onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save Holiday'}</PrimaryButton>
            </div>
          </div>
        </Modal>
      )}

      {importing && (
        <HolidayImport employeeId={employeeId} onClose={() => setImporting(false)}
          onDone={n => { setImporting(false); show(`${n} holiday(s) imported.`); load(); }}
          onError={m => show(m, false)} />
      )}

      <ConfirmDialog
        open={!!deleteId}
        title="Remove this holiday?"
        message="Attendance already computed for that date keeps its holiday status until the day is recalculated."
        confirmLabel="Remove"
        busy={busy}
        onCancel={() => setDeleteId(null)}
        onConfirm={remove}
      />

      {node}
    </div>
  );
}

function HolidayImport({ employeeId, onClose, onDone, onError }: {
  employeeId: string; onClose: () => void; onDone: (n: number) => void; onError: (m: string) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) { onError('Paste at least one line.'); return; }

    const parsed: { date: string; name: string }[] = [];
    const bad: string[] = [];
    for (const line of lines) {
      const [date, ...rest] = line.split(',');
      const name = rest.join(',').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date?.trim() ?? '') || !name) { bad.push(line); continue; }
      parsed.push({ date: date.trim(), name });
    }

    if (bad.length) { onError(`${bad.length} line(s) are not in the form YYYY-MM-DD, Name — nothing was imported.`); return; }

    setBusy(true);
    let n = 0;
    try {
      for (const p of parsed) {
        await api.saveHoliday(null, {
          name: p.name, holiday_date: p.date, holiday_type: 'public',
          location: 'Chennai', paid: true, auto_applies: true, active: true, created_by: employeeId,
        });
        n++;
      }
      onDone(n);
    } catch (err) {
      onError(`${hrError(err)} ${n} holiday(s) were imported before the error.`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Import holidays">
      <div className="p-5 space-y-4">
        <Notice tone="info">
          One holiday per line, as <code>YYYY-MM-DD, Name</code>. Every line is checked first — if any line is
          malformed, nothing is imported.
        </Notice>
        <Field label="Holidays">
          <Textarea rows={10} value={text} onChange={e => setText(e.target.value)}
            placeholder={'2026-01-14, Pongal\n2026-01-15, Thiruvalluvar Day\n2026-04-14, Tamil New Year'} />
        </Field>
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold"
            style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
            Cancel
          </button>
          <PrimaryButton onClick={run} disabled={busy}>{busy ? 'Importing…' : 'Import'}</PrimaryButton>
        </div>
      </div>
    </Modal>
  );
}
