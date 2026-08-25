// Bond analytics engine (Deno) — computes everything internally from the master.
// Coupon calendar (business-day adjusted) → cashflow schedule (reducing balance)
// → accrued, dirty price, current yield, YTM (XIRR), Macaulay/modified duration.
// Everything is per ₹100 face value; the UI scales by face × quantity.

export type Frequency = 'monthly' | 'quarterly' | 'half_yearly' | 'annual' | 'zero' | 'custom' | '';
export type DayCount = 'actual_actual' | 'actual_365' | '30_360' | '';
export type BizConv = 'following' | 'modified_following' | 'none' | '';

export interface RedemptionEvent { date: string; pct: number } // pct of ORIGINAL face

export interface AnalyticsInput {
  couponRate: number | null;
  frequency: Frequency;
  maturityISO: string | null;
  issueDateISO?: string | null;
  ipDatesSeed?: string;               // "2026-02-27,2026-05-27,..." or day-month pattern
  redemptionSchedule?: RedemptionEvent[];
  redemptionText?: string;            // fallback free text ("25% PARTIAL ... QUARTERLY")
  dayCount: DayCount;
  bizConv: BizConv;
  holidays: Set<string>;              // ISO holiday dates
  cleanPricePer100?: number | null;
  settlementISO?: string;
  // OPTIONAL coupon-entitlement inputs, used ONLY when the security actually carries
  // them. They are never derived from a generic number of days, and the record date is
  // NOT assumed to equal the ex-interest date. If none establish entitlement, accrued
  // stays on the existing cum-interest calculation (see the accrued block below).
  recordDateISO?: string | null;         // actual record date (register-closure) — informational
  exInterestDateISO?: string | null;     // actual ex-interest date — the real cum/ex cutoff
  couponEntitlementRule?: string | null; // explicit rule: 'ex_on_record_date' | 'always_cum' | ''
}

export interface CashflowRow { seq: number; date: string; interest_per_100: number; principal_per_100: number; total_per_100: number; remark: string }
export interface CouponRow { seq: number; period_start: string; period_end: string; scheduled_date: string; pay_date: string; coupon_per_100: number; outstanding_per_100: number }

export interface AnalyticsResult {
  ok: boolean; reason?: string;
  settlement_date: string;
  coupon_schedule: CouponRow[];
  cashflow_schedule: CashflowRow[];
  accrued_per_100: number;
  accrued_days: number;                                      // signed; negative only for a genuine ex-interest rebate
  accrual_convention: 'cum' | 'ex' | 'none';
  coupon_to_seller: 'seller' | 'buyer' | 'unknown';         // who receives the upcoming coupon
  next_coupon_for_accrual: string | null;                   // coupon the accrual is measured against
  record_date: string | null;                               // echoed from the security data
  ex_interest_date: string | null;                          // the resolved ex-date actually used (if any)
  clean_price: number | null;
  dirty_price: number | null;
  current_yield: number | null;
  ytm: number | null;
  macaulay_duration: number | null;
  modified_duration: number | null;
  days_to_maturity: number | null;
  years_to_maturity: number | null;
  total_future_interest_per_100: number;
  total_future_principal_per_100: number;
  assumed_bullet: boolean;
}

const SETTLEMENT_LAG_DAYS = 2;

function toDate(iso: string): Date { return new Date(iso + 'T00:00:00Z'); }
function toISO(d: Date): string { return d.toISOString().slice(0, 10); }
function addMonths(d: Date, m: number): Date { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + m, d.getUTCDate())); }
function addDays(d: Date, n: number): Date { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n)); }
function days(a: Date, b: Date): number { return Math.round((b.getTime() - a.getTime()) / 86400000); }

function freqMonths(f: Frequency): number {
  return f === 'monthly' ? 1 : f === 'quarterly' ? 3 : f === 'half_yearly' ? 6 : f === 'annual' ? 12 : 12;
}

function isWeekend(d: Date): boolean { const g = d.getUTCDay(); return g === 0 || g === 6; }

