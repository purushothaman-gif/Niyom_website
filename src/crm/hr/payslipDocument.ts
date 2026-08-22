/**
 * Payslip PDF.
 *
 * Rendered in the browser from a branded HTML template and printed with
 * html2pdf, exactly as the DSA debit note is (src/crm/dsaDebitNote.ts). That is
 * a deliberate reuse rather than a new pipeline: html2pdf cannot run in Deno, a
 * second rendering stack would drift from the debit note's look, and the data
 * is already in front of the person asking for the document.
 *
 * The figures come from hr_payroll_employee_records and hr_payroll_lines --
 * the SNAPSHOT taken when the run was calculated, never from today's salary
 * configuration. That is what makes an old payslip reproduce identically after
 * a revision, a rename or a component rate change.
 *
 * html2pdf, jspdf and their canvas dependency are heavy, so the import is
 * dynamic: it must stay out of the initial bundle (see the manualChunks note in
 * vite.config.ts).
 */

import { supabase } from '../../lib/supabase';
import { amountInWords } from '../dsaDebitNote';
import type { HRSettings, PayrollLineRow, PayrollRecord, Payslip } from './hrTypes';

const LOGO = '/niyomlogo.png';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

const money = (n: number) =>
  Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const esc = (s: string | null | undefined) =>
  String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const day = (iso: string | null) =>
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export interface PayslipData {
  payslip: Payslip;
  record: PayrollRecord;
  lines: PayrollLineRow[];
  settings: HRSettings | null;
}

/**
 * Everything the document needs, in one round trip.
 *
 * RLS does the access control: an employee can read only their own published
 * payslip and its lines, so a payslip id belonging to someone else returns
 * nothing here rather than rendering.
 */
export async function loadPayslipData(payslipId: string): Promise<PayslipData> {
  const { data: payslip, error } = await supabase
    .from('hr_payslips').select('*').eq('id', payslipId).maybeSingle();
  if (error) throw error;
  if (!payslip) throw new Error('That payslip is not available.');

  const [{ data: record }, { data: lines }, { data: settings }] = await Promise.all([
    supabase.from('hr_payroll_employee_records').select('*').eq('id', payslip.record_id).maybeSingle(),
    supabase.from('hr_payroll_lines').select('*').eq('record_id', payslip.record_id).order('sort_order'),
    supabase.from('hr_settings').select('*').eq('id', 1).maybeSingle(),
  ]);

  if (!record) throw new Error('The payroll record behind this payslip is not available.');

  return { payslip, record, lines: lines ?? [], settings: settings ?? null };
}

/* ------------------------------------------------------------------ layout */

