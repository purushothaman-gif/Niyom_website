import html2pdf from 'html2pdf.js';
import { NWDSA } from './types';
import { PRODUCT_LABELS } from './utils';

// Company + bank constants (mirrors the deal confirmation document)
export const NIYOM_COMPANY = {
  name: 'NIYOM WEALTH DISTRIBUTION LLP',
  tagline: 'Wealth Distribution & Advisory',
  address: 'No 126, 1st Floor,  Poonamalle high road, Varalakshmi Nagar, Maduravoyal, Chennai – 600 095 India',
  email: 'support@niyomwealth.com',
};

// Niyom's own bank account (issuer of the debit note)
export const NIYOM_BANK = {
  bank: 'IDFC FIRST BANK',
  account: '89394331135',
  ifsc: 'IDFB0080131',
  branch: 'Anna Nagar West',
};

const NIYOM_LOGO = '/niyomlogo.png';
// Exact filename casing matters on case-sensitive (production) hosting.
const NIYOM_SIGNATURE = '/Screenshot_2026-04-06_at_4.02.25_PM.png';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export interface DebitNoteParticular {
  client_name: string;
  client_code: string;
  product_type: string;
  product_name: string;
  quantity: number;
  payout: number;
}

export interface DebitNoteInput {
  debitNoteNumber: string;
  date: Date;
  month: number; // 1-12
  year: number;
  dsa: NWDSA;
  particulars: DebitNoteParticular[];
  total: number;        // GROSS payout (before TDS)
  tdsAmount: number;    // fixed 2% TDS on the gross
  netPayable: number;   // gross − TDS
  generatedBy: string;
  /**
   * When present, rendered as the client (DSA) signature in the left-hand
   * signature block of the signed copy. Omitted for the generated (unsigned)
   * document, which shows a blank signature line.
   */
  clientSignatureDataUrl?: string;
  /** Date string shown under the client signature when signed. */
  signedDate?: string;
}

// Fixed TDS rate applied to every DSA payout.
export const TDS_RATE = 0.02; // 2%

export interface PayoutTds {
  gross: number;
  tds: number;
  net: number;
}

// Single source of truth for the TDS split. Rounds the TDS to paise so the
// stored amounts, the PDF, and the on-screen UI all agree to the last decimal.
export function computePayoutTds(gross: number): PayoutTds {
  const tds = Math.round(gross * TDS_RATE * 100) / 100;
  return { gross, tds, net: gross - tds };
}

/**
 * HTML-escape an interpolated value. Mirrors the helper in bonds/bondOutputs.ts.
 *
 * This template is not only turned into a PDF — PublicDebitNoteView renders it
 * with dangerouslySetInnerHTML on an UNAUTHENTICATED page, so a payload stored
 * in a DSA or client name (`<img src=x onerror=...>`) would execute in the
 * partner's browser at the moment they sign. Every value that originates in the
 * database goes through here.
 *
 * Single quotes are escaped too. No attribute in this template uses them today,
 * but that is a property of the current markup, not a guarantee about the next
 * edit to it.
 */
const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));

const inr = (n: number) =>
  '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---------- Amount in words (Indian numbering) ----------
export function amountInWords(amount: number): string {
  const num = Math.floor(Math.abs(amount));
  const paise = Math.round((Math.abs(amount) - num) * 100);

  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
    'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  const twoDigit = (n: number): string => {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? ' ' + ones[n % 10] : '');
  };

  const threeDigit = (n: number): string => {
    const h = Math.floor(n / 100);
    const rest = n % 100;
    let s = '';
    if (h) s += ones[h] + ' Hundred';
    if (rest) s += (h ? ' ' : '') + twoDigit(rest);
    return s;
  };

  if (num === 0) {
    return paise ? `${twoDigit(paise)} Paise Only` : 'Zero Only';
  }

  const crore = Math.floor(num / 10000000);
  const lakh = Math.floor((num % 10000000) / 100000);
  const thousand = Math.floor((num % 100000) / 1000);
  const hundred = num % 1000;

  const parts: string[] = [];
  if (crore) parts.push(twoDigit(crore) + ' Crore');
  if (lakh) parts.push(twoDigit(lakh) + ' Lakh');
  if (thousand) parts.push(twoDigit(thousand) + ' Thousand');
  if (hundred) parts.push(threeDigit(hundred));

  let words = parts.join(' ').trim();
  if (amount < 0) words = 'Minus ' + words;
  words = 'Rupees ' + words;
  if (paise) words += ` and ${twoDigit(paise)} Paise`;
  return words + ' Only';
}

