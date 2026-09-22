// Downloadable bond price list (PDF) for staff. Renders the current list with each
// bond's price marked up by a margin the user picks at download time, Niyom-branded.
// Prices per ₹100 face; base cost is never shown. Dynamically imported so html2pdf
// stays out of the main CRM bundle.

import html2pdf from 'html2pdf.js';
import { NIYOM_BRAND, NIYOM } from './bondConstants';
import { BondPublic } from './bondTypes';

const LOGO = '/niyomlogo.png';

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
function pct(v: number | null | undefined): string { return v === null || v === undefined ? '—' : `${Number(v).toFixed(2)}%`; }
function money2(v: number | null | undefined): string { return v === null || v === undefined ? '—' : `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function inrShort(v: number | null | undefined): string {
  if (v === null || v === undefined) return '—';
  const a = Math.abs(v);
  if (a >= 1e7) return `₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `₹${(a / 1e5).toFixed(2)} L`;
  return `₹${a.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}
function fdate(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
function freq(f: string | null | undefined): string {
  const v = String(f ?? '').replace(/_/g, '-');
  return v ? v.charAt(0).toUpperCase() + v.slice(1) : '—';
}

/**
 * @param bonds     the bonds to list (already filtered/sorted as shown on screen)
 * @param marginPct margin % applied to latest_price → the printed price per ₹100
 */
export async function generateBondListPdf(bonds: BondPublic[], marginPct: number): Promise<void> {
  const { darkBlue, navy, gold, goldSoft, white, ink, mist, line } = NIYOM_BRAND;
  const m = Number.isFinite(marginPct) ? marginPct : 0;
  const today = fdate(new Date().toISOString());

  const rows = bonds.map((b, i) => {
    const base = b.latest_price;
    const price = base === null || base === undefined ? null : Math.round(base * (1 + m / 100) * 100) / 100;
    const zebra = i % 2 === 1 ? mist : white;
    return `<tr style="background:${zebra};">
      <td style="padding:5px 7px;font-size:9px;border-bottom:1px solid ${line};color:#5a6b85;text-align:right;">${i + 1}</td>
      <td style="padding:5px 7px;font-size:9.5px;border-bottom:1px solid ${line};color:${ink};font-weight:600;">${esc(b.bond_name || b.issuer_name || '—')}</td>
      <td style="padding:5px 7px;font-size:9px;border-bottom:1px solid ${line};color:#5a6b85;font-family:monospace;">${esc(b.isin || '—')}</td>
      <td style="padding:5px 7px;font-size:9.5px;border-bottom:1px solid ${line};color:${ink};text-align:right;">${pct(b.coupon_rate)}</td>
      <td style="padding:5px 7px;font-size:9px;border-bottom:1px solid ${line};color:#5a6b85;">${freq(b.coupon_frequency)}</td>
      <td style="padding:5px 7px;font-size:9px;border-bottom:1px solid ${line};color:${ink};">${fdate(b.maturity_date)}</td>
      <td style="padding:5px 7px;font-size:9px;border-bottom:1px solid ${line};color:${ink};">${esc(b.rating || '—')}</td>
      <td style="padding:5px 7px;font-size:9px;border-bottom:1px solid ${line};color:#5a6b85;">${esc(b.security_type || '—')}</td>
      <td style="padding:5px 7px;font-size:9px;border-bottom:1px solid ${line};color:${ink};text-align:right;">${inrShort(b.min_investment ?? b.face_value)}</td>
      <td style="padding:5px 7px;font-size:10px;border-bottom:1px solid ${line};color:${navy};font-weight:800;text-align:right;">${money2(price)}</td>
    </tr>`;
  }).join('');

  const th = (label: string, align = 'left') =>
    `<th style="padding:7px;font-size:9px;text-align:${align};color:${navy};border-bottom:2px solid ${gold};text-transform:uppercase;letter-spacing:0.04em;white-space:nowrap;">${label}</th>`;

  const html = `<div style="width:1040px;box-sizing:border-box;font-family:'Segoe UI',Helvetica,Arial,sans-serif;background:${white};color:${ink};">
    <div style="background:linear-gradient(135deg,${darkBlue},${navy});padding:18px 26px;color:${white};display:flex;justify-content:space-between;align-items:center;">
      <div style="display:flex;align-items:center;gap:12px;"><img src="${LOGO}" style="height:38px;width:auto;object-fit:contain;"/><div><div style="font-size:15px;font-weight:800;">NIYOM WEALTH</div><div style="font-size:8px;letter-spacing:0.16em;text-transform:uppercase;color:${goldSoft};">${NIYOM.tagline}</div></div></div>
      <div style="text-align:right;">
        <div style="font-size:14px;font-weight:800;color:${goldSoft};">BOND PRICE LIST</div>
        <div style="font-size:9px;color:#cfd8ea;margin-top:2px;">${bonds.length} bond${bonds.length === 1 ? '' : 's'} · ${today}${m ? ` · prices incl. ${m}% margin` : ''}</div>
      </div>
    </div>
    <div style="padding:14px 26px 6px;">
      <table style="width:100%;border-collapse:collapse;">
        <thead><tr style="background:${mist};">
          ${th('#', 'right')}${th('Bond')}${th('ISIN')}${th('Coupon', 'right')}${th('Payout')}${th('Maturity')}${th('Rating')}${th('Category')}${th('Min. Inv', 'right')}${th('Price / ₹100', 'right')}
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div style="margin:10px 26px 0;padding:9px 13px;background:#fbfbfd;border:1px solid ${line};border-radius:8px;">
      <div style="font-size:8px;color:#6b7688;line-height:1.5;text-align:justify;">
        <strong style="color:${navy};">Indicative:</strong> Prices are per ₹100 face value and include the applied margin${m ? ` (${m}%)` : ''}; they are indicative and subject to change without notice. Investments in bonds carry market, credit, interest-rate and liquidity risks including possible loss of principal. Ratings are assigned by third-party agencies and may be revised. ${NIYOM.name} acts as a distributor.
      </div>
    </div>
    <div style="margin-top:10px;background:linear-gradient(135deg,${darkBlue},${navy});color:${white};padding:12px 26px;display:flex;justify-content:space-between;align-items:flex-end;">
      <div style="font-size:8.5px;line-height:1.5;color:#cfd8ea;"><div style="font-weight:800;color:${white};font-size:10px;">${NIYOM.name}</div><div>${NIYOM.address}</div><div>${NIYOM.email} • ${NIYOM.web}</div></div>
      <div style="text-align:right;font-size:8px;color:${goldSoft};">Generated ${today}</div>
    </div>
  </div>`;

  const c = document.createElement('div');
  c.style.cssText = 'position:fixed;left:-10000px;top:0;';
  c.innerHTML = html;
  document.body.appendChild(c);
  try {
    await Promise.all(Array.from(c.querySelectorAll('img')).map(img =>
      (img.complete && img.naturalWidth > 0) ? Promise.resolve() : new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r(); })));
    const node = c.firstElementChild as HTMLElement;
    const stamp = new Date().toISOString().slice(0, 10);
    const opt = {
      margin: [6, 0, 6, 0] as [number, number, number, number],
      filename: `NIYOM_Bond_Price_List_${stamp}.pdf`,
      image: { type: 'jpeg' as const, quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false, windowWidth: 1040 },
      jsPDF: { unit: 'mm' as const, format: 'a4', orientation: 'landscape' as const },
      pagebreak: { mode: ['css', 'legacy'] as string[] },
    };
    await html2pdf().set(opt).from(node).save();
  } finally {
    document.body.removeChild(c);
  }
}
