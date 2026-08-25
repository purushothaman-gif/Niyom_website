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
import { buildPayslipHtml, financialYearStart, type PayslipData } from './payslipTemplate';

// Re-exported so existing importers of this module keep working; the document
// itself now lives in ./payslipTemplate, which has no database dependency.
export { buildPayslipHtml };
export type { PayslipData };


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

  return {
    payslip,
    record,
    lines: lines ?? [],
    settings: settings ?? null,
    ytd: await loadYearToDate(record.employee_id, payslip.period_year, payslip.period_month),
  };
}

/**
 * Year-to-date per component, for the Indian financial year up to and including
 * this month.
 *
 * DERIVED, never stored. Writing a YTD onto each payroll line at calculation
 * time would be faster to read and would start drifting the first time a run
 * was reopened and recalculated -- the earlier months' stored totals would
 * still describe figures that no longer exist. Summing the runs on demand
 * cannot go stale.
 *
 * Only APPROVED runs count. A draft month is not pay that has happened, and
 * including it would show an employee a year-to-date figure that could still
 * change.
 *
 * Returns an empty object on failure rather than throwing: a payslip whose YTD
 * column is missing is still a correct payslip, and refusing to produce one at
 * all because the history could not be read would be the worse outcome.
 */
async function loadYearToDate(
  employeeId: string, year: number, month: number,
): Promise<Record<string, number>> {
  try {
    const fy = financialYearStart(year, month);

    const { data: runs } = await supabase
      .from('hr_payroll_runs')
      .select('id, period_year, period_month, status')
      .in('status', ['approved', 'locked', 'paid']);

    // Filter in code: the window spans a year boundary, which is awkward and
    // error-prone to express as a SQL predicate on two integer columns.
    const inWindow = (runs ?? []).filter(r => {
      const k = r.period_year * 12 + r.period_month;
      return k >= fy.year * 12 + fy.month && k <= year * 12 + month;
    });
    if (inWindow.length === 0) return {};

    const { data: records } = await supabase
      .from('hr_payroll_employee_records')
      .select('id')
      .eq('employee_id', employeeId)
      .in('run_id', inWindow.map(r => r.id));
    if (!records || records.length === 0) return {};

    const { data: lines } = await supabase
      .from('hr_payroll_lines')
      .select('component_code, amount')
      .in('record_id', records.map(r => r.id));

    const totals: Record<string, number> = {};
    for (const l of lines ?? []) {
      totals[l.component_code] = (totals[l.component_code] ?? 0) + Number(l.amount);
    }
    // Guard against float drift accumulating across a year of additions.
    for (const k of Object.keys(totals)) totals[k] = Math.round(totals[k] * 100) / 100;
    return totals;
  } catch {
    return {};
  }
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