// ---------- HTML template ----------
// Single-page A4 accounting-document layout inspired by a classic debit-note
// composition (logo + company top-left, document title + meta top-right,
// recipient block, ruled particulars table, totals, signatory). Strictly
// monochrome: black ink on white, thin gray hairlines, one solid black table
// header. No colour, fills, cards, gradients or shadows.
export function buildDebitNoteHtml(input: DebitNoteInput): string {
  const { debitNoteNumber, date, month, year, dsa, particulars, total, tdsAmount, netPayable, generatedBy, clientSignatureDataUrl, signedDate } = input;

  const dateStr = date.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
  const periodStr = `${MONTHS[month - 1]} ${year}`;

  // Monochrome style tokens
  const SERIF = "Georgia, 'Times New Roman', Times, serif";
  const TIMES = "'Times New Roman', Times, serif";
  const SANS = "'Helvetica Neue', Helvetica, Arial, sans-serif";
  const INK = '#111111';
  const SUB = '#444444';
  const MUTE = '#888888';
  const HAIR = '#DADADA';   // thin divider lines
  const RULE = '#111111';   // strong rules / black header

  const label = `font-family:${SANS};font-size:8px;letter-spacing:0.14em;text-transform:uppercase;color:${MUTE};`;

  // Particulars rows — compact, auditor-friendly
  const rowsHtml = particulars.map((p, i) => `
    <tr>
      <td style="padding:7px 10px;border-bottom:1px solid ${HAIR};font-size:9.5px;color:${SUB};text-align:center;vertical-align:top;">${i + 1}</td>
      <td style="padding:7px 10px;border-bottom:1px solid ${HAIR};vertical-align:top;">
        <span style="font-size:10px;color:${INK};font-weight:600;">${esc(p.client_name)}</span>
        <span style="font-size:8.5px;color:${MUTE};letter-spacing:0.04em;">&nbsp;&middot;&nbsp;${esc(p.client_code)}</span>
      </td>
      <td style="padding:7px 10px;border-bottom:1px solid ${HAIR};vertical-align:top;">
        <span style="font-size:10px;color:${INK};">${esc(p.product_name)}</span>
        <div style="font-size:8px;color:${MUTE};text-transform:uppercase;letter-spacing:0.06em;margin-top:1px;">${esc(PRODUCT_LABELS[p.product_type as keyof typeof PRODUCT_LABELS] || p.product_type)}</div>
      </td>
      <td style="padding:7px 10px;border-bottom:1px solid ${HAIR};font-size:10px;color:${INK};text-align:right;vertical-align:top;">${p.quantity.toLocaleString('en-IN')}</td>
      <td style="padding:7px 10px;border-bottom:1px solid ${HAIR};font-size:10px;color:${INK};text-align:right;vertical-align:top;font-variant-numeric:tabular-nums;">${inr(p.payout)}</td>
    </tr>`).join('');

  // These three escape their own arguments, so every call site is covered
  // without each one having to remember. Do not pass pre-escaped values in.
  const metaRow = (lbl: string, val: string) => `
    <tr>
      <td style="${label}text-align:right;padding:3px 12px 3px 0;white-space:nowrap;">${esc(lbl)}</td>
      <td style="font-family:${SANS};font-size:10px;color:${INK};font-weight:600;text-align:right;padding:3px 0;white-space:nowrap;">${esc(val)}</td>
    </tr>`;

  const dsaLine = (lbl: string, val: string) => `
    <div style="font-size:9.5px;color:${SUB};margin-top:2px;"><span style="color:${MUTE};">${esc(lbl)}:</span> ${esc(val)}</div>`;

  const bankRow = (lbl: string, val: string) => `
    <tr>
      <td style="${label}padding:3px 14px 3px 0;white-space:nowrap;vertical-align:top;">${esc(lbl)}</td>
      <td style="font-family:${SANS};font-size:10px;color:${INK};font-weight:600;padding:3px 0;vertical-align:top;">${val ? esc(val) : '—'}</td>
    </tr>`;

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
        <div style="font-family:${SERIF};font-size:30px;font-weight:700;letter-spacing:0.02em;color:${INK};line-height:1;">Debit Note</div>
        <table style="border-collapse:collapse;margin-left:auto;margin-top:14px;">
          ${metaRow('Debit Note No.', debitNoteNumber)}
          ${metaRow('Date', dateStr)}
          ${metaRow('Period', periodStr)}
        </table>
      </div>
    </div>

    <div style="border-top:2px solid ${RULE};margin-top:20px;"></div>

    <!-- DSA information block -->
    <div style="margin-top:18px;">
      <div style="${label}margin-bottom:6px;">Debit Note To</div>
      <div style="font-family:${SERIF};font-size:13px;font-weight:700;color:${INK};">${esc(dsa.full_name)}</div>
      ${dsaLine('DSA Code', dsa.dsa_code)}
      ${dsa.pan ? dsaLine('PAN', dsa.pan) : ''}
      ${dsa.mobile ? dsaLine('Mobile', dsa.mobile) : ''}
      ${dsa.email ? dsaLine('Email', dsa.email) : ''}
      ${dsa.address ? dsaLine('Address', dsa.address) : ''}
    </div>

    <!-- Particulars table -->
    <table style="width:100%;border-collapse:collapse;margin-top:22px;">
      <thead>
        <tr style="background:${RULE};">
          <th style="padding:8px 10px;text-align:center;font-family:${SANS};font-size:8px;letter-spacing:0.1em;text-transform:uppercase;color:#ffffff;width:30px;font-weight:600;">#</th>
          <th style="padding:8px 10px;text-align:left;font-family:${SANS};font-size:8px;letter-spacing:0.1em;text-transform:uppercase;color:#ffffff;font-weight:600;">Client</th>
          <th style="padding:8px 10px;text-align:left;font-family:${SANS};font-size:8px;letter-spacing:0.1em;text-transform:uppercase;color:#ffffff;font-weight:600;">Product</th>
          <th style="padding:8px 10px;text-align:right;font-family:${SANS};font-size:8px;letter-spacing:0.1em;text-transform:uppercase;color:#ffffff;width:74px;font-weight:600;">Quantity</th>
          <th style="padding:8px 10px;text-align:right;font-family:${SANS};font-size:8px;letter-spacing:0.1em;text-transform:uppercase;color:#ffffff;width:120px;font-weight:600;">Amount</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml || `<tr><td colspan="5" style="text-align:center;color:${MUTE};padding:18px;font-size:10px;">No entries for this period</td></tr>`}
      </tbody>
    </table>

    <!-- Gross / TDS / Net Payable + amount in words — right-aligned group, flush with the table -->
    <div style="display:flex;justify-content:flex-end;margin-top:28px;margin-bottom:30px;">
      <div style="width:400px;">
        <table style="border-collapse:collapse;width:100%;">
          <tr>
            <td style="font-family:${SANS};font-size:11px;color:${SUB};text-align:left;padding:9px 14px 9px 0;border-top:1px solid ${HAIR};">Gross Payout Amount</td>
            <td style="font-family:${TIMES};font-size:14px;color:${INK};text-align:right;padding:9px 0 9px 14px;border-top:1px solid ${HAIR};font-variant-numeric:tabular-nums;">${inr(total)}</td>
          </tr>
          <tr>
            <td style="font-family:${SANS};font-size:11px;color:${SUB};text-align:left;padding:9px 14px 9px 0;border-bottom:1px solid ${HAIR};">TDS @ 2%</td>
            <td style="font-family:${TIMES};font-size:14px;color:${INK};text-align:right;padding:9px 0 9px 14px;border-bottom:1px solid ${HAIR};font-variant-numeric:tabular-nums;">&minus;&nbsp;${inr(tdsAmount)}</td>
          </tr>
          <tr>
            <td style="font-family:${TIMES};font-size:13px;letter-spacing:0.06em;text-transform:uppercase;color:#000000;font-weight:700;text-align:left;padding:16px 14px 16px 0;border-top:2px solid #000000;border-bottom:2px solid #000000;">Net Payable Amount</td>
            <td style="font-family:${TIMES};font-size:23px;font-weight:700;color:#000000;text-align:right;padding:16px 0 16px 14px;border-top:2px solid #000000;border-bottom:2px solid #000000;font-variant-numeric:tabular-nums;">${inr(netPayable)}</td>
          </tr>
        </table>
        <div style="text-align:right;margin-top:14px;">
          <div style="${label}margin-bottom:4px;">Amount in Words</div>
          <div style="font-family:${SERIF};font-size:11px;font-style:italic;color:${INK};line-height:1.5;">${amountInWords(netPayable)}</div>
        </div>
      </div>
    </div>

    <!-- Payment To (left) + Remitting Bank (right) — balanced two columns -->
    <div style="display:flex;margin-top:30px;">
      <div style="flex:1;padding-right:24px;">
        <div style="${label}margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid ${HAIR};">Payment To</div>
        <table style="border-collapse:collapse;width:100%;">
          ${bankRow('Beneficiary', dsa.full_name)}
          ${bankRow('Bank Name', dsa.bank_name || '')}
          ${bankRow('A/C No.', dsa.bank_account || '')}
          ${bankRow('IFSC', dsa.bank_ifsc || '')}
        </table>
      </div>
      <div style="flex:1;padding-left:24px;border-left:1px solid ${HAIR};">
        <div style="${label}margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid ${HAIR};">Remitting Bank</div>
        <table style="border-collapse:collapse;width:100%;">
          ${bankRow('Bank Name', NIYOM_BANK.bank)}
          ${bankRow('A/C No.', NIYOM_BANK.account)}
          ${bankRow('IFSC', NIYOM_BANK.ifsc)}
          ${bankRow('Branch', NIYOM_BANK.branch)}
        </table>
      </div>
    </div>

    <!-- Two signature blocks: Client (DSA) on the left, Niyom on the right.
         The Designated Partner block on the right is unchanged from the
         original document. The left client block is blank on the generated
         copy and carries the DSA's e-signature on the signed copy. -->
    <div style="display:flex;justify-content:space-between;margin-top:44px;gap:32px;">
      <!-- Left: Client (DSA) signature -->
      <div style="width:300px;text-align:center;">
        <div style="height:96px;display:flex;align-items:flex-end;justify-content:center;">
          ${clientSignatureDataUrl
            ? `<img src="${esc(clientSignatureDataUrl)}" alt="Client Signature" style="height:80px;max-width:260px;width:auto;object-fit:contain;display:inline-block;" />`
            : ``}
        </div>
        <div style="border-top:1px solid ${RULE};margin-top:6px;padding-top:7px;">
          <div style="${label}">Client Signature</div>
          ${signedDate
            ? `<div style="font-size:9px;color:${SUB};margin-top:4px;">Date: ${esc(signedDate)}</div>`
            : `<div style="font-size:9px;color:${MUTE};margin-top:4px;">Date: ____________________</div>`}
        </div>
      </div>
      <!-- Right: For Niyom Wealth — existing Designated Partner signature -->
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
    <div style="margin-top:32px;border-top:1px solid ${HAIR};padding-top:9px;display:flex;justify-content:space-between;font-size:7.5px;letter-spacing:0.04em;color:${MUTE};">
      <span>Generated by ${esc(generatedBy)}</span>
      <span>This is a system-generated debit note.</span>
    </div>
  </div>`;
}

// ---------- PDF blob generation ----------
async function waitForImages(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'));
  await Promise.all(imgs.map(img => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise<void>(resolve => {
      img.onload = () => resolve();
      img.onerror = () => resolve(); // never block generation on a missing logo
    });
  }));
}

export async function generateDebitNotePdfBlob(input: DebitNoteInput): Promise<Blob> {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '0';
  container.innerHTML = buildDebitNoteHtml(input);
  document.body.appendChild(container);

  try {
    await waitForImages(container); // ensure the logo is loaded before capture
    const opt = {
      margin: 0,
      filename: `${input.debitNoteNumber}.pdf`,
      image: { type: 'png' as const, quality: 1 },
      html2canvas: { scale: 2, useCORS: true, logging: false, windowWidth: 794 },
      jsPDF: { unit: 'mm' as const, format: 'a4', orientation: 'portrait' as const },
      pagebreak: { mode: ['css', 'legacy'] as string[] },
    };
    const blob: Blob = await html2pdf().set(opt).from(container.firstElementChild as HTMLElement).outputPdf('blob');
    return blob;
  } finally {
    document.body.removeChild(container);
  }
}

// Generates the SIGNED debit note PDF and returns the bare base64 body (no
// data-URI prefix) for transmission to the sign-debit-note edge function.
// Uses JPEG@scale2 — mirroring the Deal Confirmation signed-PDF settings — so
// the transmitted payload stays well under the Edge Function limit. The crisp
// signature PNG is preserved separately (sent as its own field and stored).
export async function generateSignedDebitNotePdfBase64(input: DebitNoteInput): Promise<string> {
  const container = document.createElement('div');
  container.style.position = 'fixed';
  container.style.left = '-10000px';
  container.style.top = '0';
  container.innerHTML = buildDebitNoteHtml(input);
  document.body.appendChild(container);

  try {
    await waitForImages(container);
    const opt = {
      margin: 0,
      filename: `${input.debitNoteNumber}-signed.pdf`,
      image: { type: 'jpeg' as const, quality: 0.92 },
      html2canvas: { scale: 2, useCORS: true, logging: false, windowWidth: 794, letterRendering: true },
      jsPDF: { unit: 'mm' as const, format: 'a4', orientation: 'portrait' as const },
      pagebreak: { mode: ['css', 'legacy'] as string[] },
    };
    const dataUri: string = await html2pdf().set(opt).from(container.firstElementChild as HTMLElement).output('datauristring');
    return dataUri.split(',')[1];
  } finally {
    document.body.removeChild(container);
  }
}
