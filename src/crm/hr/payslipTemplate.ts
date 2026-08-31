/**
 * The payslip document, as HTML.
 *
 * Modelled on the payslips staff already recognise from the previous system:
 * net pay and paid days in the header, a year-to-date column beside every
 * component, earnings above deductions rather than side by side.
 *
 * Pure: it takes data and returns a string. Kept apart from payslipDocument.ts
 * so it can be tested without pulling in the Supabase client -- this is the one
 * artefact of the whole module that an employee actually receives.
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
  iso ? new Date(iso + 'T00:00:00').toLocaleDateString('en-IN',
    { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

/** Trim a number that may arrive as a numeric string from Postgres. */
const n = (v: unknown) => Number(v ?? 0);

export interface PayslipData {
  payslip: Payslip;
  record: PayrollRecord;
  lines: PayrollLineRow[];
  settings: HRSettings | null;
  /**
   * Year-to-date total per component code, for the Indian financial year
   * (April to March) up to and including this payslip's month. Empty when the
   * history has not been loaded, in which case the column is simply omitted
   * rather than printed as zeros -- a YTD of 0.00 beside a paid component
   * reads as an error, and a missing column reads as what it is.
   */
  ytd?: Record<string, number>;
}

/**
 * The Indian financial year runs April to March, so a payslip for January 2027
 * accumulates from April 2026, not January.
 */
export function financialYearStart(year: number, month: number): { year: number; month: number } {
  return month >= 4 ? { year, month: 4 } : { year: year - 1, month: 4 };
}

