/**
 * Branded report PDF — one Niyom-styled document for every portal report.
 *
 * The on-screen reports download as a single, consistent client-facing PDF: a
 * logo header, the investor's name and PAN, the report's own meta (financial
 * year, "as on" date…), an optional headline figure, a table, notes, and the
 * firm's legal footer. Built as HTML and rendered with html2pdf — the same
 * pipeline as the portfolio statement and the receipts — and dynamically
 * imported so it never weighs on the portal bundle.
 *
 * `buildReportHtml` is pure (exported for tests); `generateReportPdf` does the
 * DOM + html2pdf side only.
 */
import { NIYOM, NIYOM_BRAND } from '../../../crm/bonds/bondConstants';

/** AMFI registration, shown in the header as on every client-facing document. */
const ARN = 'ARN-362707';

export interface ReportPdfColumn {
  header: string;
  /** Right-align the column (amounts, units). */
  right?: boolean;
}

export interface ReportPdfDoc {
  /** e.g. "ELSS — Tax Investment Confirmation". */
  title: string;
  /** Short line under the title, e.g. "Section 80C". */
  subtitle?: string;
  client: { full_name: string; client_code?: string | null; pan?: string | null };
  /** Right-hand info pairs: Financial Year, Date, As on… */
  meta: { label: string; value: string }[];
  /** The headline figure, e.g. "Total amount invested in ELSS is ₹7,999.60". */
  summary?: string;
  columns: ReportPdfColumn[];
  /** Pre-formatted cells, one array per row, each the length of `columns`. */
  rows: string[][];
  /** Optional totals row, same length as `columns`. */
  totals?: string[];
  /** Footnotes under the table. */
  notes?: string[];
  fileName: string;
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

const maskPan = (p?: string | null) => (p && p.length >= 4 ? `XXXXXX${p.slice(-4)}` : '—');

const todayLong = () =>
  new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

/** The report document as HTML (exported for previews and tests). */
export function buildReportHtml(doc: ReportPdfDoc): string {
  const { darkBlue, navy, gold, white, line, mist } = NIYOM_BRAND;
  const { client, columns } = doc;

  const align = (c: ReportPdfColumn) => (c.right ? 'right' : 'left');

  const head = columns
    .map(
      (c) =>
        `<th style="padding:7px 9px;font-size:9px;text-transform:uppercase;letter-spacing:.4px;color:#cfd8ea;text-align:${align(
          c,
        )};font-weight:700;">${esc(c.header)}</th>`,
    )
    .join('');

  const body =
    doc.rows
      .map(
        (r, i) =>
          `<tr style="background:${i % 2 ? mist : '#fff'};page-break-inside:avoid;">${columns
            .map(
              (c, j) =>
                `<td style="padding:7px 9px;font-size:9.5px;border-bottom:1px solid ${line};color:#1a2436;text-align:${align(
                  c,
                )};vertical-align:top;">${esc(r[j] ?? '')}</td>`,
            )
            .join('')}</tr>`,
      )
      .join('') ||
    `<tr><td colspan="${columns.length}" style="padding:16px;text-align:center;font-size:10px;color:#8a97ad;">Nothing to show in this statement yet.</td></tr>`;

  const foot = doc.totals
    ? `<tr style="background:#fbf7ec;">${columns
        .map(
          (c, j) =>
            `<td style="padding:8px 9px;font-size:9.5px;font-weight:800;color:${navy};text-align:${align(
              c,
            )};border-top:2px solid ${gold};">${esc(doc.totals?.[j] ?? '')}</td>`,
        )
        .join('')}</tr>`
    : '';

  const metaRows = doc.meta
    .map(
      (m) =>
        `<div style="font-size:9.5px;color:#5a6b85;margin-top:2px;"><span style="color:#8a97ad;">${esc(
          m.label,
        )}</span> &nbsp;:&nbsp; <b style="color:${navy};">${esc(m.value)}</b></div>`,
    )
    .join('');

  const notes = (doc.notes ?? [])
    .map((n) => `<li style="display:list-item;list-style:disc outside;">${esc(n)}</li>`)
    .join('');

  return `
  <div style="width:800px;font-family:Inter,Arial,Helvetica,sans-serif;color:#1a2436;background:#fff;">
    <div style="background:linear-gradient(135deg,${darkBlue},${navy});color:${white};padding:18px 26px;display:flex;justify-content:space-between;align-items:center;">
      <div style="display:flex;align-items:center;gap:12px;">
        <img src="/niyomlogo.png" crossorigin="anonymous" style="height:46px;width:auto;background:#fff;border-radius:8px;padding:4px;" />
        <div>
          <div style="font-size:15px;font-weight:800;letter-spacing:.4px;">${esc(NIYOM.name)}</div>
          <div style="font-size:9px;color:${gold};margin-top:2px;">AMFI-registered Mutual Fund Distributor · ${ARN}</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:16px;font-weight:800;color:${gold};letter-spacing:.4px;">${esc(doc.title)}</div>
        ${doc.subtitle ? `<div style="font-size:9.5px;color:#cfd8ea;margin-top:3px;">${esc(doc.subtitle)}</div>` : ''}
      </div>
    </div>

    <div style="margin:16px 26px 0;padding:12px 14px;border:1px solid ${line};border-radius:8px;display:flex;justify-content:space-between;align-items:flex-start;background:#fbfbfd;">
      <div>
        <div style="font-size:8px;text-transform:uppercase;letter-spacing:.6px;color:#6b7a93;">Investor</div>
        <div style="font-size:14px;font-weight:800;color:${navy};margin-top:2px;">${esc(client.full_name)}</div>
        <div style="font-size:9px;color:#5a6b85;margin-top:2px;">${
          client.client_code ? `Client code ${esc(client.client_code)} · ` : ''
        }PAN ${maskPan(client.pan)}</div>
      </div>
      <div style="text-align:right;">${metaRows}</div>
    </div>

    ${
      doc.summary
        ? `<div style="margin:14px 26px 0;padding:11px 14px;border-radius:8px;background:#f3f7f4;border:1px solid #d7e6dd;font-size:11px;font-weight:700;color:${navy};">${esc(
            doc.summary,
          )}</div>`
        : ''
    }

    <div style="margin:14px 26px 0;">
      <table style="width:100%;border-collapse:collapse;border:1px solid ${line};border-radius:6px;overflow:hidden;">
        <thead><tr style="background:${navy};">${head}</tr></thead>
        <tbody>${body}${foot}</tbody>
      </table>
    </div>

    ${
      notes
        ? `<div style="margin:16px 26px 0;padding:11px 14px;border:1px solid ${line};border-radius:8px;background:#fbfbfd;page-break-inside:avoid;">
            <ul style="margin:0;padding-left:16px;font-size:8.5px;color:#5a6b85;line-height:1.6;list-style:disc outside;">${notes}</ul>
          </div>`
        : ''
    }

    <div style="margin:18px 26px 0;padding-top:10px;border-top:2px solid ${gold};font-size:8px;color:#6b7a93;line-height:1.6;">
      <div style="font-weight:800;color:${navy};font-size:9px;">${esc(NIYOM.name)}</div>
      <div>${esc(NIYOM.address)}</div>
      <div>${esc(NIYOM.web)} · ${esc(NIYOM.email)} · AMFI ARN ${ARN}</div>
      <div style="margin-top:4px;">Generated ${todayLong()} from your Niyom Wealth account. For information only — not a contract note. Refer to your CAS from CAMS / KFintech for the registrar's official record.</div>
    </div>
  </div>`;
}

/** Render a report document to a PDF and hand it to the browser to save. */
export async function generateReportPdf(doc: ReportPdfDoc): Promise<void> {
  const html = buildReportHtml(doc);
  const { default: html2pdf } = await import('html2pdf.js');
  const c = document.createElement('div');
  c.style.position = 'fixed';
  c.style.left = '-10000px';
  c.style.top = '0';
  c.innerHTML = html;
  document.body.appendChild(c);
  try {
    await Promise.all(
      Array.from(c.querySelectorAll('img')).map((img) =>
        img.complete && img.naturalWidth > 0
          ? Promise.resolve()
          : new Promise<void>((r) => {
              img.onload = () => r();
              img.onerror = () => r();
            }),
      ),
    );
    const opt = {
      margin: [8, 0, 10, 0] as [number, number, number, number],
      filename: doc.fileName,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false, windowWidth: 800 },
      jsPDF: { unit: 'mm' as const, format: 'a4', orientation: 'portrait' as const },
      pagebreak: { mode: ['css', 'legacy'] as string[], avoid: ['tr'] },
    };
    await html2pdf().set(opt).from(c.firstElementChild as HTMLElement).save();
  } finally {
    document.body.removeChild(c);
  }
}
