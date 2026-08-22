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
import { buildPayslipHtml, type PayslipData } from './payslipTemplate';

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

  return { payslip, record, lines: lines ?? [], settings: settings ?? null };
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
