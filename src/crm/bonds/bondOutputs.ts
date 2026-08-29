// Client-facing outputs built on the VERIFIED master + internally-computed
// analytics: cashflow statement (PDF), marketing brochure (PNG), promo (PNG).
// Never renders landing cost / internal margin. All figures indicative.

import html2pdf from 'html2pdf.js';
import html2canvas from 'html2canvas';
import { NIYOM_BRAND, NIYOM, BOND_PDF_DISCLAIMER, EmployeeContact } from './bondConstants';
import { BondPublic, BondAnalytics, CashflowScheduleRow } from './bondTypes';

const LOGO = '/niyomlogo.png';
const TDS = 0.10;

export interface OutputOptions {
  contact?: EmployeeContact;
  quantity?: number;                 // whole units
  sellingPricePer100?: number | null; // marked-up client price
  /** Include the Niyom logo + wordmark in the header. Default true. Partners may
   *  turn it off to share a de-branded image with their own clients. */
  logo?: boolean;
  /** Label above the contact card. Default "Your Relationship Manager"; partners
   *  pass e.g. "Contact" since the contact is the partner, not an RM. */
  contactLabel?: string;
}

function esc(s: unknown): string { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string)); }
// Replace the Niyom name with a neutral term for the partner's de-branded image.
function debrand(s: string): string {
  return s
    .replace(/Niyom Wealth Distribution LLP/g, 'The distributor')
    .replace(/Niyom Wealth/g, 'The distributor')
    .replace(/\bNiyom\b/g, 'The distributor');
}
function safe(v: unknown): string { const s = String(v ?? '').trim(); return s && s.toUpperCase() !== 'NA' ? esc(s) : ''; }
function inr(v: number | null | undefined): string { return v === null || v === undefined ? '—' : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`; }
function inrShort(v: number | null | undefined): string { if (v === null || v === undefined) return '—'; const a = Math.abs(v); if (a >= 1e7) return `₹${(a / 1e7).toFixed(2)} Cr`; if (a >= 1e5) return `₹${(a / 1e5).toFixed(2)} L`; return `₹${a.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`; }
function pct(v: number | null | undefined): string { return v === null || v === undefined ? '—' : `${Number(v).toFixed(2)}%`; }
function fdate(d: string | null | undefined): string { if (!d) return '—'; const dt = new Date(d); return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }); }
function num2(v: number): string { return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

async function waitImages(root: HTMLElement) {
  await Promise.all(Array.from(root.querySelectorAll('img')).map(img => (img.complete && img.naturalWidth > 0) ? Promise.resolve() : new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r(); })));
}
async function offscreen<T>(html: string, fn: (node: HTMLElement) => Promise<T>): Promise<T> {
  const c = document.createElement('div');
  c.style.cssText = 'position:fixed;left:-10000px;top:0;';
  c.innerHTML = html;
  document.body.appendChild(c);
  try { await waitImages(c); return await fn(c.firstElementChild as HTMLElement); }
  finally { document.body.removeChild(c); }
}
function download(dataUrl: string, name: string) { const a = document.createElement('a'); a.href = dataUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
function fileBase(b: BondPublic): string { return `NIYOM_${(b.bond_name || b.issuer_name || b.isin).replace(/[^\w]+/g, '_').slice(0, 50)}`; }

function payout(b: BondPublic): string { return (b.coupon_frequency || '').replace('_', '-') || '—'; }
function contactBlock(contact: EmployeeContact | undefined, white: string, goldSoft: string, label = 'Your Relationship Manager'): string {
  if (!contact) return `<div style="text-align:right;font-size:8px;color:${goldSoft};"><div>Generated ${fdate(new Date().toISOString())}</div></div>`;
  return `<div style="text-align:right;font-size:9.5px;color:#e7eefb;line-height:1.5;">
    <div style="font-size:8px;letter-spacing:0.12em;text-transform:uppercase;color:${goldSoft};">${esc(label)}</div>
    <div style="font-weight:800;color:${white};font-size:11.5px;">${esc(contact.name)}</div>
    ${contact.designation ? `<div style="color:${goldSoft};">${esc(contact.designation)}</div>` : ''}
    ${contact.phone ? `<div>${esc(contact.phone)}</div>` : ''}
    ${contact.email ? `<div>${esc(contact.email)}</div>` : ''}
  </div>`;
}

// ---------------------------------------------------------------------------
// 1. Cashflow statement PDF — the exact schedule, scaled to the client's units.
// ---------------------------------------------------------------------------
export async function generateCashflowPdf(b: BondPublic, a: BondAnalytics | null, cashflow: CashflowScheduleRow[], opts: OutputOptions): Promise<void> {
  const { darkBlue, navy, gold, goldSoft, white, ink, mist, line } = NIYOM_BRAND;
  const face = b.face_value ?? 100000;
  const qty = opts.quantity && opts.quantity > 0 ? Math.floor(opts.quantity) : 1;
  const totalFace = face * qty;
  const scale = totalFace / 100;                        // per-100 → holding
  const price = opts.sellingPricePer100 ?? b.selling_price ?? b.latest_price ?? null;
  const principal = price !== null ? +(totalFace * (price / 100)).toFixed(2) : null;
  const accrued = a?.accrued_per_100 != null ? +(a.accrued_per_100 * scale).toFixed(2) : 0;
  const investment = principal !== null ? +(principal + accrued).toFixed(2) : null;

  const rows = cashflow.map(r => {
    const interest = +(r.interest_per_100 * scale).toFixed(2);
    const principalAmt = +(r.principal_per_100 * scale).toFixed(2);
    const total = +(interest + principalAmt).toFixed(2);
    const net = +(total - interest * TDS).toFixed(2);
    return `<tr>
      <td style="padding:6px 8px;font-size:10px;border-bottom:1px solid ${line};">${fdate(r.cf_date)}</td>
      <td style="padding:6px 8px;font-size:10px;text-align:right;border-bottom:1px solid ${line};">${principalAmt > 0 ? num2(principalAmt) : ''}</td>
      <td style="padding:6px 8px;font-size:10px;text-align:right;border-bottom:1px solid ${line};">${num2(interest)}</td>
      <td style="padding:6px 8px;font-size:10px;text-align:right;border-bottom:1px solid ${line};font-weight:600;">${num2(total)}</td>
      <td style="padding:6px 8px;font-size:10px;text-align:right;border-bottom:1px solid ${line};color:#0f6e56;font-weight:600;">${num2(net)}</td>
      <td style="padding:6px 8px;font-size:9px;border-bottom:1px solid ${line};color:#8a5a12;">${esc(r.remark)}</td>
    </tr>`;
  }).join('');
  const dr = (l: string, v: string) => v ? `<tr><td style="padding:5px 10px;font-size:10.5px;color:#5a6b85;border-bottom:1px solid ${line};">${l}</td><td style="padding:5px 10px;font-size:10.5px;color:${ink};font-weight:600;border-bottom:1px solid ${line};text-align:right;">${v}</td></tr>` : '';

  const html = `<div style="width:794px;box-sizing:border-box;font-family:'Segoe UI',Helvetica,Arial,sans-serif;background:${white};color:${ink};">
    <div style="background:linear-gradient(135deg,${darkBlue},${navy});padding:22px 34px;color:${white};display:flex;justify-content:space-between;align-items:center;">
      <div style="display:flex;align-items:center;gap:12px;"><img src="${LOGO}" style="height:40px;width:auto;object-fit:contain;"/><div><div style="font-size:15px;font-weight:800;">NIYOM WEALTH</div><div style="font-size:8.5px;letter-spacing:0.16em;text-transform:uppercase;color:${goldSoft};">${NIYOM.tagline}</div></div></div>
      <div style="text-align:right;"><div style="font-size:13px;font-weight:800;color:${goldSoft};">CASHFLOW STATEMENT</div><div style="font-size:9px;color:#cfd8ea;margin-top:2px;">ISIN: ${safe(b.isin)}</div></div>
    </div>
    <div style="padding:20px 34px 6px;display:flex;gap:22px;">
      <div style="flex:1;"><div style="font-size:11px;font-weight:800;color:${navy};text-transform:uppercase;letter-spacing:0.08em;border-bottom:2px solid ${gold};padding-bottom:5px;margin-bottom:4px;">Bond Details</div>
        <table style="width:100%;border-collapse:collapse;">
          ${dr('Issuer', safe(b.issuer_name))}${dr('ISIN', safe(b.isin))}${dr('Credit Rating', `${safe(b.rating)} ${safe(b.rating_agency)}`)}
          ${dr('Coupon', `${pct(b.coupon_rate)} (${safe(b.coupon_type) || 'Fixed'})`)}${dr('Payment Terms', payout(b))}
          ${dr('Face Value / Unit', inr(b.face_value))}${dr('Maturity', fdate(b.maturity_date))}
          ${dr('Security', safe(b.security_type))}${dr('Seniority', safe(b.seniority))}
        </table></div>
      <div style="flex:1;"><div style="font-size:11px;font-weight:800;color:${navy};text-transform:uppercase;letter-spacing:0.08em;border-bottom:2px solid ${gold};padding-bottom:5px;margin-bottom:4px;">Investment Details</div>
        <table style="width:100%;border-collapse:collapse;">
          ${dr('Units', `${qty.toLocaleString('en-IN')}`)}${dr('Settlement', fdate(a?.settlement_date))}
          ${dr('Price (per ₹100)', price !== null ? inr(price) : '—')}${dr('Principal', inr(principal))}${dr('Accrued Interest', inr(accrued))}
        </table>
        <div style="margin-top:8px;background:linear-gradient(135deg,${darkBlue},${navy});border-radius:10px;padding:12px 14px;display:flex;justify-content:space-between;align-items:center;">
          <span style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${goldSoft};font-weight:700;">Investment Amount</span><span style="font-size:18px;font-weight:900;color:${white};">${inr(investment)}</span></div>
        <div style="font-size:8.5px;color:#8592a8;margin-top:5px;">Investment Amount = Principal + Accrued Interest.</div>
      </div>
    </div>
    <div style="padding:14px 34px 6px;"><div style="font-size:11px;font-weight:800;color:${navy};text-transform:uppercase;letter-spacing:0.08em;border-bottom:2px solid ${gold};padding-bottom:5px;margin-bottom:8px;">Interest Receivable Schedule${a?.assumed_bullet ? '' : ' (with partial redemption)'}</div>
      <table style="width:100%;border-collapse:collapse;"><thead><tr style="background:${mist};">
        <th style="padding:7px 8px;font-size:9.5px;text-align:left;color:${navy};border-bottom:2px solid ${gold};">Date</th>
        <th style="padding:7px 8px;font-size:9.5px;text-align:right;color:${navy};border-bottom:2px solid ${gold};">Principal (₹)</th>
        <th style="padding:7px 8px;font-size:9.5px;text-align:right;color:${navy};border-bottom:2px solid ${gold};">Interest (₹)</th>
        <th style="padding:7px 8px;font-size:9.5px;text-align:right;color:${navy};border-bottom:2px solid ${gold};">Total (₹)</th>
        <th style="padding:7px 8px;font-size:9.5px;text-align:right;color:${navy};border-bottom:2px solid ${gold};">Net − ${Math.round(TDS * 100)}% TDS (₹)</th>
        <th style="padding:7px 8px;font-size:9.5px;text-align:left;color:${navy};border-bottom:2px solid ${gold};">Remarks</th>
      </tr></thead><tbody>${rows}</tbody></table></div>
    <div style="margin:12px 34px 0;padding:10px 14px;background:#fbfbfd;border:1px solid ${line};border-radius:8px;"><div style="font-size:8px;color:#6b7688;line-height:1.5;text-align:justify;"><strong style="color:${navy};">Indicative:</strong> ${BOND_PDF_DISCLAIMER}</div></div>
    <div style="margin-top:12px;background:linear-gradient(135deg,${darkBlue},${navy});color:${white};padding:14px 34px;display:flex;justify-content:space-between;align-items:flex-end;">
      <div style="font-size:9px;line-height:1.5;color:#cfd8ea;"><div style="font-weight:800;color:${white};font-size:10.5px;">${NIYOM.name}</div><div>${NIYOM.address}</div><div>${NIYOM.email}</div></div>
      ${contactBlock(opts.contact, white, goldSoft, opts.contactLabel)}
    </div>
  </div>`;

  await offscreen(html, async node => {
    const opt = { margin: [8, 0, 8, 0] as [number, number, number, number], filename: `${fileBase(b)}_cashflow.pdf`, image: { type: 'jpeg' as const, quality: 0.98 }, html2canvas: { scale: 2, useCORS: true, logging: false, windowWidth: 794 }, jsPDF: { unit: 'mm' as const, format: 'a4', orientation: 'portrait' as const }, pagebreak: { mode: ['css', 'legacy', 'avoid-all'] as string[] } };
    await html2pdf().set(opt).from(node).save();
  });
}

// ---------------------------------------------------------------------------
// 2. Marketing brochure (PNG) — investment highlights, no cost.
// ---------------------------------------------------------------------------
export async function generateMarketingImage(b: BondPublic, a: BondAnalytics | null, opts: OutputOptions): Promise<void> {
  const { darkBlue, navy, gold, goldSoft, white } = NIYOM_BRAND;
  const showLogo = opts.logo !== false;
  const coupon = b.coupon_rate !== null ? pct(b.coupon_rate) : '—';
  const ytm = a?.ytm != null ? pct(a.ytm) : pct(b.coupon_rate);
  const face = b.face_value ?? 100000;
  const qty = opts.quantity && opts.quantity > 0 ? Math.floor(opts.quantity) : 1;
  const price = opts.sellingPricePer100 ?? b.selling_price ?? b.latest_price ?? null;
  const perUnit = price !== null ? +(face * price / 100).toFixed(2) : null;
  const principal = perUnit !== null ? +(perUnit * qty).toFixed(2) : null;
  const accrued = a?.accrued_per_100 != null ? +(a.accrued_per_100 * face * qty / 100).toFixed(2) : 0;
  const invest = principal !== null ? +(principal + accrued).toFixed(2) : null;   // client pays principal + accrued
  const annual = b.coupon_rate ? +(face * qty * b.coupon_rate / 100).toFixed(2) : null;

  const minInv = b.min_investment ?? b.face_value;
  const chip = (l: string, v: string, i: number) => `<div style="flex:1;padding:0 18px;${i > 0 ? `border-left:1px solid rgba(200,162,75,0.22);` : ''}"><div style="font-size:9px;letter-spacing:0.14em;text-transform:uppercase;color:${goldSoft};font-weight:700;">${l}</div><div style="font-size:17px;font-weight:800;margin-top:5px;color:${white};line-height:1.1;">${v || '—'}</div></div>`;
  const cell = (l: string, v: string, sub: string, i: number) => `<div style="flex:1;padding:0 20px;${i > 0 ? `border-left:1px solid rgba(200,162,75,0.25);` : ''}"><div style="font-size:9.5px;letter-spacing:0.12em;text-transform:uppercase;color:${goldSoft};font-weight:700;">${l}</div><div style="font-size:23px;font-weight:900;margin-top:4px;color:${white};line-height:1.05;">${v}</div>${sub ? `<div style="font-size:9.5px;color:#aebbd4;margin-top:4px;">${sub}</div>` : ''}</div>`;
  const drow = (l: string, v: string) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,0.06);"><span style="font-size:11px;color:#8fa0bd;">${l}</span><span style="font-size:12px;color:#eaf0fa;font-weight:600;text-align:right;">${v || '—'}</span></div>`;
  const pill = (t: string) => `<span style="display:inline-flex;align-items:center;line-height:1;background:rgba(200,162,75,0.14);border:1px solid rgba(200,162,75,0.55);color:${goldSoft};font-size:9.5px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;padding:6px 13px;border-radius:999px;">${t}</span>`;

  const html = `<div style="width:794px;box-sizing:border-box;font-family:'Segoe UI',Helvetica,Arial,sans-serif;background:linear-gradient(160deg,${navy} 0%,${darkBlue} 55%,#071426 100%);color:#eaf0fa;overflow:hidden;border:1px solid rgba(200,162,75,0.25);">
    <div style="padding:30px 42px 22px;position:relative;overflow:hidden;">
      <div style="position:absolute;right:-70px;top:-70px;width:240px;height:240px;border-radius:50%;background:radial-gradient(circle,rgba(200,162,75,0.20),transparent 70%);"></div>
      <div style="display:flex;justify-content:space-between;align-items:center;position:relative;">
        ${showLogo ? `<div style="display:flex;align-items:center;gap:12px;"><img src="${LOGO}" style="height:46px;width:auto;object-fit:contain;"/><div><div style="font-size:17px;font-weight:800;color:${white};">NIYOM WEALTH</div><div style="font-size:9px;letter-spacing:0.2em;text-transform:uppercase;color:${goldSoft};">${NIYOM.tagline}</div></div></div>` : `<div></div>`}
        <div style="text-align:center;background:rgba(200,162,75,0.14);border:1px solid ${gold};border-radius:14px;padding:9px 18px;"><div style="font-size:8.5px;letter-spacing:0.14em;text-transform:uppercase;color:${goldSoft};font-weight:700;">Coupon</div><div style="font-size:27px;font-weight:900;color:${white};line-height:1;">${coupon}</div><div style="font-size:8.5px;color:${goldSoft};margin-top:2px;">${ytm} YTM</div></div>
      </div>
      <div style="margin-top:22px;position:relative;"><div style="width:46px;height:3px;background:${gold};border-radius:2px;"></div><h1 style="font-size:23px;font-weight:800;margin:12px 0 0;line-height:1.25;color:${white};">${safe(b.bond_name) || safe(b.issuer_name)}</h1>
        <div style="margin-top:11px;display:flex;gap:8px;flex-wrap:wrap;">${[safe(b.security_type), safe(b.seniority), safe(b.tax_status)].filter(Boolean).map(pill).join('')}</div></div>
    </div>
    <div style="background:rgba(0,0,0,0.22);padding:16px 42px;display:flex;align-items:stretch;border-top:1px solid rgba(200,162,75,0.22);border-bottom:1px solid rgba(200,162,75,0.22);">
      ${[['Face Value', inrShort(face)], ['Yield (YTM)', ytm], ['Maturity', fdate(b.maturity_date)], ['Rating', safe(b.rating) || '—'], ['Payout', payout(b)]].map(([l, v], i) => chip(l, v, i)).join('')}
    </div>
    <div style="padding:22px 42px 8px;"><div style="background:linear-gradient(135deg,rgba(200,162,75,0.10),rgba(200,162,75,0.03));border:1px solid ${gold};border-radius:16px;padding:20px 6px;">
      <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:${gold};font-weight:800;margin:0 0 14px 16px;">Investment Summary</div>
      <div style="display:flex;align-items:stretch;">
        ${cell('Total Investment', invest !== null ? inr(invest) : (price !== null ? `${inr(price)} /₹100` : 'On Request'), accrued > 0 ? `${qty} unit${qty === 1 ? '' : 's'} · incl. accrued ${inr(accrued)}` : `${qty} unit${qty === 1 ? '' : 's'} · Face ${inrShort(face * qty)}`, 0)}
        ${cell('Annual Income', annual !== null ? inr(annual) : '—', b.coupon_rate ? `at ${coupon} coupon` : '', 1)}
        ${cell('Yield to Maturity', ytm, b.maturity_date ? `matures ${fdate(b.maturity_date)}` : '', 2)}
      </div>
    </div></div>
    <div style="padding:8px 42px 4px;display:flex;gap:30px;">
      <div style="flex:1;"><div style="font-size:11px;font-weight:800;color:${goldSoft};text-transform:uppercase;letter-spacing:0.1em;border-bottom:2px solid rgba(200,162,75,0.4);padding-bottom:6px;margin-bottom:4px;">Bond Details</div>
        ${drow('Issuer', safe(b.issuer_name))}${drow('ISIN', safe(b.isin))}${drow('Security', safe(b.security_type))}${drow('Face Value', inr(b.face_value))}</div>
      <div style="flex:1;"><div style="font-size:11px;font-weight:800;color:${goldSoft};text-transform:uppercase;letter-spacing:0.1em;border-bottom:2px solid rgba(200,162,75,0.4);padding-bottom:6px;margin-bottom:4px;">Terms</div>
        ${drow('Seniority', safe(b.seniority))}${drow('Payout', payout(b))}${drow('Min. Investment', minInv ? inrShort(minInv) : '—')}${drow('Price / ₹100', price !== null ? inr(price) : '—')}</div>
    </div>
    <div style="margin:14px 42px 0;padding:11px 15px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:10px;"><div style="font-size:8.5px;color:#8fa0bd;line-height:1.55;text-align:justify;"><strong style="color:${goldSoft};">Important:</strong> ${showLogo ? BOND_PDF_DISCLAIMER : debrand(BOND_PDF_DISCLAIMER)}</div></div>
    <div style="margin-top:16px;background:rgba(0,0,0,0.28);padding:16px 42px;display:flex;justify-content:space-between;align-items:flex-end;gap:20px;border-top:1px solid rgba(200,162,75,0.22);">
      ${showLogo ? `<div style="font-size:9px;line-height:1.5;color:#9fb0cd;"><div style="font-weight:800;color:${white};font-size:11px;">${NIYOM.name}</div><div>${NIYOM.address}</div><div>${NIYOM.email} • ${NIYOM.web}</div></div>` : `<div></div>`}
      ${contactBlock(opts.contact, white, goldSoft, opts.contactLabel)}
    </div>
  </div>`;

  await offscreen(html, async node => {
    const canvas = await html2canvas(node, { scale: 2, useCORS: true, backgroundColor: darkBlue, logging: false, windowWidth: 794 });
    download(canvas.toDataURL('image/png'), `${showLogo ? fileBase(b) : fileBase(b).replace(/^NIYOM_/, '')}.png`);
  });
}

// ---------------------------------------------------------------------------
// 3. Promo image (PNG) — core facts, NO price.
// ---------------------------------------------------------------------------
export async function generatePromoImage(b: BondPublic, opts: OutputOptions): Promise<void> {
  const { darkBlue, navy, gold, goldSoft, white } = NIYOM_BRAND;
  const showLogo = opts.logo !== false;
  const coupon = b.coupon_rate !== null ? pct(b.coupon_rate) : '—';
  const tenure = b.maturity_date ? (() => { const y = (new Date(b.maturity_date).getTime() - Date.now()) / (365.25 * 864e5); return y >= 1 ? `${y.toFixed(1)} yrs` : `${Math.round(y * 12)} mo`; })() : '—';
  const minInv = b.min_investment ?? b.face_value;
  const contact = opts.contact;
  const pill = (t: string) => `<span style="display:inline-flex;align-items:center;justify-content:center;line-height:1;background:rgba(200,162,75,0.16);border:1px solid ${gold};color:${goldSoft};font-size:15px;font-weight:700;letter-spacing:0.02em;padding:10px 18px;border-radius:999px;">${t}</span>`;
  const stat = (l: string, v: string) => `<div style="text-align:center;flex:1;"><div style="font-size:12px;letter-spacing:0.1em;text-transform:uppercase;color:${goldSoft};font-weight:700;">${l}</div><div style="font-size:20px;font-weight:800;color:${white};margin-top:4px;">${v || '—'}</div></div>`;

  const html = `<div style="width:820px;height:1025px;box-sizing:border-box;position:relative;overflow:hidden;font-family:'Segoe UI',Helvetica,Arial,sans-serif;background:radial-gradient(120% 80% at 80% 0%,#183463 0%,${darkBlue} 45%,#050c18 100%);color:${white};padding:44px 46px;display:flex;flex-direction:column;">
    <div style="position:absolute;left:-120px;top:120px;width:520px;height:520px;border-radius:50%;background:radial-gradient(circle,rgba(200,162,75,0.16),transparent 65%);"></div>
    <div style="position:absolute;right:-140px;bottom:120px;width:460px;height:460px;border-radius:50%;background:radial-gradient(circle,rgba(200,162,75,0.10),transparent 65%);"></div>
    ${showLogo ? `<div style="display:flex;align-items:center;gap:12px;position:relative;"><img src="${LOGO}" style="height:52px;width:auto;object-fit:contain;"/><div><div style="font-size:22px;font-weight:800;">NIYOM WEALTH</div><div style="font-size:10px;letter-spacing:0.22em;text-transform:uppercase;color:${goldSoft};">${NIYOM.tagline}</div></div></div>` : ''}
    <div style="height:2px;margin-top:20px;position:relative;background:linear-gradient(90deg,${gold},rgba(200,162,75,0.15) 60%,transparent);border-radius:2px;"></div>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:center;text-align:center;position:relative;">
      <div style="font-size:20px;letter-spacing:0.28em;text-transform:uppercase;color:${goldSoft};font-weight:700;">Earn up to</div>
      <div style="font-size:128px;font-weight:900;line-height:1.1;margin-top:14px;padding-bottom:6px;color:#F2DB99;text-shadow:0 3px 18px rgba(200,162,75,0.35);">${coupon}</div>
      <div style="font-size:20px;letter-spacing:0.22em;text-transform:uppercase;color:#cfd8ea;font-weight:600;margin-top:34px;">per annum</div>
      <div style="font-size:30px;font-weight:800;line-height:1.2;margin-top:50px;">${safe(b.issuer_name) || safe(b.bond_name)}</div>
      <div style="margin-top:16px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">${[safe(b.security_type), safe(b.seniority), safe(b.tax_status)].filter(Boolean).map(pill).join('')}</div>
    </div>
    <div style="position:relative;display:flex;gap:14px;background:rgba(255,255,255,0.05);border:1px solid rgba(200,162,75,0.35);border-radius:18px;padding:24px 18px;">
      ${stat('Tenure', tenure)}<div style="width:1px;background:rgba(200,162,75,0.3);"></div>${stat('Payout', payout(b))}<div style="width:1px;background:rgba(200,162,75,0.3);"></div>${stat('Rating', safe(b.rating) || '—')}<div style="width:1px;background:rgba(200,162,75,0.3);"></div>${stat('Min. Invest', minInv ? inrShort(minInv) : '—')}</div>
    ${b.maturity_date ? `<div style="text-align:center;margin-top:16px;font-size:14px;color:#cfd8ea;position:relative;">Maturity: <strong style="color:${white};">${fdate(b.maturity_date)}</strong></div>` : ''}
    <div style="margin-top:26px;position:relative;"><div style="background:linear-gradient(135deg,${gold},#E9D8A0);border-radius:16px;padding:16px 22px;display:flex;justify-content:space-between;align-items:center;"><div><div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:${navy};font-weight:800;opacity:0.8;">To invest, contact</div><div style="font-size:20px;font-weight:900;color:${navy};margin-top:2px;">${contact ? esc(contact.name) : (showLogo ? 'Niyom Wealth' : 'Your advisor')}</div>${contact?.designation ? `<div style="font-size:12px;color:${navy};opacity:0.85;">${esc(contact.designation)}</div>` : ''}</div>
      <div style="text-align:right;color:${navy};font-weight:700;font-size:14px;line-height:1.5;">${contact?.phone ? `<div>Call ${esc(contact.phone)}</div>` : ''}<div style="font-size:12px;">${contact?.email ? esc(contact.email) : (showLogo ? NIYOM.email : '')}</div></div></div>
      <div style="text-align:center;font-size:10px;color:#8592a8;margin-top:12px;line-height:1.4;">Investments in bonds are subject to market, credit and interest-rate risks, including loss of principal. Rates indicative.${showLogo ? ' Niyom Wealth Distribution LLP acts as a distributor.' : ' The distributor facilitates this transaction.'}</div></div>
  </div>`;

  await offscreen(html, async node => {
    const canvas = await html2canvas(node, { scale: 2, useCORS: true, backgroundColor: '#050c18', logging: false, windowWidth: 820, windowHeight: 1025 });
    download(canvas.toDataURL('image/png'), `${showLogo ? fileBase(b) : fileBase(b).replace(/^NIYOM_/, '')}_promo.png`);
  });
}
