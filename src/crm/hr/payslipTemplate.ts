/**
 * The payslip document, as HTML.
 *
 * Pure: it takes data and returns a string. Split out of payslipDocument.ts so
 * it can be tested without pulling in the Supabase client -- this is the one
 * document every employee actually receives, and "does it still say the right
 * things" deserves a test rather than a look.
 *
 * There is deliberately NO signatory block. A signature line on a
 * computer-generated payslip invites someone to sign a figure they did not
 * compute; the footer states that the document is generated instead.
 */

import { amountInWords } from '../../lib/money';
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
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';

export interface PayslipData {
  payslip: Payslip;
  record: PayrollRecord;
  lines: PayrollLineRow[];
  settings: HRSettings | null;
}

/* ------------------------------------------------------------------ layout */

export function buildPayslipHtml({ payslip, record, lines, settings }: PayslipData): string {
  const company   = settings?.company_name ?? 'NIYOM WEALTH DISTRIBUTION LLP';
  const address   = settings?.company_address ?? '';
  const logo      = settings?.company_logo_url || LOGO;
  const footer    = settings?.payslip_footer_note ?? '';

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

    /* No signatory block: this document is generated, and a signature line on
       a computer-generated payslip invites someone to sign a figure they did
       not compute. The footer says so plainly instead. */
    .foot { margin-top: 24px; padding-top: 10px; border-top: 1px solid #ddd; text-align: center; }
    .foot .note { font-size: 8.5px; color: #777; line-height: 1.6; margin: 0 auto; max-width: 520px; }
    .foot .meta { font-size: 8px; color: #999; margin-top: 4px; }
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
    <div class="meta">${esc(company)} &middot; Payslip ${esc(payslip.payslip_number)}</div>
  </div>
</div>`;
}
