import html2canvas from 'html2canvas';
import { NIYOM_BRAND } from './bonds/bondConstants';

// ---------------------------------------------------------------------------
// Employee-wise revenue card (PNG) — one image for the selected month, sized
// and styled to be dropped straight into a team group chat.
//
// It reports the SELECTED month only. The MIS screen already has a month/year
// picker, so a second "till date" column would just be a different question
// asked in the same picture; the month on the card is the month on the screen.
// ---------------------------------------------------------------------------

const LOGO = '/niyomlogo.png';

// The two Designated Partners are left off the card by design — it is a team
// progression sheet for the relationship managers, not a firm-wide P&L. Keyed
// by employee_code (stable and unique) with a first-name guard behind it, so a
// re-keyed code cannot quietly leak a partner's numbers into a group chat.
const EXCLUDED_EMPLOYEE_CODES = new Set(['NIYOM-001', 'NIYOM-002']);
const EXCLUDED_FIRST_NAMES    = new Set(['purushothaman', 'ramya']);

export function isExcludedFromTeamCard(e: { full_name?: string | null; employee_code?: string | null }): boolean {
  const code = String(e.employee_code ?? '').trim().toUpperCase();
  if (EXCLUDED_EMPLOYEE_CODES.has(code)) return true;
  const first = String(e.full_name ?? '').trim().toLowerCase().split(/\s+/)[0] ?? '';
  return EXCLUDED_FIRST_NAMES.has(first);
}

export interface TeamRevenueEntry {
  full_name: string;
  employee_code: string;
  designation: string | null;
  revenue: number;
  /** Number of revenue-earning entries behind the figure. */
  entries: number;
}

export interface TeamRevenueImageOptions {
  entries: TeamRevenueEntry[];
  monthLabel: string;   // e.g. "August 2026"
  periodLabel: string;  // e.g. "01 Aug 2026 – 31 Aug 2026"
  generatedBy: string;
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

const inr = (n: number): string =>
  (n < 0 ? '-' : '') + '₹' + Math.abs(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });

// Indian short form, because a group chat reads "₹6.8 L" faster than 680,200.
const inrShort = (n: number): string => {
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(2)} Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(2)} L`;
  return `${sign}₹${a.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
};

const initials = (name: string): string =>
  name.trim().split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase() || '?';

async function waitImages(root: HTMLElement): Promise<void> {
  await Promise.all(Array.from(root.querySelectorAll('img')).map(img =>
    (img.complete && img.naturalWidth > 0)
      ? Promise.resolve()
      : new Promise<void>(r => { img.onload = () => r(); img.onerror = () => r(); })));
}