// Business-day adjustment against weekends + the holiday set.
function adjustBiz(d: Date, conv: BizConv, holidays: Set<string>): Date {
  if (conv === 'none' || conv === '') return d;
  let cur = new Date(d.getTime());
  let guard = 0;
  while ((isWeekend(cur) || holidays.has(toISO(cur))) && guard < 10) { cur = addDays(cur, 1); guard++; }
  if (conv === 'modified_following' && cur.getUTCMonth() !== d.getUTCMonth()) {
    // rolled into next month → go backward instead
    cur = new Date(d.getTime());
    guard = 0;
    while ((isWeekend(cur) || holidays.has(toISO(cur))) && guard < 10) { cur = addDays(cur, -1); guard++; }
  }
  return cur;
}

// Day-count fraction between two dates.
function dcf(a: Date, b: Date, conv: DayCount): number {
  const d = Math.max(0, days(a, b));
  if (conv === '30_360') {
    let d1 = a.getUTCDate(), d2 = b.getUTCDate();
    if (d1 === 31) d1 = 30;
    if (d2 === 31 && d1 === 30) d2 = 30;
    const n = (b.getUTCFullYear() - a.getUTCFullYear()) * 360 + (b.getUTCMonth() - a.getUTCMonth()) * 30 + (d2 - d1);
    return n / 360;
  }
  if (conv === 'actual_actual') {
    // simple ISDA-ish: actual days / 365 or 366 based on the period's year
    const yr = a.getUTCFullYear();
    const leap = (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0;
    return d / (leap ? 366 : 365);
  }
  return d / 365; // actual/365 (fixed) — default
}

// Anchor day-of-month from the IP-date seed (else the maturity day).
// The seed may be ISO ("2026-02-27,…"), DD-MM-YYYY, DD-Mon-YYYY or a bare
// day-month ("27-02"). Parse the first token properly so we take the actual
// day-of-month — never the leading two digits of an ISO year.
function anchorDay(seed: string | undefined, maturity: Date): number {
  const first = (seed ?? '').split(/[,;|]/)[0]?.trim();
  if (first) {
    const iso = parseLooseDate(first);            // handles ISO / DD-MM-YYYY / DD-Mon-YYYY
    if (iso) { const day = parseInt(iso.slice(8, 10), 10); if (day >= 1 && day <= 31) return day; }
    const m = first.match(/^(\d{1,2})\b/);        // bare "27-02" style → leading day
    if (m) { const day = parseInt(m[1], 10); if (day >= 1 && day <= 31) return day; }
  }
  return maturity.getUTCDate();
}

function parseRedemptionText(text: string | undefined, maturity: Date, settlement: Date): RedemptionEvent[] | null {
  const t = (text ?? '').trim();
  const pctM = /(\d+(?:\.\d+)?)\s*%\s*(?:partial\s*)?redemption/i.exec(t) || /partial\s*redemption[^0-9]*(\d+(?:\.\d+)?)\s*%/i.exec(t);
  if (!pctM) return null;
  const pct = parseFloat(pctM[1]);
  if (!(pct > 0 && pct < 100)) return null;
  const startM = /starting\s+from\s+([0-9]{1,2}[-/\s][A-Za-z0-9]{2,}[-/\s][0-9]{2,4})/i.exec(t);
  if (!startM) return null;
  const startISO = parseLooseDate(startM[1]);
  if (!startISO) return null;
  const step = /month/i.test(t) ? 1 : /quart|quater|qtr/i.test(t) ? 3 : /half|semi/i.test(t) ? 6 : 12;
  const events: RedemptionEvent[] = [];
  let cursor = toDate(startISO); let cum = 0; let guard = 0;
  while (cursor <= maturity && cum < 100 - 0.01 && guard < 400) {
    const p = Math.min(pct, 100 - cum);
    if (cursor > settlement) events.push({ date: toISO(cursor), pct: p });
    cum += p; cursor = addMonths(cursor, step); guard++;
  }
  return events.length ? events : null;
}

const MONTHS: Record<string, number> = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,sept:8,oct:9,nov:10,dec:11 };
function parseLooseDate(s: string): string | null {
  s = s.trim();
  let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  m = s.match(/^(\d{1,2})[-/\s]([A-Za-z]{3,4})[-/\s](\d{2,4})/);
  if (m) { const mo = MONTHS[m[2].toLowerCase()]; if (mo === undefined) return null; let y = parseInt(m[3],10); if (y<100) y+=2000; return `${y}-${String(mo+1).padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

function xirr(flows: { date: Date; amount: number }[], settlement: Date, dirty: number): number | null {
  if (!(dirty > 0)) return null;
  const pts = flows.map(f => ({ t: days(settlement, f.date) / 365, amt: f.amount })).filter(p => p.t > 0);
  if (!pts.length) return null;
  const npv = (y: number) => pts.reduce((s, p) => s + p.amt / Math.pow(1 + y, p.t), 0) - dirty;
  let lo = 1e-5, hi = 1, flo = npv(lo), fhi = npv(hi), tries = 0;
  while (flo * fhi > 0 && tries < 80) { hi *= 1.4; fhi = npv(hi); tries++; if (hi > 10) break; }
  if (flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2, fm = npv(mid); if (Math.abs(fm) < 1e-7) return mid; if (flo * fm < 0) { hi = mid; } else { lo = mid; flo = fm; } }
  return (lo + hi) / 2;
}

export function computeAnalytics(input: AnalyticsInput): AnalyticsResult {
  const coupon = input.couponRate ?? null;
  const settlement = input.settlementISO ? toDate(input.settlementISO) : addDays(new Date(), SETTLEMENT_LAG_DAYS);
  const settlementISO = toISO(settlement);
  const empty: AnalyticsResult = {
    ok: false, settlement_date: settlementISO, coupon_schedule: [], cashflow_schedule: [],
    accrued_per_100: 0, accrued_days: 0, accrual_convention: 'none', coupon_to_seller: 'unknown',
    next_coupon_for_accrual: null, record_date: input.recordDateISO ?? null, ex_interest_date: null,
    clean_price: input.cleanPricePer100 ?? null, dirty_price: null, current_yield: null,
    ytm: null, macaulay_duration: null, modified_duration: null, days_to_maturity: null, years_to_maturity: null,
    total_future_interest_per_100: 0, total_future_principal_per_100: 0, assumed_bullet: true,
  };
  if (!input.maturityISO) return { ...empty, reason: 'Maturity unknown' };
  const maturity = toDate(input.maturityISO);
  if (Number.isNaN(maturity.getTime())) return { ...empty, reason: 'Invalid maturity' };
  const dtm = days(settlement, maturity);
  if (dtm <= 0) return { ...empty, reason: 'Bond has matured' };
  const zero = input.frequency === 'zero' || coupon === null || coupon <= 0;

  // ---- coupon calendar (scheduled dates) ----
  const step = freqMonths(input.frequency || 'annual');
  const day = anchorDay(input.ipDatesSeed, maturity);
  const scheduled: Date[] = [];
  if (!zero) {
    let d = new Date(Date.UTC(maturity.getUTCFullYear(), maturity.getUTCMonth(), day));
    if (d > maturity) d = addMonths(d, -step);
    let guard = 0;
    while (d > settlement && guard < 1200) { scheduled.unshift(new Date(d.getTime())); d = addMonths(d, -step); guard++; }
    if (!scheduled.length || toISO(scheduled[scheduled.length - 1]) !== toISO(maturity)) scheduled.push(maturity);
  } else {
    scheduled.push(maturity);
  }
  const lastCoupon = zero ? (input.issueDateISO ? toDate(input.issueDateISO) : addMonths(scheduled[0], -12))
                          : addMonths(scheduled[0], -step);

  // ---- redemption plan ----
  let events = input.redemptionSchedule && input.redemptionSchedule.length ? input.redemptionSchedule
             : parseRedemptionText(input.redemptionText, maturity, settlement) ?? [];
  events = events.filter(e => { const d = toDate(e.date); return d > settlement && d <= maturity; });
  const assumed_bullet = events.length === 0;

  // Merge redemption dates onto the nearest scheduled coupon within half a period.
  const schedISO = scheduled.map(toISO);
  const schedSet = new Set(schedISO);
  const redMap: Record<string, number> = {};
  const extra: string[] = [];
  const half = (step * 30) / 2 + 5;
  for (const e of events) {
    const ed = toDate(e.date);
    let best = ''; let bestDiff = Infinity;
    for (const s of schedISO) { const diff = Math.abs(days(toDate(s), ed)); if (diff < bestDiff) { bestDiff = diff; best = s; } }
    const key = best && bestDiff <= half ? best : e.date;
    if (!schedSet.has(key)) extra.push(key);
    redMap[key] = (redMap[key] ?? 0) + e.pct;
  }
  const timeline = Array.from(new Set([...schedISO, ...extra])).sort();
  const maturityISO = toISO(maturity);

  // ---- walk timeline: interest on reducing balance (per 100) ----
  const cashflow: CashflowRow[] = [];
  const couponSched: CouponRow[] = [];
  let outstanding = 100;
  let prev = lastCoupon;
  let accum = 0;
  let seq = 0; let cseq = 0;
  let totInt = 0, totPrin = 0;
  for (let i = 0; i < timeline.length; i++) {
    const iso = timeline[i];
    const scheduledD = toDate(iso);
    const payD = adjustBiz(scheduledD, input.bizConv, input.holidays);
    const isMaturity = iso === maturityISO || i === timeline.length - 1;
    const isCoupon = schedSet.has(iso) || isMaturity;
    accum += outstanding * ((coupon ?? 0) / 100) * dcf(prev, scheduledD, input.dayCount);
    let interest = 0;
    if (isCoupon) { interest = +accum.toFixed(4); accum = 0; }
    let principal = (redMap[iso] ?? 0);        // pct of face
    if (isMaturity) principal = outstanding;   // remaining
    principal = +Math.min(principal, outstanding).toFixed(4);
    if (isCoupon && !zero) {
      couponSched.push({ seq: ++cseq, period_start: toISO(prev), period_end: iso, scheduled_date: iso, pay_date: toISO(payD), coupon_per_100: interest, outstanding_per_100: +outstanding.toFixed(4) });
    }
    const total = +(interest + principal).toFixed(4);
    let remark = '';
    if (isMaturity) remark = totPrin > 0 ? 'Final redemption' : 'Maturity redemption';
    else if (principal > 0) remark = 'Part redemption';
    cashflow.push({ seq: ++seq, date: toISO(payD), interest_per_100: interest, principal_per_100: principal, total_per_100: total, remark });
    totInt += interest; totPrin += principal;
    outstanding = +(outstanding - principal).toFixed(4);
    prev = scheduledD;
  }

  // ---- coupon entitlement, THEN accrued interest (cum / ex / unknown) ----
  // Step 1: decide who receives the upcoming coupon, using ONLY actual security data.
  // The ex-interest cutoff is taken from an explicit ex-interest date, or (only if the
  // security's own rule says so) from the record date. It is NEVER derived from a number
  // of days, and the record date is NOT assumed to equal the ex-date. If nothing
  // establishes entitlement, we keep the existing cum-interest calculation and flag it
  // 'unknown' — the engine never guesses ex-interest (so it never invents a negative accrual).
  const nextCoupon = zero ? maturity : scheduled[0];
  const rule = (input.couponEntitlementRule ?? '').trim().toLowerCase();
  const inPeriod = (d: Date) => d > lastCoupon && d <= nextCoupon;   // the ex-date must belong to THIS coupon
  let exDate: Date | null = null;
  if (input.exInterestDateISO) {
    const d = toDate(input.exInterestDateISO);
    if (!Number.isNaN(d.getTime()) && inPeriod(d)) exDate = d;
  } else if (rule === 'ex_on_record_date' && input.recordDateISO) {
    const d = toDate(input.recordDateISO);   // the bond's own terms declare ex-date == record date
    if (!Number.isNaN(d.getTime()) && inPeriod(d)) exDate = d;
  }

  const cumInterest = () => +(100 * ((coupon ?? 0) / 100) * dcf(lastCoupon, settlement, input.dayCount)).toFixed(4);
  let accrued: number, accrued_days: number;
  let accrual_convention: 'cum' | 'ex' | 'none';
  let coupon_to_seller: 'seller' | 'buyer' | 'unknown';

  if (zero) {
    accrued = 0; accrued_days = 0; accrual_convention = 'none'; coupon_to_seller = 'unknown';
  } else if (exDate !== null && settlement >= exDate && settlement < nextCoupon) {
    // Genuinely ex-interest: the seller is the holder of record and keeps the coupon. The
    // buyer holds to the coupon date without receiving it → standard convention is a
    // NEGATIVE adjustment for the remaining interest (settlement → coupon date).
    accrued_days = -days(settlement, nextCoupon);
    accrued = +(100 * ((coupon ?? 0) / 100) * dcf(settlement, nextCoupon, input.dayCount) * -1).toFixed(4);
    accrual_convention = 'ex'; coupon_to_seller = 'seller';
  } else if (exDate !== null) {
    // Entitlement is known (an ex-date exists) and settlement is before it → cum-interest,
    // buyer becomes holder of record, seller is paid normal positive accrued.
    accrued_days = days(lastCoupon, settlement); accrued = cumInterest();
    accrual_convention = 'cum'; coupon_to_seller = 'buyer';
  } else if (rule === 'always_cum') {
    accrued_days = days(lastCoupon, settlement); accrued = cumInterest();
    accrual_convention = 'cum'; coupon_to_seller = 'buyer';
  } else {
    // No actual ex-interest date and no usable rule → entitlement cannot be established.
    // Preserve the EXISTING positive cum-interest calculation exactly; flag 'unknown'.
    accrued_days = days(lastCoupon, settlement); accrued = cumInterest();
    accrual_convention = 'cum'; coupon_to_seller = 'unknown';
  }
  const clean = input.cleanPricePer100 ?? null;
  const dirty = clean !== null ? +(clean + accrued).toFixed(4) : null;
  const current_yield = (clean && coupon) ? +((coupon / clean) * 100).toFixed(4) : null;

  let ytm: number | null = null, mac: number | null = null, mod: number | null = null;
  if (dirty !== null) {
    const flows = cashflow.map(r => ({ date: toDate(r.date), amount: r.total_per_100 }));
    const eay = xirr(flows, settlement, dirty);   // money-weighted effective annual yield
    if (eay !== null) {
      // Quote YTM in the market convention: nominal annual, compounded at the
      // coupon frequency (m payments/yr). This makes a bond priced at par read
      // YTM = coupon, matching Excel YIELD and Indian bond platforms. XIRR alone
      // returns the effective-annual rate, which overstates YTM on sub-annual bonds.
      const m = zero ? 1 : Math.max(1, Math.round(12 / step));
      const ytmNom = m > 1 ? m * (Math.pow(1 + eay, 1 / m) - 1) : eay;
      let pvw = 0, pv = 0;
      for (const f of flows) { const t = days(settlement, f.date) / 365; if (t <= 0) continue; const d = f.amount / Math.pow(1 + eay, t); pv += d; pvw += t * d; }
      if (pv > 0) { mac = +(pvw / pv).toFixed(4); mod = +(mac / (1 + ytmNom / m)).toFixed(4); }
      ytm = +(ytmNom * 100).toFixed(4);
    }
  }

  return {
    ok: true, settlement_date: settlementISO, coupon_schedule: couponSched, cashflow_schedule: cashflow,
    accrued_per_100: accrued, accrued_days, accrual_convention, coupon_to_seller,
    next_coupon_for_accrual: zero ? null : toISO(nextCoupon),
    record_date: input.recordDateISO ?? null,
    ex_interest_date: exDate ? toISO(exDate) : (input.exInterestDateISO ?? null),
    clean_price: clean, dirty_price: dirty, current_yield,
    ytm, macaulay_duration: mac, modified_duration: mod,
    days_to_maturity: dtm, years_to_maturity: +(dtm / 365).toFixed(3),
    total_future_interest_per_100: +totInt.toFixed(4), total_future_principal_per_100: +totPrin.toFixed(4),
    assumed_bullet,
  };
}