export function buildPayslipHtml({ payslip, record, lines, settings }: PayslipData): string {
  const company   = settings?.company_name ?? 'NIYOM WEALTH DISTRIBUTION LLP';
  const address   = settings?.company_address ?? '';
  const logo      = settings?.company_logo_url || LOGO;
  const footer    = settings?.payslip_footer_note ?? '';
  const signName  = settings?.signatory_name ?? '';
  const signRole  = settings?.signatory_designation ?? '';
  const signImg   = settings?.signatory_signature_url ?? '';

  const shown = lines.filter(l => l.show_on_payslip);
  const earnings  = shown.filter(l => l.kind === 'earning');
  const deductions = shown.filter(l => l.kind === 'deduction');
  const employer   = shown.filter(l => l.kind === 'employer_contribution');

  const grossTotal = earnings.reduce((s, l) => s + Number(l.amount), 0);
  const dedTotal   = deductions.reduce((s, l) => s + Number(l.amount), 0);
  const emprTotal  = employer.reduce((s, l) => s + Number(l.amount), 0);
  const net        = Number(record.net_pay);

  const period = `${MONTHS[payslip.period_month - 1]} ${payslip.period_year}`;

  // Earnings and deductions sit side by side, so the shorter column is padded
  // to keep the ruled table square rather than ragged.
  const rows = Math.max(earnings.length, deductions.length);
  const bodyRows = Array.from({ length: rows }).map((_, i) => {
    const e = earnings[i];
    const d = deductions[i];
    return `<tr>
      <td class="lbl">${e ? esc(e.component_name) : ''}${e?.prorated ? '<span class="pro">pro-rated</span>' : ''}</td>
      <td class="amt">${e ? money(Number(e.amount)) : ''}</td>
      <td class="lbl">${d ? esc(d.component_name) : ''}</td>
      <td class="amt">${d ? money(Number(d.amount)) : ''}</td>
    </tr>`;
  }).join('');

  const employerRows = employer.length
    ? `<div class="block">
         <div class="block-head">Employer Contributions <span>(a company cost — not deducted from your pay)</span></div>
         <table class="mini">
           ${employer.map(l => `<tr><td>${esc(l.component_name)}</td><td class="amt">${money(Number(l.amount))}</td></tr>`).join('')}
           <tr class="tot"><td>Total</td><td class="amt">${money(emprTotal)}</td></tr>
         </table>
       </div>`
    : '';

  return `
<div class="slip">
  <style>
    .slip { width: 794px; box-sizing: border-box; padding: 34px 38px; background: #fff; color: #111;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size: 11px; }
    .slip * { box-sizing: border-box; }
    .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 24px;
           border-bottom: 2px solid #111; padding-bottom: 14px; }
    .brand { display: flex; gap: 12px; align-items: flex-start; }
    .brand img { height: 42px; width: auto; object-fit: contain; }
    .co { font-size: 13px; font-weight: 800; letter-spacing: .2px; }
    .addr { font-size: 9.5px; color: #555; max-width: 300px; line-height: 1.5; margin-top: 3px; }
    .doc { text-align: right; }
    .doc h1 { font-size: 15px; font-weight: 800; letter-spacing: 1.4px; text-transform: uppercase; margin: 0; }
    .doc .per { font-size: 12px; font-weight: 700; margin-top: 3px; }
    .doc .no { font-size: 9px; color: #666; margin-top: 4px; font-family: ui-monospace, Menlo, monospace; }

    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 26px; margin-top: 14px;
            border: 1px solid #ddd; padding: 12px 14px; }
    .kv { display: flex; padding: 3px 0; font-size: 10.5px; }
    .kv .k { width: 120px; color: #666; flex-shrink: 0; }
    .kv .v { font-weight: 600; }

    table { width: 100%; border-collapse: collapse; }
    .main { margin-top: 14px; border: 1px solid #ddd; }
    .main thead th { background: #111; color: #fff; font-size: 9.5px; text-transform: uppercase;
                     letter-spacing: .8px; padding: 7px 10px; text-align: left; font-weight: 700; }
    .main thead th.r, .main td.amt { text-align: right; }
    .main td { padding: 6px 10px; border-top: 1px solid #eee; font-size: 10.5px; }
    .main td.lbl { color: #333; }
    .main td.amt { font-variant-numeric: tabular-nums; font-weight: 600; }
    .main tr.sum td { border-top: 1.5px solid #111; font-weight: 800; background: #fafafa; }
    .pro { font-size: 8px; color: #999; margin-left: 5px; text-transform: uppercase; letter-spacing: .4px; }

    .att { margin-top: 12px; display: flex; gap: 0; border: 1px solid #ddd; }
    .att div { flex: 1; padding: 8px 6px; text-align: center; border-right: 1px solid #eee; }
    .att div:last-child { border-right: 0; }
    .att .l { font-size: 8px; text-transform: uppercase; letter-spacing: .6px; color: #777; }
    .att .n { font-size: 13px; font-weight: 800; margin-top: 2px; font-variant-numeric: tabular-nums; }

    .net { margin-top: 14px; border: 2px solid #111; padding: 13px 16px;
           display: flex; justify-content: space-between; align-items: center; gap: 20px; }
    .net .lab { font-size: 10px; text-transform: uppercase; letter-spacing: 1.2px; color: #444; font-weight: 700; }
    .net .val { font-size: 24px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .words { margin-top: 6px; font-size: 9.5px; color: #444; font-style: italic; }

    .block { margin-top: 14px; border: 1px solid #ddd; }
    .block-head { background: #f4f4f4; padding: 6px 10px; font-size: 9.5px; font-weight: 700;
                  text-transform: uppercase; letter-spacing: .7px; }
    .block-head span { text-transform: none; letter-spacing: 0; font-weight: 400; color: #777; font-size: 9px; }
    .mini td { padding: 5px 10px; border-top: 1px solid #eee; font-size: 10.5px; }
    .mini td.amt { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
    .mini tr.tot td { font-weight: 800; border-top: 1px solid #bbb; }

    .foot { margin-top: 22px; display: flex; justify-content: space-between; align-items: flex-end; gap: 24px; }
    .foot .note { font-size: 8.5px; color: #777; max-width: 380px; line-height: 1.6; }
    .sign { text-align: center; min-width: 190px; }
    .sign img { height: 40px; object-fit: contain; margin-bottom: 2px; }
    .sign .rule { border-top: 1px solid #111; padding-top: 4px; font-size: 9.5px; font-weight: 700; }
    .sign .role { font-size: 8.5px; color: #777; }
  </style>

  <div class="top">
    <div class="brand">
      <img src="${esc(logo)}" alt="" />
      <div>
        <div class="co">${esc(company)}</div>
        <div class="addr">${esc(address)}</div>
      </div>
    </div>
    <div class="doc">
      <h1>Payslip</h1>
      <div class="per">${esc(period)}</div>
      <div class="no">${esc(payslip.payslip_number)}</div>
    </div>
  </div>

  <div class="grid">
    <div>
      <div class="kv"><span class="k">Employee Name</span><span class="v">${esc(record.full_name)}</span></div>
      <div class="kv"><span class="k">Employee ID</span><span class="v">${esc(record.employee_code)}</span></div>
      <div class="kv"><span class="k">Designation</span><span class="v">${esc(record.designation) || '—'}</span></div>
      <div class="kv"><span class="k">Department</span><span class="v">${esc(record.department) || '—'}</span></div>
    </div>
    <div>
      <div class="kv"><span class="k">Date of Joining</span><span class="v">${day(record.joining_date)}</span></div>
      <div class="kv"><span class="k">PAN</span><span class="v">${esc(record.pan) || '—'}</span></div>
      ${record.uan ? `<div class="kv"><span class="k">UAN</span><span class="v">${esc(record.uan)}</span></div>` : ''}
      <div class="kv"><span class="k">Bank A/c</span><span class="v">${record.bank_account ? '•••• ' + esc(record.bank_account.slice(-4)) : '—'}</span></div>
    </div>
  </div>

  <div class="att">
    <div><div class="l">Payable Days</div><div class="n">${Number(record.payable_days)}</div></div>
    <div><div class="l">Present</div><div class="n">${Number(record.present_days)}</div></div>
    <div><div class="l">Paid Leave</div><div class="n">${Number(record.paid_leave_days)}</div></div>
    <div><div class="l">LOP</div><div class="n">${Number(record.lop_days)}</div></div>
    <div><div class="l">Holidays</div><div class="n">${Number(record.holiday_days)}</div></div>
    <div><div class="l">Weekly Off</div><div class="n">${Number(record.weekly_off_days)}</div></div>
  </div>

  <table class="main">
    <thead>
      <tr>
        <th>Earnings</th><th class="r">Amount (₹)</th>
        <th>Deductions</th><th class="r">Amount (₹)</th>
      </tr>
    </thead>
    <tbody>
      ${bodyRows}
      <tr class="sum">
        <td>Gross Earnings</td><td class="amt">${money(grossTotal)}</td>
        <td>Total Deductions</td><td class="amt">${money(dedTotal)}</td>
      </tr>
    </tbody>
  </table>

  <div class="net">
    <div>
      <div class="lab">Net Pay for ${esc(period)}</div>
      <div class="words">${esc(amountInWords(net))}</div>
    </div>
    <div class="val">₹${money(net)}</div>
  </div>

  ${employerRows}

  <div class="foot">
    <div class="note">${esc(footer)}</div>
    <div class="sign">
      ${signImg ? `<img src="${esc(signImg)}" alt="" /><br/>` : '<div style="height:40px"></div>'}
      <div class="rule">${esc(signName) || esc(company)}</div>
      <div class="role">${esc(signRole) || 'Authorised Signatory'}</div>
    </div>
  </div>
</div>`;
}

