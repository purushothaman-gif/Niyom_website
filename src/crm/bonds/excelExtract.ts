// Fallback extraction: pull the EXTRA columns (coupon, rating, maturity, IP dates,
// face value, redemption terms…) from the SMC-style sheet, normalized. These are
// used ONLY to fill fields that no external provider covers — never as the primary
// source. Returns a map of ISIN → normalized field bag.

type Row = (string | number)[];
const RATING_AGENCIES = ['CRISIL', 'ICRA', 'CARE', 'IND', 'ACUITE', 'ACQUITE', 'IVR', 'BWR', 'INFOMERICS', 'BRICKWORK'];

function norm(v: unknown): string { return String(v ?? '').replace(/\s+/g, ' ').trim(); }
function looksLikeISIN(v: string): boolean { return /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/i.test(v.trim()); }

function ratePercent(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace('%', '').trim());
  if (Number.isNaN(n)) return null;
  return n <= 1 ? +(n * 100).toFixed(4) : +n.toFixed(4);
}
function indianAmount(text: string | number | null | undefined): number | null {
  if (text == null || text === '') return null;
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  const s = String(text).toLowerCase().replace(/,/g, ' ').trim();
  const m = s.match(/(\d+(?:\.\d+)?)/); if (!m) return null;
  const n = parseFloat(m[1]); if (Number.isNaN(n)) return null;
  if (/\bcr\b|crore/.test(s)) return n * 1e7;
  if (/lac|lakh/.test(s)) return n * 1e5;
  return n;
}
// Minimum-investment quantum from the sheet's QUANTUM column. Handles "5 Lacs",
// "5,00,000", "500000", "1 Cr", and bare "5"/"10" (a small bare number is read as
// LACS, e.g. 5 → ₹5,00,000, since a sub-₹1000 minimum is never real for these bonds).
function lacsAmount(v: string | number | null | undefined): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') { if (!Number.isFinite(v) || v <= 0) return null; return v < 1000 ? Math.round(v * 1e5) : v; }
  const s = String(v).toLowerCase().trim();
  if (!s || s === 'na') return null;
  const m = s.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);   // strip Indian comma grouping, then read the number
  if (!m) return null;
  const n = parseFloat(m[1]); if (!Number.isFinite(n) || n <= 0) return null;
  if (/\bcr\b|crore/.test(s)) return Math.round(n * 1e7);
  if (/lac|lakh|\bl\b/.test(s)) return Math.round(n * 1e5);
  return n < 1000 ? Math.round(n * 1e5) : Math.round(n);     // bare number → lacs if small, else rupees
}
function excelSerialToISO(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
const MONTHS: Record<string, number> = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11 };
function leadingDateISO(text: string): string | null {
  const s = (text || '').trim();
  let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  m = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,4})[-/\s](\d{2,4})/);
  if (m) { const mo = MONTHS[m[2].toLowerCase()]; if (mo === undefined) return null; let y = parseInt(m[3],10); if (y<100) y+=2000; return `${y}-${String(mo+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
  return null;
}
function freq(ip: string): string {
  const s = (ip || '').toLowerCase();
  if (!s || s === 'na') return '';
  if (s.includes('every month') || s.includes('monthly')) return 'monthly';
  if (s.includes('quart') || s.includes('quater')) return 'quarterly';
  if (s.includes('semi') || s.includes('half')) return 'half_yearly';
  if (s.includes('annual') || s.includes('year')) return 'annual';
  const monthCount = (s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/g) ?? []).length;
  const tokenCount = s.split(/[,/\n]|\s{2,}/).map(t => t.trim()).filter(Boolean).length;
  const n = Math.max(monthCount, monthCount === 0 ? tokenCount : 0);
  if (n >= 12) return 'monthly'; if (n >= 3) return 'quarterly'; if (n === 2) return 'half_yearly'; if (n === 1) return 'annual';
  return '';
}
function redemptionEvents(text: string, maturityISO: string | null): { date: string; pct: number }[] {
  const t = (text || '').trim();
  const pctM = /(\d+(?:\.\d+)?)\s*%\s*(?:partial\s*)?redemption/i.exec(t) || /partial\s*redemption[^0-9]*(\d+(?:\.\d+)?)\s*%/i.exec(t);
  if (!pctM || !maturityISO) return [];
  const pct = parseFloat(pctM[1]); if (!(pct > 0 && pct < 100)) return [];
  const startM = /starting\s+from\s+([0-9]{1,2}[-/\s][A-Za-z0-9]{2,}[-/\s][0-9]{2,4})/i.exec(t);
  const startISO = startM ? leadingDateISO(startM[1]) : null; if (!startISO) return [];
  const step = /month/i.test(t) ? 1 : /quart|quater|qtr/i.test(t) ? 3 : /half|semi/i.test(t) ? 6 : 12;
  const maturity = new Date(maturityISO + 'T00:00:00Z');
  const events: { date: string; pct: number }[] = [];
  let cur = new Date(startISO + 'T00:00:00Z'); let cum = 0; let g = 0;
  while (cur <= maturity && cum < 100 - 0.01 && g < 400) {
    const p = Math.min(pct, 100 - cum);
    events.push({ date: cur.toISOString().slice(0, 10), pct: p });
    cum += p; cur = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + step, cur.getUTCDate())); g++;
  }
  return events;
}
function splitRating(raw: string): { rating: string; agency: string } {
  const text = norm(raw); if (!text) return { rating: '', agency: '' };
  const found = RATING_AGENCIES.filter(a => text.toUpperCase().includes(a));
  return { rating: text, agency: found.join(', ') };
}
function mapHeader(row: Row): Record<string, number> {
  const map: Record<string, number> = {};
  row.forEach((cell, i) => {
    const h = String(cell).toLowerCase(); if (!h.trim()) return;
    if (h.includes('coupon')) map.coupon = i;
    else if (h.includes('isin')) map.isin = i;
    else if (h.includes('name of security') || h === 'name') map.name = i;
    else if (h.includes('category')) map.secType = i;
    else if (h.includes('rating')) map.rating = i;
    else if (h.includes('maturity')) map.maturity = i;
    else if (h.includes('ip date') || h.includes('interest payment')) map.ipDates = i;
    else if (h.includes('face')) map.faceValue = i;
    else if (h.includes('quantum') || (h.includes('min') && h.includes('invest'))) map.quantum = i;
  });
  return map;
}

export interface ExcelExtra {
  coupon_rate?: number | null; coupon_type?: string; coupon_frequency?: string;
  interest_payment_dates?: string; maturity_date?: string | null; face_value?: number | null;
  min_investment?: number | null;
  rating?: string; rating_agency?: string; seniority?: string; security_type?: string;
  tax_status?: string; principal_repayment_structure?: string;
  redemption_schedule?: { date: string; pct: number }[];
}

// ISIN → normalized extra fields from the whole workbook.
export function extractExtras(wb: { SheetNames: string[]; Sheets: Record<string, unknown> }, XLSX: typeof import('xlsx')): Record<string, ExcelExtra> {
  const out: Record<string, ExcelExtra> = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name] as Parameters<typeof XLSX.utils.sheet_to_json>[0];
    if (!ws || !(ws as Record<string, unknown>)['!ref']) continue;
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', blankrows: false }) as Row[];
    let map: Record<string, number> | null = null;
    for (const row of rows) {
      const joined = row.map(c => String(c).toLowerCase()).join('|');
      if (joined.includes('isin') && (joined.includes('coupon') || joined.includes('name of security'))) { map = mapHeader(row); continue; }
      if (!map) continue;
      const get = (k: string): string | number => { const i = map![k]; return i === undefined ? '' : row[i]; };
      const isin = norm(get('isin')).toUpperCase();
      if (!looksLikeISIN(isin)) continue;
      const matCell = get('maturity');
      const maturityISO = typeof matCell === 'number' ? excelSerialToISO(matCell) : leadingDateISO(norm(matCell));
      const matText = typeof matCell === 'number' ? '' : norm(matCell);
      // IP-dates cell can be an Excel serial number, ISO, a DD-MM list, or free
      // text ("16TH OF EVERY MONTH"). Convert serials to ISO so a coupon day can
      // be derived; keep textual forms as-is (anchorDay handles them downstream).
      const ipCell = get('ipDates');
      const ipIsSerial = typeof ipCell === 'number';
      const ip = ipIsSerial ? (excelSerialToISO(ipCell) ?? '') : norm(ipCell);
      const { rating, agency } = splitRating(norm(get('rating')));
      const secType = norm(get('secType'));
      const reds = redemptionEvents(matText, maturityISO);
      out[isin] = {
        coupon_rate: ratePercent(get('coupon') as number),
        coupon_type: 'fixed',
        // A bare serial carries no recurrence info — leave frequency blank so the
        // website value fills it, rather than emitting a wrong "annual" guess.
        coupon_frequency: ipIsSerial ? '' : freq(ip),
        interest_payment_dates: ip === 'NA' ? '' : ip,
        maturity_date: maturityISO,
        face_value: indianAmount(norm(get('faceValue'))),
        min_investment: lacsAmount(get('quantum')),
        rating, rating_agency: agency,
        seniority: /senior/i.test(secType) ? 'SENIOR' : (/subord|sub debt|subdebt/i.test(secType) ? 'SUBORDINATED' : ''),
        security_type: secType,
        tax_status: /tax/i.test(secType) ? 'Taxable' : '',
        principal_repayment_structure: reds.length ? 'amortizing' : 'bullet',
        redemption_schedule: reds.length ? reds : undefined,
      };
    }
  }
  return out;
}
