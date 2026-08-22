/**
 * Bulk employee import.
 *
 * The rule this screen exists to enforce: NOTHING is imported until every row
 * has been validated and shown. A partial silent import is worse than a failed
 * one -- it leaves a directory that looks complete and is not.
 *
 * The flow is: download a template -> upload -> validate every row against the
 * same rules the forms use -> show valid and invalid side by side -> import
 * only the valid ones on an explicit second click -> report exactly what
 * happened, including a downloadable list of the rows that were skipped.
 *
 * Creating the auth user still goes through create-crm-user, one row at a time,
 * because that function owns the password gate and the employee-code format.
 * That makes the import slower than a bulk insert would be, and correct.
 */

import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { GhostButton, Modal, Notice, PrimaryButton, Skeleton, TableWrap } from './hrUi';
import * as api from './hrApi';
import { hrError } from './hrError';
import { exportSheet } from './hrExcel';
import { supabase } from '../../lib/supabase';
import type { PaySchedule, WorkSchedule } from './hrTypes';

interface ParsedRow {
  rowNumber: number;
  employee_code: string;
  full_name: string;
  email: string;
  password: string;
  designation: string;
  department: string;
  employment_type: string;
  work_location: string;
  joining_date: string;
  pan: string;
  bank_name: string;
  account_number: string;
  ifsc: string;
  errors: string[];
}

const HEADERS = [
  'Employee ID', 'Full Name', 'Official Email', 'Temporary Password', 'Designation',
  'Department', 'Employment Type', 'Work Location', 'Date of Joining (YYYY-MM-DD)',
  'PAN', 'Bank Name', 'Account Number', 'IFSC',
];

const EXAMPLE = [
  'NIYOM-010', 'Priya Raman', 'priya@niyomwealth.com', 'Welcome@2026', 'Relationship Manager',
  'Sales', 'full_time', 'Chennai', '2026-09-01',
  'ABCDE1234F', 'IDFC FIRST BANK', '89394331135', 'IDFB0080131',
];

const TYPES = ['full_time', 'part_time', 'intern', 'contract', 'consultant'];