/* ------------------------------------------------------------------- print */

async function waitForImages(root: HTMLElement): Promise<void> {
  const images = Array.from(root.querySelectorAll('img'));
  await Promise.all(images.map(img => (
    img.complete
      ? Promise.resolve()
      // Resolve on error too: a missing signature image must not stop a payslip
      // from being produced.
      : new Promise<void>(res => { img.onload = () => res(); img.onerror = () => res(); })
  )));
}

export async function generatePayslipBlob(data: PayslipData): Promise<Blob> {
  const { default: html2pdf } = await import('html2pdf.js');

  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '0';
  container.innerHTML = buildPayslipHtml(data);
  document.body.appendChild(container);

  try {
    await waitForImages(container);
    const opt = {
      margin: 0,
      filename: `${data.payslip.payslip_number.replace(/[^\w-]+/g, '_')}.pdf`,
      image: { type: 'png' as const, quality: 1 },
      html2canvas: { scale: 2, useCORS: true, logging: false, windowWidth: 794 },
      jsPDF: { unit: 'mm' as const, format: 'a4', orientation: 'portrait' as const },
      pagebreak: { mode: ['css', 'legacy'] as string[] },
    };
    return await html2pdf().set(opt).from(container.firstElementChild as HTMLElement).outputPdf('blob');
  } finally {
    document.body.removeChild(container);
  }
}

/** Fetch, render and hand the file to the browser. */
export async function downloadPayslip(payslipId: string): Promise<void> {
  const data = await loadPayslipData(payslipId);
  const blob = await generatePayslipBlob(data);

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.payslip.payslip_number.replace(/[^\w-]+/g, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  // Best-effort read receipt. A failure here must never look like a failed
  // download, so it is deliberately not awaited into the error path.
  supabase.from('hr_payslips').update({
    first_viewed_at: data.payslip.first_viewed_at ?? new Date().toISOString(),
    download_count: (data.payslip.download_count ?? 0) + 1,
  }).eq('id', payslipId).then(() => {}, () => {});
}