export function buildPayslipHtml({ payslip, record, lines, settings, ytd }: PayslipData): string {
  const company = settings?.company_name ?? 'NIYOM WEALTH DISTRIBUTION LLP';
  const address = settings?.company_address ?? '';
  const logo    = settings?.company_logo_url || LOGO;
  const footer  = settings?.payslip_footer_note ?? '';

  const shown      = lines.filter(l => l.show_on_payslip);
  const earnings   = shown.filter(l => l.kind === 'earning');
  const deductions = shown.filter(l => l.kind === 'deduction');
  const employer   = shown.filter(l => l.kind === 'employer_contribution');

  const grossTotal = earnings.reduce((s, l) => s + n(l.amount), 0);
  const dedTotal   = deductions.reduce((s, l) => s + n(l.amount), 0);
  const emprTotal  = employer.reduce((s, l) => s + n(l.amount), 0);
  const net        = n(record.net_pay);

  /*
   * A waived loss-of-pay day is presented as a day worked, because that is
   * exactly what waiving it means: the employee is paid as though they were
   * there. Paid Days and LOP Days already reflect the waiver -- the summary is
   * adjusted before payroll is written -- but present days deliberately does
   * not, so the attendance reports keep showing what really happened.
   *
   * Without this the payslip contradicts itself: "Present 26, Paid 31, LOP 0"
   * invites precisely the question the waiver was granted to settle. Adding
   * the waived days back makes present + leave + holidays + weekly offs equal
   * paid days again, and the month reads as an ordinary one.
   */
  const waived     = n((record as { lop_waived_days?: number }).lop_waived_days ?? 0);

  /*
   * The payslip shows Present / Paid Leave / Holidays / Weekly Off beside Paid
   * Days, so those four have to add up to Paid Days or the document argues
   * with itself. Two things break that, and both mean "paid as though worked":
   *
   *   - a waived LOP day, which is the whole point of waiving it;
   *   - a day of the month that has not finished yet, if payroll is run before
   *     month end -- it is payable but not yet marked present.
   *
   * Deriving the balance covers both without needing to know which. Floored at
   * the real figure so it can never UNDERSTATE someone's attendance: for every
   * settled month the two are identical, and the derivation only ever fills a
   * gap that is already being paid for.
   */
  const balance    = n(record.payable_days) - n(record.paid_leave_days)
                   - n(record.holiday_days) - n(record.weekly_off_days);
  const presentDays = Math.max(n(record.present_days) + waived, balance);

  const period = `${MONTHS[payslip.period_month - 1]} ${payslip.period_year}`;
  const hasYtd = !!ytd && Object.keys(ytd).length > 0;
  const ytdOf  = (code: string) => (ytd && ytd[code] !== undefined ? money(ytd[code]) : '');

  const rows = (group: PayrollLineRow[]) => group.map(l => `
    <tr>
      <td class="lbl">${esc(l.component_name)}${l.prorated ? '<span class="pro">pro-rated</span>' : ''}</td>
      <td class="amt">${money(n(l.amount))}</td>
      ${hasYtd ? `<td class="amt ytd">${ytdOf(l.component_code)}</td>` : ''}
    </tr>`).join('');

  const totalRow = (label: string, value: number) => `
    <tr class="sum">
      <td>${label}</td>
      <td class="amt">${money(value)}</td>
      ${hasYtd ? '<td class="amt ytd"></td>' : ''}
    </tr>`;

  const head = (label: string) => `
    <thead>
      <tr>
        <th>${label}</th>
        <th class="r">Amount (₹)</th>
        ${hasYtd ? '<th class="r">Year to Date (₹)</th>' : ''}
      </tr>
    </thead>`;

  const employerBlock = employer.length ? `
  <table class="grid">
    ${head('Employer Contributions')}
    <tbody>
      ${rows(employer)}
      ${totalRow('Total', emprTotal)}
    </tbody>
  </table>
  <p class="hint">Employer contributions are a company cost. They form part of your CTC and are not deducted from your pay.</p>` : '';

  return `
<div class="slip">
  <style>
    /* Height follows the content. Pinning the footer to the bottom of an A4
       page put a hole in the middle of a short payslip, which reads as broken;
       a document that simply ends, leaving margin below, reads as finished. */
    .slip { width: 794px; box-sizing: border-box; padding: 34px 40px 30px;
            background: #fff; color: #111;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
            font-size: 11px; }
    .slip * { box-sizing: border-box; }

    /* Header: issuer on the left, the number everyone opens the payslip for on
       the right. */
    .top { display: flex; justify-content: space-between; align-items: flex-start; gap: 28px;
           padding-bottom: 16px; border-bottom: 2px solid #111; }
    .brand { display: flex; gap: 13px; align-items: flex-start; }
    .brand img { height: 46px; width: auto; object-fit: contain; }
    .co { font-size: 13.5px; font-weight: 800; letter-spacing: .2px; line-height: 1.25; }
    .addr { font-size: 9.5px; color: #555; max-width: 330px; line-height: 1.55; margin-top: 4px; }
    .netbox { text-align: right; flex-shrink: 0; }
    .netbox .lab { font-size: 9px; text-transform: uppercase; letter-spacing: 1.1px; color: #666; font-weight: 700; }
    .netbox .val { font-size: 27px; font-weight: 800; line-height: 1.1; margin-top: 2px;
                   font-variant-numeric: tabular-nums; }
    .netbox .days { font-size: 9.5px; color: #444; margin-top: 5px; }
    .netbox .days b { font-weight: 700; }

    .period { margin-top: 15px; font-size: 15px; font-weight: 800; }
    .who { margin-top: 3px; font-size: 12px; font-weight: 700; }
    .whosub { font-size: 10px; color: #555; margin-top: 2px; }

    .facts { margin-top: 14px; border: 1px solid #ddd; display: grid;
             grid-template-columns: 1fr 1fr; gap: 0 26px; padding: 11px 14px; }
    .kv { display: flex; padding: 3px 0; font-size: 10.5px; }
    .kv .k { width: 122px; color: #666; flex-shrink: 0; }
    .kv .v { font-weight: 600; }

    table.grid { width: 100%; border-collapse: collapse; margin-top: 14px; border: 1px solid #ddd; }
    table.grid thead th { background: #111; color: #fff; font-size: 9.5px; text-transform: uppercase;
                          letter-spacing: .8px; padding: 7px 11px; text-align: left; font-weight: 700; }
    table.grid thead th.r { text-align: right; }
    table.grid td { padding: 6.5px 11px; border-top: 1px solid #eee; font-size: 10.5px; }
    table.grid td.amt { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
    table.grid td.ytd { color: #666; font-weight: 500; }
    table.grid tr.sum td { border-top: 1.5px solid #111; font-weight: 800; background: #fafafa; }
    .pro { font-size: 8px; color: #999; margin-left: 6px; text-transform: uppercase; letter-spacing: .4px; }
    .hint { font-size: 8.5px; color: #888; margin: 5px 2px 0; }

    .net { margin-top: 16px; border: 2px solid #111; padding: 14px 17px;
           display: flex; justify-content: space-between; align-items: center; gap: 20px; }
    .net .lab { font-size: 10.5px; text-transform: uppercase; letter-spacing: 1.2px;
                color: #333; font-weight: 800; }
    .net .words { font-size: 9.5px; color: #555; font-style: italic; margin-top: 3px; }
    .net .val { font-size: 25px; font-weight: 800; font-variant-numeric: tabular-nums; }

    .formula { font-size: 9px; color: #777; margin-top: 8px; }

    .foot { margin-top: 20px; padding-top: 12px; border-top: 1px solid #ddd; text-align: center; }
    .foot .note { font-size: 8.5px; color: #777; line-height: 1.6; margin: 0 auto; max-width: 540px; }
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
    <div class="netbox">
      <div class="lab">Total Net Pay</div>
      <div class="val">₹${money(net)}</div>
      <div class="days">
        Paid Days: <b>${n(record.payable_days)}</b> &nbsp;|&nbsp; LOP Days: <b>${n(record.lop_days)}</b>
      </div>
    </div>
  </div>

  <div class="period">Payslip for the month of ${esc(period)}</div>
  <div class="who">${esc(record.full_name)}, ${esc(record.employee_code)}</div>
  <div class="whosub">
    ${esc(record.designation) || '—'} &nbsp;|&nbsp; Date of Joining: ${day(record.joining_date)}
  </div>

  <div class="facts">
    <div>
      <div class="kv"><span class="k">Employee ID</span><span class="v">${esc(record.employee_code)}</span></div>
      <div class="kv"><span class="k">Department</span><span class="v">${esc(record.department) || '—'}</span></div>
      <div class="kv"><span class="k">PAN</span><span class="v">${esc(record.pan) || '—'}</span></div>
      ${record.uan ? `<div class="kv"><span class="k">UAN</span><span class="v">${esc(record.uan)}</span></div>` : ''}
    </div>
    <div>
      <div class="kv"><span class="k">Bank Account No</span><span class="v">${record.bank_account ? esc(record.bank_account) : '—'}</span></div>
      <div class="kv"><span class="k">Present Days</span><span class="v">${n(presentDays)}</span></div>
      <div class="kv"><span class="k">Paid Leave</span><span class="v">${n(record.paid_leave_days)}</span></div>
      <div class="kv"><span class="k">Holidays / Weekly Off</span><span class="v">${n(record.holiday_days)} / ${n(record.weekly_off_days)}</span></div>
    </div>
  </div>

  <table class="grid">
    ${head('Earnings')}
    <tbody>
      ${rows(earnings)}
      ${totalRow('Gross Earnings', grossTotal)}
    </tbody>
  </table>

  <table class="grid">
    ${head('Deductions')}
    <tbody>
      ${deductions.length ? rows(deductions)
        : `<tr><td class="lbl" colspan="${hasYtd ? 3 : 2}" style="color:#888">No deductions this month.</td></tr>`}
      ${totalRow('Total Deductions', dedTotal)}
    </tbody>
  </table>

  <div class="net">
    <div>
      <div class="lab">Total Net Payable</div>
      <div class="words">${esc(amountInWords(net))}</div>
    </div>
    <div class="val">₹${money(net)}</div>
  </div>
  <div class="formula">**Total Net Payable = Gross Earnings − Total Deductions</div>

  ${employerBlock}

  <div class="foot">
    <div class="note">${esc(footer)}</div>
    <div class="meta">${esc(company)} &middot; Payslip ${esc(payslip.payslip_number)}</div>
  </div>
</div>`;
}