function download(dataUrl: string, name: string): void {
  const a = document.createElement('a');
  a.href = dataUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Pure markup for the card — exported so the layout can be rendered and
 *  inspected without a browser download. */
export function buildTeamRevenueCardHtml(o: TeamRevenueImageOptions): string {
  const { darkBlue, gold, goldSoft, white } = NIYOM_BRAND;
  const list = [...o.entries].sort((a, b) => b.revenue - a.revenue);
  const total = list.reduce((s, e) => s + e.revenue, 0);
  // Bars are scaled to the top earner, so the picture shows the SPREAD of the
  // month rather than each person's share of a total nobody is chasing.
  const peak = Math.max(...list.map(e => Math.abs(e.revenue)), 1);

  const row = (e: TeamRevenueEntry, i: number): string => {
    const lead   = i === 0 && e.revenue > 0;
    const width  = Math.max((Math.abs(e.revenue) / peak) * 100, e.revenue > 0 ? 3 : 0);
    const barCol = e.revenue < 0
      ? 'linear-gradient(90deg,#B3261E,#E05B52)'
      : lead ? `linear-gradient(90deg,${gold},#F2DB99)`
             : 'linear-gradient(90deg,rgba(200,162,75,0.55),rgba(200,162,75,0.22))';
    const amtCol = e.revenue < 0 ? '#FF8A80' : lead ? '#F2DB99' : white;
    return `
    <div style="display:flex;align-items:center;gap:16px;padding:14px 26px;${lead ? `background:rgba(200,162,75,0.09);border-left:3px solid ${gold};` : 'border-left:3px solid transparent;'}">
      <div style="width:30px;flex-shrink:0;font-size:17px;font-weight:800;color:${lead ? gold : '#7f8ea8'};text-align:center;">${i + 1}</div>
      <div style="width:46px;height:46px;flex-shrink:0;border-radius:50%;background:${lead ? `linear-gradient(135deg,${gold},#F2DB99)` : 'rgba(255,255,255,0.08)'};border:1px solid ${lead ? gold : 'rgba(255,255,255,0.14)'};display:flex;align-items:center;justify-content:center;font-size:15px;font-weight:800;color:${lead ? '#12294d' : '#c8d4e8'};">${esc(initials(e.full_name))}</div>
      <div style="flex:1;min-width:0;">
        <div style="font-size:19px;font-weight:700;color:${white};line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(e.full_name)}</div>
        <div style="font-size:11.5px;color:#8fa0bd;margin-top:2px;">${esc(e.designation || 'Relationship Manager')} &nbsp;·&nbsp; ${esc(e.employee_code)}</div>
        <div style="margin-top:7px;height:7px;border-radius:4px;background:rgba(255,255,255,0.07);overflow:hidden;">
          <div style="height:7px;width:${width.toFixed(1)}%;border-radius:4px;background:${barCol};"></div>
        </div>
      </div>
      <div style="width:190px;flex-shrink:0;text-align:right;">
        <div style="font-size:24px;font-weight:800;color:${amtCol};line-height:1.15;">${inrShort(e.revenue)}</div>
        <div style="font-size:11px;color:#8fa0bd;margin-top:2px;">${e.entries === 0 && e.revenue === 0
          ? 'No revenue this month'
          : `${inr(e.revenue)}${e.entries ? ` · ${e.entries} ${e.entries === 1 ? 'entry' : 'entries'}` : ''}`}</div>
      </div>
    </div>`;
  };

  const rowsHtml = list.length
    ? list.map(row).join(`<div style="height:1px;background:rgba(255,255,255,0.06);margin:0 26px;"></div>`)
    : `<div style="padding:46px;text-align:center;color:#8fa0bd;font-size:16px;">No revenue recorded for this month.</div>`;

  return `<div style="width:900px;box-sizing:border-box;font-family:'Segoe UI',Helvetica,Arial,sans-serif;background:radial-gradient(120% 70% at 85% 0%,#183463 0%,${darkBlue} 48%,#050c18 100%);color:${white};padding:34px 0 0;">

    <!-- Header -->
    <div style="display:flex;align-items:flex-start;justify-content:space-between;padding:0 34px 22px;">
      <div style="display:flex;align-items:center;gap:13px;">
        <img src="${LOGO}" style="height:50px;width:auto;object-fit:contain;" />
        <div>
          <div style="font-size:21px;font-weight:800;letter-spacing:0.02em;">NIYOM WEALTH</div>
          <div style="font-size:10px;letter-spacing:0.2em;text-transform:uppercase;color:${goldSoft};margin-top:2px;">Team Revenue</div>
        </div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:27px;font-weight:800;color:${goldSoft};line-height:1.1;">${esc(o.monthLabel)}</div>
        <div style="font-size:11px;color:#8fa0bd;margin-top:4px;">${esc(o.periodLabel)}</div>
      </div>
    </div>

    <div style="height:2px;margin:0 34px;background:linear-gradient(90deg,${gold},rgba(200,162,75,0.18) 62%,transparent);border-radius:2px;"></div>

    <!-- Headline -->
    <div style="display:flex;align-items:center;justify-content:space-between;padding:20px 34px 18px;">
      <div>
        <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:${goldSoft};font-weight:700;">Total for the month</div>
        <div style="font-size:44px;font-weight:900;color:${white};line-height:1.1;margin-top:4px;">${inrShort(total)}</div>
        <div style="font-size:12px;color:#8fa0bd;margin-top:2px;">${inr(total)}</div>
      </div>
      <div style="text-align:right;">
        <div style="font-size:10px;letter-spacing:0.16em;text-transform:uppercase;color:${goldSoft};font-weight:700;">Team</div>
        <div style="font-size:44px;font-weight:900;color:${white};line-height:1.1;margin-top:4px;">${list.length}</div>
        <div style="font-size:12px;color:#8fa0bd;margin-top:2px;">relationship managers</div>
      </div>
    </div>

    <!-- Leaderboard -->
    <div style="margin:0 0 4px;background:rgba(255,255,255,0.03);border-top:1px solid rgba(200,162,75,0.22);border-bottom:1px solid rgba(200,162,75,0.22);padding:6px 0;">
      ${rowsHtml}
    </div>

    <!-- Footer -->
    <div style="padding:16px 34px 22px;display:flex;justify-content:space-between;align-items:center;gap:18px;">
      <div style="font-size:10.5px;color:#7f8ea8;line-height:1.55;max-width:520px;">
        Revenue is counted in the month the payment was received, not the month the deal was booked.<br/>
        <span style="color:${goldSoft};">Internal — for team discussion only.</span> Not for circulation outside Niyom Wealth.
      </div>
      <div style="font-size:10.5px;color:#7f8ea8;text-align:right;line-height:1.5;white-space:nowrap;">
        Generated by ${esc(o.generatedBy)}<br/>${esc(new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }))}
      </div>
    </div>
  </div>`;
}

/** Renders the card offscreen and triggers a PNG download. */
export async function generateTeamRevenueImage(o: TeamRevenueImageOptions): Promise<void> {
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:-10000px;top:0;';
  holder.innerHTML = buildTeamRevenueCardHtml(o);
  document.body.appendChild(holder);
  try {
    await waitImages(holder);
    const node = holder.firstElementChild as HTMLElement;
    const canvas = await html2canvas(node, {
      scale: 2, useCORS: true, backgroundColor: '#050c18', logging: false, windowWidth: 900,
    });
    const file = `Niyom_Team_Revenue_${o.monthLabel.replace(/\s+/g, '_')}.png`;
    download(canvas.toDataURL('image/png'), file);
  } finally {
    document.body.removeChild(holder);
  }
}