export default function EmployeeImport({ schedules, paySchedules, onClose, onDone }: {
  schedules: WorkSchedule[]; paySchedules: PaySchedule[];
  onClose: () => void; onDone: (imported: number) => void;
}) {
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<{ ok: string[]; failed: { code: string; reason: string }[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const downloadTemplate = () =>
    exportSheet('niyom_employee_import_template', 'Employees', [HEADERS, EXAMPLE]);

  const parse = async (file: File) => {
    setParsing(true);
    setReport(null);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

      const existing = await api.listHREmployees(true);
      const seenCodes = new Set(existing.map(e => e.employee_code.toUpperCase()));
      const seenEmails = new Set(existing.map(e => e.email.toLowerCase()));
      const inFileCodes = new Set<string>();
      const inFileEmails = new Set<string>();

      const str = (r: Record<string, unknown>, k: string) => String(r[k] ?? '').trim();

      const parsed: ParsedRow[] = raw.map((r, i) => {
        const row: ParsedRow = {
          rowNumber: i + 2,   // +1 for the header, +1 because spreadsheets are 1-based
          employee_code: str(r, HEADERS[0]).toUpperCase(),
          full_name: str(r, HEADERS[1]),
          email: str(r, HEADERS[2]).toLowerCase(),
          password: str(r, HEADERS[3]),
          designation: str(r, HEADERS[4]),
          department: str(r, HEADERS[5]),
          employment_type: str(r, HEADERS[6]) || 'full_time',
          work_location: str(r, HEADERS[7]) || 'Chennai',
          joining_date: normaliseDate(r[HEADERS[8]]),
          pan: str(r, HEADERS[9]).toUpperCase(),
          bank_name: str(r, HEADERS[10]),
          account_number: str(r, HEADERS[11]).replace(/\D/g, ''),
          ifsc: str(r, HEADERS[12]).toUpperCase(),
          errors: [],
        };

        if (!row.employee_code) row.errors.push('Employee ID is missing');
        else if (!/^NIYOM-\d+$/.test(row.employee_code)) row.errors.push('Employee ID must look like NIYOM-010');
        else if (seenCodes.has(row.employee_code)) row.errors.push('Employee ID already exists');
        else if (inFileCodes.has(row.employee_code)) row.errors.push('Employee ID is duplicated in this file');

        if (!row.full_name) row.errors.push('Name is missing');

        if (!row.email) row.errors.push('Email is missing');
        else if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(row.email)) row.errors.push('Email is not valid');
        else if (seenEmails.has(row.email)) row.errors.push('Email already exists');
        else if (inFileEmails.has(row.email)) row.errors.push('Email is duplicated in this file');

        if (!row.password) row.errors.push('Temporary password is missing');
        else if (row.password.length < 8) row.errors.push('Password must be at least 8 characters');

        if (!row.designation) row.errors.push('Designation is missing');
        if (!TYPES.includes(row.employment_type)) row.errors.push(`Employment type must be one of: ${TYPES.join(', ')}`);
        if (row.joining_date && !/^\d{4}-\d{2}-\d{2}$/.test(row.joining_date)) row.errors.push('Date of joining must be YYYY-MM-DD');
        if (row.pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(row.pan)) row.errors.push('PAN must look like ABCDE1234F');

        // Bank details are optional as a set, but half a set is a silent
        // failure waiting for payday.
        const bankBits = [row.bank_name, row.account_number, row.ifsc].filter(Boolean).length;
        if (bankBits > 0 && bankBits < 3) row.errors.push('Bank name, account number and IFSC must all be given together');
        if (row.ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(row.ifsc)) row.errors.push('IFSC must look like IDFB0080131');
        if (row.account_number && !/^\d{6,20}$/.test(row.account_number)) row.errors.push('Account number must be 6–20 digits');

        if (row.employee_code) inFileCodes.add(row.employee_code);
        if (row.email) inFileEmails.add(row.email);
        return row;
      });

      setRows(parsed);
    } catch {
      setRows([]);
    } finally {
      setParsing(false);
    }
  };

  const valid = (rows ?? []).filter(r => r.errors.length === 0);
  const invalid = (rows ?? []).filter(r => r.errors.length > 0);

  const runImport = async () => {
    if (valid.length === 0) return;
    setImporting(true);
    setProgress(0);
    const ok: string[] = [];
    const failed: { code: string; reason: string }[] = [];
    const { data: { session } } = await supabase.auth.getSession();

    for (let i = 0; i < valid.length; i++) {
      const r = valid[i];
      try {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-crm-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({
            email: r.email, password: r.password, full_name: r.full_name,
            role: 'employee', designation: r.designation, employee_code: r.employee_code,
          }),
        });
        const json = await res.json();
        if (!res.ok || json.error) throw new Error(json.error || 'Could not create the account');

        const list = await api.listHREmployees(true);
        const created = list.find(e => e.employee_code === r.employee_code);
        if (created) {
          await api.saveProfile(created.id, {
            department: r.department, employment_type: r.employment_type,
            work_location: r.work_location, holiday_location: r.work_location,
            pan: r.pan || null,
            work_schedule_id: schedules.find(s => s.is_default)?.id ?? null,
            pay_schedule_id: paySchedules.find(s => s.is_default)?.id ?? null,
            employment_status: 'active',
          });
          if (r.account_number && r.ifsc) {
            await api.saveBankAccount(null, {
              employee_id: created.id, account_holder_name: r.full_name,
              bank_name: r.bank_name, account_number: r.account_number,
              ifsc: r.ifsc, is_primary: true, active: true,
            });
          }
        }
        ok.push(r.employee_code);
      } catch (err) {
        failed.push({ code: r.employee_code, reason: hrError(err, 'Could not create this employee') });
      }
      setProgress(i + 1);
    }

    setImporting(false);
    setReport({ ok, failed });
    if (ok.length) onDone(ok.length);
  };

  const downloadRejects = () => exportSheet('niyom_employee_import_errors', 'Errors', [
    ['Row', ...HEADERS, 'Problems'],
    ...invalid.map(r => [
      r.rowNumber, r.employee_code, r.full_name, r.email, '', r.designation, r.department,
      r.employment_type, r.work_location, r.joining_date, r.pan, r.bank_name, r.account_number,
      r.ifsc, r.errors.join('; '),
    ]),
  ]);

  return (
    <Modal open onClose={onClose} title="Bulk employee import" width="max-w-4xl">
      <div className="p-5 space-y-4 max-h-[75vh] overflow-y-auto">
        {!rows && (
          <>
            <Notice tone="info" title="How this works">
              Upload the template, and every row is checked before anything is created. You will see exactly which rows
              are valid and what is wrong with the rest. Nothing is imported until you press Import, and only the valid
              rows are ever created.
            </Notice>
            <div className="flex items-center gap-3">
              <GhostButton onClick={downloadTemplate}>
                <Download className="w-3.5 h-3.5 inline mr-1" />Download Template
              </GhostButton>
              <PrimaryButton onClick={() => fileRef.current?.click()}>
                <Upload className="w-3.5 h-3.5 inline mr-1" />Choose File
              </PrimaryButton>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden
                onChange={e => { const f = e.target.files?.[0]; if (f) parse(f); }} />
            </div>
          </>
        )}

        {parsing && <Skeleton rows={4} />}

        {rows && !report && (
          <>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="px-3 py-1.5 rounded-lg text-xs font-bold"
                style={{ background: 'rgba(16,185,129,0.12)', color: 'rgb(16,185,129)' }}>
                <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />{valid.length} valid
              </span>
              {invalid.length > 0 && (
                <span className="px-3 py-1.5 rounded-lg text-xs font-bold"
                  style={{ background: 'rgba(239,68,68,0.12)', color: 'rgb(239,68,68)' }}>
                  <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />{invalid.length} will be skipped
                </span>
              )}
              {invalid.length > 0 && (
                <GhostButton onClick={downloadRejects}>
                  <FileSpreadsheet className="w-3.5 h-3.5 inline mr-1" />Download the skipped rows
                </GhostButton>
              )}
              <button onClick={() => { setRows(null); if (fileRef.current) fileRef.current.value = ''; }}
                className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                Choose a different file
              </button>
            </div>

            {rows.length === 0 && (
              <Notice tone="warn" title="Nothing to import">
                No rows were found in that file. Check that the first sheet uses the template's column headings.
              </Notice>
            )}

            {invalid.length > 0 && (
              <div>
                <p className="text-xs font-bold mb-2" style={{ color: 'rgb(239,68,68)' }}>
                  Rows that will be skipped — fix these in your file and upload again
                </p>
                <TableWrap>
                  <thead>
                    <tr><th className="text-left">Row</th><th className="text-left">Employee ID</th>
                      <th className="text-left">Name</th><th className="text-left">Problems</th></tr>
                  </thead>
                  <tbody>
                    {invalid.map(r => (
                      <tr key={r.rowNumber}>
                        <td>{r.rowNumber}</td>
                        <td className="font-mono text-xs">{r.employee_code || '—'}</td>
                        <td>{r.full_name || '—'}</td>
                        <td style={{ color: 'rgb(239,68,68)' }}>{r.errors.join('; ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              </div>
            )}

            {valid.length > 0 && (
              <div>
                <p className="text-xs font-bold mb-2" style={{ color: 'rgb(16,185,129)' }}>Ready to import</p>
                <TableWrap>
                  <thead>
                    <tr><th className="text-left">Employee ID</th><th className="text-left">Name</th>
                      <th className="text-left">Email</th><th className="text-left">Department</th>
                      <th className="text-left">Joining</th><th className="text-left">Bank</th></tr>
                  </thead>
                  <tbody>
                    {valid.map(r => (
                      <tr key={r.rowNumber}>
                        <td className="font-mono text-xs">{r.employee_code}</td>
                        <td>{r.full_name}</td><td>{r.email}</td><td>{r.department}</td>
                        <td>{r.joining_date || '—'}</td>
                        <td>{r.account_number ? `•••• ${r.account_number.slice(-4)}` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              </div>
            )}

            {importing && (
              <Notice tone="info">Creating accounts… {progress} of {valid.length}. Please keep this window open.</Notice>
            )}

            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="px-4 py-2 rounded-xl text-sm font-semibold"
                style={{ background: 'var(--bg-base)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                Cancel
              </button>
              <PrimaryButton onClick={runImport} disabled={importing || valid.length === 0}>
                {importing ? `Importing ${progress}/${valid.length}…` : `Import ${valid.length} Employee(s)`}
              </PrimaryButton>
            </div>
          </>
        )}

        {report && (
          <>
            <Notice tone={report.failed.length ? 'warn' : 'good'} title="Import report">
              {report.ok.length} employee(s) created.
              {report.failed.length > 0 && ` ${report.failed.length} could not be created — see below.`}
              {invalid.length > 0 && ` ${invalid.length} row(s) were skipped because they failed validation.`}
            </Notice>

            {report.failed.length > 0 && (
              <TableWrap>
                <thead><tr><th className="text-left">Employee ID</th><th className="text-left">Reason</th></tr></thead>
                <tbody>
                  {report.failed.map(f => (
                    <tr key={f.code}><td className="font-mono text-xs">{f.code}</td>
                      <td style={{ color: 'rgb(239,68,68)' }}>{f.reason}</td></tr>
                  ))}
                </tbody>
              </TableWrap>
            )}

            <div className="flex justify-end">
              <PrimaryButton onClick={onClose}>Done</PrimaryButton>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/**
 * Excel hands dates back as a serial number when the cell is date-formatted and
 * as a string when it is not. Both have to become YYYY-MM-DD, or a joining date
 * silently becomes 1899.
 */
function normaliseDate(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') {
    // Excel's epoch is 1899-12-30 (its leap-year bug included).
    const ms = Math.round((value - 25569) * 86400 * 1000);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString().slice(0, 10);
}
