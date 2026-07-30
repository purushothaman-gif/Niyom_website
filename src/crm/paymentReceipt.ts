import html2pdf from 'html2pdf.js';
import { NIYOM_COMPANY, amountInWords } from './dsaDebitNote';

// ---------------------------------------------------------------------------
// Payment Receipt PDF — strictly monochrome, mirroring the exact style used
// by the DSA Debit Note. Black ink on white, thin gray hairlines, one solid
// black table header, right-aligned totals block. No colour, no fills, no
// cards, no gradients.
//
// A Payment Receipt is an acknowledgement issued BY Niyom TO the client, so
// it carries only ONE signature block on the right ("For Niyom Wealth").
// There is no client signature block — that was correctly removed as part
// of the Phase 3 business change.
// ---------------------------------------------------------------------------

const NIYOM_LOGO = '/niyomlogo.png';
const NIYOM_SIGNATURE = '/Screenshot_2026-04-06_at_4.02.25_PM.png';

const ARN = 'ARN-362707';
const ARN_VALID_TILL = '11-JUN-2029';

// Monochrome style tokens — identical to dsaDebitNote.ts
const SERIF = "Georgia, 'Times New Roman', Times, serif";
const TIMES = "'Times New Roman', Times, serif";
const SANS  = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const INK   = '#111111';
const SUB   = '#444444';
const MUTE  = '#888888';
const HAIR  = '#DADADA';
const RULE  = '#111111';

const label = `font-family:${SANS};font-size:8px;letter-spacing:0.14em;text-transform:uppercase;color:${MUTE};`;

const MODE_LABEL: Record<string, string> = {
  imps: 'IMPS',
  neft: 'NEFT',
  rtgs: 'RTGS',
  upi: 'UPI',
  cheque: 'Cheque',
  cash: 'Cash',
  bank_transfer: 'Bank Transfer',
  online_gateway: 'Online Gateway',
  demand_draft: 'Demand Draft',
  internal_adjustment: 'Internal Adjustment',
};

const inr = (n: number) =>
  '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return '—';
  const dd = d instanceof Date ? d : new Date(d);
  return dd.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
};

// ---------------------------------------------------------------------------
// Input shape
// ---------------------------------------------------------------------------

export interface ReceiptDealContext {
  confirmation_number: string;
  snap_client_name:    string;
  snap_pan:            string;
  deal_date:           string;
  security_name:       string;
  isin:                string;
  quantity:            number;
  rate_per_unit:       number;
  settlement_amount:   number;
}

export interface ReceiptPaymentContext {
  payment_number:      string;
  receipt_number:      string;
  amount_inr:          number;
  payment_mode:        string;
  utr_number?:         string | null;
  cheque_number?:      string | null;
  cheque_bank?:        string | null;
  demand_draft_number?:   string | null;
  payment_date:        string;
  value_date?:         string | null;
  received_from_name?: string | null;
  received_from_bank?: string | null;
  remarks?:            string | null;
}

export interface ReceiptSummaryContext {
  total_paid_amount:   number;
  outstanding_amount:  number;
  // Mirrors nw_deal_payment_summary.payment_status. 'over_paid' is a real value
  // the view returns; without it here the receipt printed "undefined" as the
  // status on any deal paid above its settlement amount.
  payment_status:      'not_paid' | 'partially_paid' | 'fully_paid' | 'over_paid';
}

export interface ReceiptRenderInput {
  deal:    ReceiptDealContext;
  payment: ReceiptPaymentContext;
  summary: ReceiptSummaryContext;
  generatedByName: string;
  generatedByRole: string;
  issuedAt: Date;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<ReceiptSummaryContext['payment_status'], string> = {
  not_paid:       'NOT PAID',
  partially_paid: 'PARTIALLY PAID',
  fully_paid:     'FULLY PAID',
  over_paid:      'OVER PAID',
};

function referenceCell(p: ReceiptPaymentContext): string {
  if (p.utr_number)            return `UTR: ${p.utr_number}`;
  if (p.cheque_number)         return `Cheque: ${p.cheque_number}${p.cheque_bank ? ` (${p.cheque_bank})` : ''}`;
  if (p.demand_draft_number)   return `DD: ${p.demand_draft_number}`;
  return '—';
}

function metaRow(lbl: string, val: string): string {
  return `<tr>
    <td style="${label}text-align:right;padding:3px 12px 3px 0;white-space:nowrap;">${lbl}</td>
    <td style="font-family:${SANS};font-size:10px;color:${INK};font-weight:600;text-align:right;padding:3px 0;white-space:nowrap;">${val}</td>
  </tr>`;
}

function kvRow(lbl: string, val: string): string {
  return `<tr>
    <td style="${label}padding:3px 14px 3px 0;white-space:nowrap;vertical-align:top;">${lbl}</td>
    <td style="font-family:${SANS};font-size:10px;color:${INK};font-weight:600;padding:3px 0;vertical-align:top;">${val || '—'}</td>
  </tr>`;
}

// ---------------------------------------------------------------------------
// HTML template — matches dsaDebitNote structure line-for-line
// ---------------------------------------------------------------------------

function buildHtml(input: ReceiptRenderInput): string {
  const { deal, payment, summary, generatedByName, generatedByRole, issuedAt } = input;
  const dateStr = fmtDate(issuedAt);
  const modeLabel = MODE_LABEL[payment.payment_mode] ?? payment.payment_mode;
  const excess = summary.outstanding_amount < 0 ? Math.abs(summary.outstanding_amount) : 0;

  return `
  <div style="width:794px;box-sizing:border-box;padding:44px 48px 36px;font-family:${SANS};color:${INK};background:#ffffff;">

    <!-- Header: logo + company (left) · title + doc meta (right) -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div style="max-width:58%;">
        <img src="${NIYOM_LOGO}" alt="Niyom Wealth" style="height:40px;width:auto;object-fit:contain;display:block;margin-bottom:12px;" />
        <div style="font-family:${SERIF};font-size:14px;font-weight:700;letter-spacing:0.04em;color:${INK};">${NIYOM_COMPANY.name}</div>
        <div style="font-size:9px;color:${SUB};line-height:1.5;margin-top:4px;">${NIYOM_COMPANY.address}</div>
        <div style="font-size:9px;color:${SUB};margin-top:3px;">Email: ${NIYOM_COMPANY.email}</div>
      </div>
      <div style="text-align:right;padding-top:4px;">
        <div style="font-family:${SERIF};font-size:30px;font-weight:700;letter-spacing:0.02em;color:${INK};line-height:1;">Payment Receipt</div>
        <table style="border-collapse:collapse;margin-left:auto;margin-top:14px;">
          ${metaRow('Receipt No.', payment.receipt_number)}
          ${metaRow('Payment No.', payment.payment_number)}
          ${metaRow('Issued On', dateStr)}
        </table>
      </div>
    </div>

    <div style="border-top:2px solid ${RULE};margin-top:20px;"></div>

    <!-- Received From + Against Deal -->
    <div style="display:flex;margin-top:18px;gap:32px;">
      <div style="flex:1;">
        <div style="${label}margin-bottom:6px;">Received From</div>
        <div style="font-family:${SERIF};font-size:13px;font-weight:700;color:${INK};">${deal.snap_client_name || '—'}</div>
        <div style="font-size:9.5px;color:${SUB};margin-top:2px;"><span style="color:${MUTE};">PAN:</span> ${deal.snap_pan || '—'}</div>
        ${payment.received_from_name && payment.received_from_name !== deal.snap_client_name
          ? `<div style="font-size:9.5px;color:${SUB};margin-top:2px;"><span style="color:${MUTE};">Paid by:</span> ${payment.received_from_name}${payment.received_from_bank ? ` · ${payment.received_from_bank}` : ''}</div>`
          : ''}
      </div>
      <div style="flex:1;">
        <div style="${label}margin-bottom:6px;">Against Deal Confirmation</div>
        <div style="font-family:${SERIF};font-size:13px;font-weight:700;color:${INK};">${deal.confirmation_number}</div>
        <div style="font-size:9.5px;color:${SUB};margin-top:2px;"><span style="color:${MUTE};">Deal Date:</span> ${fmtDate(deal.deal_date)}</div>
        <div style="font-size:9.5px;color:${SUB};margin-top:2px;"><span style="color:${MUTE};">Security:</span> ${deal.security_name}${deal.isin ? ` · ISIN ${deal.isin}` : ''}</div>
      </div>
    </div>

    <!-- Particulars table (single row, but same visual treatment as debit note) -->
    <table style="width:100%;border-collapse:collapse;margin-top:22px;">
      <thead>
        <tr style="background:${RULE};">
          <th style="padding:8px 10px;text-align:left;font-family:${SANS};font-size:8px;letter-spacing:0.1em;text-transform:uppercase;color:#ffffff;font-weight:600;">Payment Particulars</th>
          <th style="padding:8px 10px;text-align:left;font-family:${SANS};font-size:8px;letter-spacing:0.1em;text-transform:uppercase;color:#ffffff;font-weight:600;width:220px;">Reference</th>
          <th style="padding:8px 10px;text-align:right;font-family:${SANS};font-size:8px;letter-spacing:0.1em;text-transform:uppercase;color:#ffffff;font-weight:600;width:110px;">Payment Date</th>
          <th style="padding:8px 10px;text-align:right;font-family:${SANS};font-size:8px;letter-spacing:0.1em;text-transform:uppercase;color:#ffffff;font-weight:600;width:130px;">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style="padding:9px 10px;border-bottom:1px solid ${HAIR};vertical-align:top;">
            <div style="font-size:10.5px;color:${INK};font-weight:600;">${modeLabel}</div>
            <div style="font-size:8.5px;color:${MUTE};text-transform:uppercase;letter-spacing:0.06em;margin-top:2px;">Received via ${modeLabel}</div>
          </td>
          <td style="padding:9px 10px;border-bottom:1px solid ${HAIR};font-family:${TIMES};font-size:10px;color:${INK};vertical-align:top;">${referenceCell(payment)}</td>
          <td style="padding:9px 10px;border-bottom:1px solid ${HAIR};font-size:10px;color:${INK};text-align:right;vertical-align:top;">${fmtDate(payment.payment_date)}${payment.value_date ? `<div style="font-size:8.5px;color:${MUTE};margin-top:2px;">Value: ${fmtDate(payment.value_date)}</div>` : ''}</td>
          <td style="padding:9px 10px;border-bottom:1px solid ${HAIR};font-family:${TIMES};font-size:11px;color:${INK};text-align:right;vertical-align:top;font-variant-numeric:tabular-nums;">${inr(payment.amount_inr)}</td>
        </tr>
      </tbody>
    </table>

    <!-- Right-aligned totals block (mirrors the "Net Payable" panel of the debit note) -->
    <div style="display:flex;justify-content:flex-end;margin-top:28px;margin-bottom:30px;">
      <div style="width:400px;">
        <table style="border-collapse:collapse;width:100%;">
          <tr>
            <td style="font-family:${SANS};font-size:11px;color:${SUB};text-align:left;padding:9px 14px 9px 0;border-top:1px solid ${HAIR};">Deal Amount</td>
            <td style="font-family:${TIMES};font-size:14px;color:${INK};text-align:right;padding:9px 0 9px 14px;border-top:1px solid ${HAIR};font-variant-numeric:tabular-nums;">${inr(deal.settlement_amount)}</td>
          </tr>
          <tr>
            <td style="font-family:${SANS};font-size:11px;color:${SUB};text-align:left;padding:9px 14px 9px 0;">Total Paid to Date</td>
            <td style="font-family:${TIMES};font-size:14px;color:${INK};text-align:right;padding:9px 0 9px 14px;font-variant-numeric:tabular-nums;">${inr(summary.total_paid_amount)}</td>
          </tr>
          <tr>
            <td style="font-family:${SANS};font-size:11px;color:${SUB};text-align:left;padding:9px 14px 9px 0;border-bottom:1px solid ${HAIR};">Outstanding Balance</td>
            <td style="font-family:${TIMES};font-size:14px;color:${INK};text-align:right;padding:9px 0 9px 14px;border-bottom:1px solid ${HAIR};font-variant-numeric:tabular-nums;">${inr(Math.max(summary.outstanding_amount, 0))}</td>
          </tr>
          <tr>
            <td style="font-family:${TIMES};font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:#000000;font-weight:700;text-align:left;padding:16px 14px 16px 0;border-top:2px solid #000000;border-bottom:2px solid #000000;">Amount Received</td>
            <td style="font-family:${TIMES};font-size:23px;font-weight:700;color:#000000;text-align:right;padding:16px 0 16px 14px;border-top:2px solid #000000;border-bottom:2px solid #000000;font-variant-numeric:tabular-nums;">${inr(payment.amount_inr)}</td>
          </tr>
        </table>
        <div style="text-align:right;margin-top:14px;">
          <div style="${label}margin-bottom:4px;">Amount in Words</div>
          <div style="font-family:${SERIF};font-size:11px;font-style:italic;color:${INK};line-height:1.5;">${amountInWords(payment.amount_inr)}</div>
        </div>
        <div style="text-align:right;margin-top:12px;">
          <div style="${label}margin-bottom:4px;">Payment Status</div>
          <div style="font-family:${SANS};font-size:11px;font-weight:700;letter-spacing:0.1em;color:${INK};">${STATUS_LABEL[summary.payment_status] ?? STATUS_LABEL.not_paid}</div>
          ${excess > 0 ? `<div style="font-size:9px;color:${MUTE};margin-top:3px;">Excess on record: ${inr(excess)}</div>` : ''}
        </div>
      </div>
    </div>

    <!-- Payment To (left) + Remitting/Payer info (right) -->
    <div style="display:flex;margin-top:6px;">
      <div style="flex:1;padding-right:24px;">
        <div style="${label}margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid ${HAIR};">Credited To (Niyom Wealth)</div>
        <table style="border-collapse:collapse;width:100%;">
          ${kvRow('Beneficiary', NIYOM_COMPANY.name)}
        </table>
      </div>
      <div style="flex:1;padding-left:24px;border-left:1px solid ${HAIR};">
        <div style="${label}margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid ${HAIR};">Payer</div>
        <table style="border-collapse:collapse;width:100%;">
          ${kvRow('Name', payment.received_from_name || deal.snap_client_name || '')}
          ${payment.received_from_bank ? kvRow('Bank', payment.received_from_bank) : ''}
        </table>
      </div>
    </div>

    ${payment.remarks
      ? `<div style="margin-top:24px;font-size:9.5px;color:${SUB};line-height:1.5;">
          <span style="${label}">Remarks:&nbsp;</span>${payment.remarks}
        </div>`
      : ''}

    ${(payment.payment_mode === 'cheque' || payment.payment_mode === 'demand_draft')
      ? `<div style="margin-top:16px;font-size:9.5px;color:${SUB};font-style:italic;">
          This receipt is issued subject to realisation of the instrument by the collecting bank.
        </div>`
      : ''}

    <!-- Single signature block (right) — the client does NOT sign a receipt -->
    <div style="display:flex;justify-content:flex-end;margin-top:44px;">
      <div style="width:300px;text-align:center;">
        <img src="${NIYOM_SIGNATURE}" alt="Authorized Signature" style="height:96px;max-width:280px;width:auto;object-fit:contain;display:inline-block;filter:grayscale(1);" />
        <div style="border-top:1px solid ${RULE};margin-top:6px;padding-top:7px;">
          <div style="font-family:${SERIF};font-size:11px;font-weight:700;color:${INK};">S. Purushothaman</div>
          <div style="font-size:9px;color:${SUB};margin-top:2px;">Designated Partner</div>
          <div style="font-size:9px;color:${SUB};margin-top:1px;">For ${NIYOM_COMPANY.name}</div>
          <div style="${label}margin-top:6px;">Authorized Signatory</div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div style="margin-top:32px;border-top:1px solid ${HAIR};padding-top:9px;">
      <div style="display:flex;justify-content:space-between;font-size:7.5px;letter-spacing:0.04em;color:${MUTE};">
        <span>Generated by ${generatedByName} · ${generatedByRole}</span>
        <span>This is a system-generated payment receipt.</span>
      </div>
      <div style="font-size:7.5px;color:${MUTE};margin-top:5px;letter-spacing:0.04em;">
        ${NIYOM_COMPANY.name} · AMFI Registered Mutual Fund Distributor · ${ARN} (Valid till ${ARN_VALID_TILL})
      </div>
      <div style="font-size:7.5px;color:${MUTE};margin-top:3px;letter-spacing:0.04em;">
        Mutual fund investments are subject to market risks. Please read all scheme-related documents carefully before investing. Ref: ${payment.receipt_number}
      </div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------------------
// Wait for image assets to load before capture (mirrors dsaDebitNote helper)
// ---------------------------------------------------------------------------
async function waitForImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(imgs.map(img => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise<void>(resolve => {
      img.onload  = () => resolve();
      img.onerror = () => resolve();
    });
  }));
}

// ---------------------------------------------------------------------------
// Render → base64 (for upload) and → direct download
// ---------------------------------------------------------------------------

const PDF_OPTS = (filename: string) => ({
  margin: 0,
  filename,
  image: { type: 'png' as const, quality: 1 },
  html2canvas: { scale: 2, useCORS: true, logging: false, windowWidth: 794 },
  jsPDF: { unit: 'mm' as const, format: 'a4', orientation: 'portrait' as const },
  pagebreak: { mode: ['css', 'legacy'] as string[] },
});

export async function renderPaymentReceiptPdf(input: ReceiptRenderInput): Promise<string> {
  const wrap = document.createElement('div');
  wrap.style.position = 'fixed';
  wrap.style.left = '-10000px';
  wrap.style.top = '0';
  wrap.innerHTML = buildHtml(input);
  document.body.appendChild(wrap);
  try {
    await waitForImages(wrap);
    const dataUri: string = await html2pdf()
      .set(PDF_OPTS(`${input.payment.receipt_number}.pdf`))
      .from(wrap.firstElementChild as HTMLElement)
      .output('datauristring');
    return dataUri.split(',')[1];
  } finally {
    document.body.removeChild(wrap);
  }
}

export async function downloadPaymentReceiptPdf(input: ReceiptRenderInput): Promise<void> {
  const wrap = document.createElement('div');
  wrap.style.position = 'fixed';
  wrap.style.left = '-10000px';
  wrap.style.top = '0';
  wrap.innerHTML = buildHtml(input);
  document.body.appendChild(wrap);
  try {
    await waitForImages(wrap);
    await html2pdf()
      .set(PDF_OPTS(`${input.payment.receipt_number}.pdf`))
      .from(wrap.firstElementChild as HTMLElement)
      .save();
  } finally {
    document.body.removeChild(wrap);
  }
}
