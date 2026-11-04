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
  // AUTHORITATIVE cash-flow schedule from a licensed provider (issuer-filed dates + record
  // dates). When present it REPLACES the calendar inferred from the IP-date text, and its
  // record dates decide coupon entitlement. Amounts are per ₹100 of ORIGINAL face.
  providerFlows?: ProviderFlow[] | null;
}

export interface ProviderFlow {
  date: string;                 // payment (transaction) date, ISO
  record_date: string | null;   // entitlement cutoff for this payment, ISO
  type: 'coupon' | 'principal' | 'other';
  amount_per_100: number;
  interest_days: number | null;
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
  // What the calendar was actually built from — shown in the CRM so a mismatch can be traced.
  last_coupon_date: string | null;
  coupons_per_year: number | null;
  day_count_used: DayCount;
  calendar_source: 'provider' | 'seed' | 'maturity' | 'none';
  frequency_assumed: boolean;   // no frequency stated and one IP date → annual was ASSUMED
  frequency_conflict: boolean;  // stated frequency disagreed with the listed IP dates (dates won)
  // Annual bond whose listed IP month is not its maturity month. Usually a real feature of
  // the bond, but it is also what a mis-keyed IP date looks like, and the two calendars give
  // very different accrued — verify against the issuer's cash-flow schedule.
  calendar_needs_check: boolean;
}

// Indian corporate bonds (NSE/BSE RFQ) and G-secs settle T+1 BUSINESS day. This used to
// be today + 2 CALENDAR days, which put every accrued figure 1-3 days ahead of the
// value date a dealer quotes (more over weekends).
const SETTLEMENT_LAG_BUSINESS_DAYS = 1;

function toDate(iso: string): Date { return new Date(iso + 'T00:00:00Z'); }
function toISO(d: Date): string { return d.toISOString().slice(0, 10); }
function daysInMonth(y: number, m: number): number { return new Date(Date.UTC(y, m + 1, 0)).getUTCDate(); }
// Month arithmetic CLAMPED to the target month's length. The old version let JS overflow
// (31 Jan + 1 month = 3 Mar), and because the calendar stepped month-by-month from the
// previous result, a 30th/31st coupon drifted to the 1st/2nd forever after the first
// February — the "next coupon 2026-12-02" seen on every 30th-of-month NCD.
function addMonths(d: Date, m: number): Date {
  const t = d.getUTCMonth() + m;
  const y = d.getUTCFullYear() + Math.floor(t / 12);
  const mo = ((t % 12) + 12) % 12;
  return new Date(Date.UTC(y, mo, Math.min(d.getUTCDate(), daysInMonth(y, mo))));
}
function addDays(d: Date, n: number): Date { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + n)); }
function days(a: Date, b: Date): number { return Math.round((b.getTime() - a.getTime()) / 86400000); }


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

function adjustPreceding(d: Date, holidays: Set<string>): Date {
  let cur = new Date(d.getTime()); let guard = 0;
  while ((isWeekend(cur) || holidays.has(toISO(cur))) && guard < 10) { cur = addDays(cur, -1); guard++; }
  return cur;
}

function isLeap(y: number): boolean { return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0; }

/** Number of days in a 30E/360 count between two dates (RBI convention for G-secs/SDLs). */
function days30E360(a: Date, b: Date): number {
  const d1 = Math.min(a.getUTCDate(), 30), d2 = Math.min(b.getUTCDate(), 30);
  return (b.getUTCFullYear() - a.getUTCFullYear()) * 360 + (b.getUTCMonth() - a.getUTCMonth()) * 30 + (d2 - d1);
}

/**
 * Day-count fraction from `a` to `b`, for an accrual period that ENDS on `periodEnd`.
 *
 * - '30_360'        → 30E/360. RBI's convention for Government securities and SDLs.
 * - 'actual_actual' → SEBI's convention for listed corporate debt (circulars of 13-Apr-2007
 *   and CIR/IMD/DF-1/122/2016): actual days over 365, or over 366 for EVERY period in an
 *   interest year that contains 29 February — "for a whole one year period, irrespective of
 *   whether the interest is payable annually, half yearly, quarterly or monthly". The
 *   interest year is anchored on the bond's maturity anniversary (for annual coupons, the
 *   coupon period itself). The old code instead
 *   asked whether the period's START year was a leap year, which is a different rule.
 * - 'actual_365'    → actual days / 365 fixed.
 */
function makeDcf(conv: DayCount, maturity: Date, perYear: number) {
  const leapYearCache = new Map<string, boolean>();
  // Does the anniversary-year (A-1y, A] that contains `end` include a 29 February?
  const interestYearHasFeb29 = (end: Date): boolean => {
    // Annual coupons: the interest year IS the coupon period ending on `end` (the coupon
    // date can differ from the maturity day — e.g. coupon 23-Jun, maturity 04-Jun).
    let a = perYear === 1 ? end : new Date(Date.UTC(end.getUTCFullYear(), maturity.getUTCMonth(),
      Math.min(maturity.getUTCDate(), daysInMonth(end.getUTCFullYear(), maturity.getUTCMonth()))));
    if (a < end) a = addMonths(a, 12);
    const key = toISO(a);
    const hit = leapYearCache.get(key);
    if (hit !== undefined) return hit;
    const start = addMonths(a, -12);
    let has = false;
    for (let y = start.getUTCFullYear(); y <= a.getUTCFullYear(); y++) {
      if (!isLeap(y)) continue;
      const f = new Date(Date.UTC(y, 1, 29));
      if (f > start && f <= a) { has = true; break; }
    }
    leapYearCache.set(key, has);
    return has;
  };
  return (a: Date, b: Date, periodEnd: Date): number => {
    if (b <= a) return 0;
    if (conv === '30_360') return days30E360(a, b) / 360;
    const d = days(a, b);
    if (conv === 'actual_actual') return d / (interestYearHasFeb29(periodEnd) ? 366 : 365);
    return d / 365;
  };
}

// ---------------------------------------------------------------------------
// Coupon calendar from the IP-date text.
//
// The old engine took ONLY the day-of-month from the seed and borrowed the MONTHS from
// the maturity date, stepping backwards. Any bond whose coupon months differ from its
// maturity month got the wrong coupon dates and therefore the wrong accrued — e.g. a
// quarterly "30-01, 30-04, 30-07, 30-10" NCD maturing 30-Jun was put on Mar/Jun/Sep/Dec.
// It also could not read ordinals ("01ST OF EVERY MONTH", "27TH OF EVERY MONTH") or
// "LAST DAY OF EVERY MONTH", and silently fell back to the maturity day for them.
// Now the seed's own (day, month) pairs define the calendar.
// ---------------------------------------------------------------------------
type DayRule = number | 'eom';
interface CouponPattern { pairs: { month: number; day: DayRule }[]; perYear: number; source: 'seed' | 'maturity'; frequencyAssumed: boolean; frequencyConflict: boolean }

const MON3: Record<string, number> = { JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11 };

/** Every (day, month) the IP-date text names, in order, one per month. */
export function parseSeedPairs(seed: string | undefined): { month: number; day: number }[] {
  let s = ` ${(seed ?? '').toUpperCase()} `;
  const out: { month: number; day: number }[] = [];
  const push = (d: number, m: number) => { if (d >= 1 && d <= 31 && m >= 0 && m <= 11) out.push({ month: m, day: d }); };
  // ISO yyyy-mm-dd
  s = s.replace(/(\d{4})-(\d{1,2})-(\d{1,2})/g, (_x, _y, m, d) => { push(+d, +m - 1); return ' '; });
  // dd Mon / dd-Mon / ddMon (optional year)
  s = s.replace(/(\d{1,2})\s*(?:ST|ND|RD|TH)?\s*[-/ ]?\s*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?(?:\s*[-/ ]\s*(?:\d{4}|\d{2}(?![\d\s]*[A-Z])))?/g,
    (_x, d, mon) => { push(+d, MON3[mon]); return ' '; });
  // Mon dd (e.g. "Jan 15")
  s = s.replace(/(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+(\d{1,2})(?!\d)/g,
    (_x, mon, d) => { push(+d, MON3[mon]); return ' '; });
  // dd-mm / dd/mm / dd.mm (optional year)
  s.replace(/(\d{1,2})\s*[-/.]\s*(\d{1,2})(?:\s*[-/.]\s*\d{2,4})?/g, (_x, d, m) => { push(+d, +m - 1); return ' '; });
  const seen = new Set<number>();
  return out.filter((p) => (seen.has(p.month) ? false : (seen.add(p.month), true)));
}

/** "01ST OF EVERY MONTH" → 1, "LAST DAY OF EVERY MONTH" → 'eom', else null. */
export function parseMonthlyRule(seed: string | undefined): DayRule | null {
  const s = (seed ?? '').toUpperCase();
  if (!/(EVERY|EACH)\s+MONTH|MONTHLY/.test(s)) return null;
  if (/LAST\s+(WORKING\s+|BUSINESS\s+)?DAY|MONTH[\s-]*END|END\s+OF/.test(s)) return 'eom';
  const m = s.match(/(\d{1,2})\s*(ST|ND|RD|TH)?\b/) ?? s.match(/(\d{1,2})(ST|ND|RD|TH)/);
  if (m) { const d = parseInt(m[1], 10); if (d >= 1 && d <= 31) return d; }
  return null;
}

function perYearOf(f: Frequency): number | null {
  return f === 'monthly' ? 12 : f === 'quarterly' ? 4 : f === 'half_yearly' ? 2 : f === 'annual' ? 1 : null;
}

export function buildCouponPattern(seed: string | undefined, freq: Frequency, maturity: Date): CouponPattern {
  const declared = perYearOf(freq);
  const monthly = parseMonthlyRule(seed);
  if (monthly !== null) {
    return { pairs: Array.from({ length: 12 }, (_v, m) => ({ month: m, day: monthly })), perYear: 12, source: 'seed', frequencyAssumed: false, frequencyConflict: declared !== null && declared !== 12 };
  }
  let pairs: { month: number; day: DayRule }[] = parseSeedPairs(seed);
  let source: 'seed' | 'maturity' = 'seed';
  if (!pairs.length) { pairs = [{ month: maturity.getUTCMonth(), day: maturity.getUTCDate() }]; source = 'maturity'; }
  const n = pairs.length;
  const seedPerYear = n >= 12 ? 12 : n >= 4 ? 4 : n >= 2 ? 2 : 1;
  let perYear: number; let frequencyAssumed = false; let frequencyConflict = false;
  if (declared === null) {
    perYear = seedPerYear;
    frequencyAssumed = n === 1;            // a single date with no stated frequency → annual is a guess
  } else if (n > 1 && seedPerYear !== declared) {
    perYear = seedPerYear;                 // the listed dates are more specific than the label
    frequencyConflict = true;
  } else {
    perYear = declared;
  }
  if (pairs.length < perYear) {
    // Expand one listed date to the full calendar by stepping 12/perYear months.
    const base = pairs[0]; const stepM = 12 / perYear;
    pairs = Array.from({ length: perYear }, (_v, k) => ({ month: (base.month + k * stepM) % 12, day: base.day }));
  } else if (pairs.length > perYear) {
    pairs = pairs.slice(0, perYear);
  }
  return { pairs, perYear, source, frequencyAssumed, frequencyConflict };
}

function dateFor(y: number, m: number, day: DayRule): Date {
  const dim = daysInMonth(y, m);
  return new Date(Date.UTC(y, m, day === 'eom' ? dim : Math.min(day, dim)));
}

/** All pattern dates in [fromYear, toYear], sorted. */
function patternDates(p: CouponPattern, fromYear: number, toYear: number): Date[] {
  const out: Date[] = [];
  for (let y = fromYear; y <= toYear; y++) for (const pr of p.pairs) out.push(dateFor(y, pr.month, pr.day));
  return out.sort((a, b) => a.getTime() - b.getTime());
}

/** T+n business days from `from` (weekends + holiday set skipped). */
export function settlementFrom(from: Date, holidays: Set<string>, lag = SETTLEMENT_LAG_BUSINESS_DAYS): Date {
  let d = new Date(from.getTime()); let n = 0; let guard = 0;
  while (n < lag && guard < 30) { d = addDays(d, 1); if (!isWeekend(d) && !holidays.has(toISO(d))) n++; guard++; }
  return d;
}

/** Today's date in India (the market's calendar day), as a UTC-midnight Date. */
function todayIST(): Date {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()));
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
  const start = toDate(startISO);
  let cursor = start; let cum = 0; let guard = 0;
  while (cursor <= maturity && cum < 100 - 0.01 && guard < 400) {
    const p = Math.min(pct, 100 - cum);
    if (cursor > settlement) events.push({ date: toISO(cursor), pct: p });
    cum += p; guard++; cursor = addMonths(start, step * guard);   // from the origin: no day drift
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

/** Coupons per year from a provider schedule: median gap between coupon payments. */
function inferPerYear(flows: ProviderFlow[]): number {
  const ds = flows.filter((f) => f.type === 'coupon').map((f) => toDate(f.date).getTime()).sort((a, b) => a - b);
  if (ds.length < 2) return 1;
  const gaps = ds.slice(1).map((t, i) => (t - ds[i]) / 86400000).sort((a, b) => a - b);
  const g = gaps[Math.floor(gaps.length / 2)];
  return g < 45 ? 12 : g < 135 ? 4 : g < 270 ? 2 : 1;
}

export function computeAnalytics(input: AnalyticsInput): AnalyticsResult {
  const coupon = input.couponRate ?? null;
  const settlement = input.settlementISO ? toDate(input.settlementISO) : settlementFrom(todayIST(), input.holidays);
  const settlementISO = toISO(settlement);
  const empty: AnalyticsResult = {
    ok: false, settlement_date: settlementISO, coupon_schedule: [], cashflow_schedule: [],
    accrued_per_100: 0, accrued_days: 0, accrual_convention: 'none', coupon_to_seller: 'unknown',
    next_coupon_for_accrual: null, record_date: input.recordDateISO ?? null, ex_interest_date: null,
    clean_price: input.cleanPricePer100 ?? null, dirty_price: null, current_yield: null,
    ytm: null, macaulay_duration: null, modified_duration: null, days_to_maturity: null, years_to_maturity: null,
    total_future_interest_per_100: 0, total_future_principal_per_100: 0, assumed_bullet: true,
    last_coupon_date: null, coupons_per_year: null, day_count_used: input.dayCount, calendar_source: 'none',
    frequency_assumed: false, frequency_conflict: false, calendar_needs_check: false,
  };
  if (!input.maturityISO) return { ...empty, reason: 'Maturity unknown' };
  const maturity = toDate(input.maturityISO);
  if (Number.isNaN(maturity.getTime())) return { ...empty, reason: 'Invalid maturity' };
  const dtm = days(settlement, maturity);
  if (dtm <= 0) return { ...empty, reason: 'Bond has matured' };
  const zero = input.frequency === 'zero' || coupon === null || coupon <= 0;

  const pattern = buildCouponPattern(input.ipDatesSeed, input.frequency, maturity);
  const pf = (input.providerFlows ?? []).filter((f) => f && f.date && Number.isFinite(f.amount_per_100));
  const useProvider = !zero && pf.length > 0;
  const perYear = useProvider ? inferPerYear(pf) : pattern.perYear;
  const step = zero ? 12 : 12 / perYear;
  const dcf = makeDcf(input.dayCount, maturity, zero ? 1 : perYear);
  const maturityISO = toISO(maturity);
  let scheduled: Date[] = [];
  let lastCoupon: Date;
  let cashflow: CashflowRow[] = [];
  let couponSched: CouponRow[] = [];
  let totInt = 0, totPrin = 0;
  let assumed_bullet = true;
  let outstandingAtSettlement = 100;
  let providerRecordDate: Date | null = null;

  if (useProvider) {
    // ---- authoritative schedule: take the provider's own dates and amounts ----
    const flows = [...pf].sort((a, b) => a.date.localeCompare(b.date));
    const coupons = flows.filter((f) => f.type === 'coupon');
    const principals = flows.filter((f) => f.type === 'principal');
    outstandingAtSettlement = +(100 - principals.filter((f) => toDate(f.date) <= settlement)
      .reduce((t, f) => t + f.amount_per_100, 0)).toFixed(4);
    const pastC = coupons.filter((f) => toDate(f.date) <= settlement);
    const futureC = coupons.filter((f) => toDate(f.date) > settlement);
    const issue = input.issueDateISO ? toDate(input.issueDateISO) : null;
    lastCoupon = pastC.length ? toDate(pastC[pastC.length - 1].date)
      : (issue && !Number.isNaN(issue.getTime()) && issue < settlement ? issue
        : futureC.length ? addMonths(toDate(futureC[0].date), -step) : addMonths(maturity, -12));
    scheduled = futureC.map((f) => toDate(f.date));
    if (!scheduled.length) scheduled = [maturity];
    const nextRec = futureC[0]?.record_date ? toDate(futureC[0].record_date) : null;
    providerRecordDate = nextRec && !Number.isNaN(nextRec.getTime()) ? nextRec : null;

    // Future cash-flow rows straight from the provider, grouped by payment date.
    const byDate = new Map<string, { i: number; p: number }>();
    for (const f of flows) {
      if (toDate(f.date) <= settlement || f.type === 'other') continue;
      const r = byDate.get(f.date) ?? { i: 0, p: 0 };
      if (f.type === 'coupon') r.i += f.amount_per_100; else r.p += f.amount_per_100;
      byDate.set(f.date, r);
    }
    const dates = [...byDate.keys()].sort();
    let seq = 0; let cseq = 0; let outstanding = outstandingAtSettlement; let prev = lastCoupon;
    const anyPartial = dates.some((d, k) => k < dates.length - 1 && (byDate.get(d)!.p > 0));
    assumed_bullet = !anyPartial;
    for (let k = 0; k < dates.length; k++) {
      const d = dates[k]; const r = byDate.get(d)!;
      const interest = +r.i.toFixed(4); const principal = +Math.min(r.p, outstanding).toFixed(4);
      const isLast = k === dates.length - 1;
      if (interest > 0) couponSched.push({ seq: ++cseq, period_start: toISO(prev), period_end: d, scheduled_date: d, pay_date: d, coupon_per_100: interest, outstanding_per_100: +outstanding.toFixed(4) });
      const remark = isLast ? (totPrin > 0 ? 'Final redemption' : 'Maturity redemption') : principal > 0 ? 'Part redemption' : '';
      cashflow.push({ seq: ++seq, date: d, interest_per_100: interest, principal_per_100: principal, total_per_100: +(interest + principal).toFixed(4), remark });
      totInt += interest; totPrin += principal; outstanding = +(outstanding - principal).toFixed(4);
      if (interest > 0) prev = toDate(d);
    }
  } else {
    // ---- coupon calendar (scheduled dates) ----
    const issue = input.issueDateISO ? toDate(input.issueDateISO) : null;
    const validIssue = issue && !Number.isNaN(issue.getTime()) && issue < settlement ? issue : null;
    if (!zero) {
      const all = patternDates(pattern, settlement.getUTCFullYear() - 1, maturity.getUTCFullYear());
      for (const d of all) if (d > settlement && d < maturity) scheduled.push(d);
      scheduled.push(maturity);                                   // final (possibly broken) period ends at maturity
      const past = all.filter((d) => d <= settlement);
      lastCoupon = past.length ? past[past.length - 1] : addMonths(scheduled[0], -step);
      if (validIssue && validIssue > lastCoupon) lastCoupon = validIssue;   // first coupon period starts at allotment
    } else {
      scheduled.push(maturity);
      lastCoupon = validIssue ?? addMonths(maturity, -12);
    }

    // ---- redemption plan ----
    let events = input.redemptionSchedule && input.redemptionSchedule.length ? input.redemptionSchedule
               : parseRedemptionText(input.redemptionText, maturity, settlement) ?? [];
    events = events.filter(e => { const d = toDate(e.date); return d > settlement && d <= maturity; });
    assumed_bullet = events.length === 0;

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

    // ---- walk timeline: interest on reducing balance (per 100) ----
    let outstanding = 100;
    let prev = lastCoupon;
    let accum = 0;
    let seq = 0; let cseq = 0;
    for (let i = 0; i < timeline.length; i++) {
      const iso = timeline[i];
      const scheduledD = toDate(iso);
      const isMaturity = iso === maturityISO || i === timeline.length - 1;
      // SEBI (CIR/IMD/DF-1/122/2016): a coupon falling on a holiday is paid the NEXT working
      // day with no extra interest; a REDEMPTION falling on a holiday is paid the PREVIOUS
      // working day with interest only up to that day.
      const payD = isMaturity && input.bizConv !== 'none' && input.bizConv !== ''
        ? adjustPreceding(scheduledD, input.holidays)
        : adjustBiz(scheduledD, input.bizConv, input.holidays);
      const isCoupon = schedSet.has(iso) || isMaturity;
      const accrueTo = isMaturity ? payD : scheduledD;
      accum += outstanding * ((coupon ?? 0) / 100) * dcf(prev, accrueTo, accrueTo);
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
  if (providerRecordDate && inPeriod(providerRecordDate)) {
    // Provider record date (issuer-filed). In the Indian depository system the coupon goes to
    // the beneficial owner as of END of the record date, so a trade that SETTLES on the record
    // date is still cum-interest and one settling the day after is ex-interest.
    exDate = addDays(providerRecordDate, 1);
    if (!(exDate <= nextCoupon)) exDate = null;
  } else if (input.exInterestDateISO) {
    const d = toDate(input.exInterestDateISO);
    if (!Number.isNaN(d.getTime()) && inPeriod(d)) exDate = d;
  } else if (rule === 'ex_on_record_date' && input.recordDateISO) {
    const d = toDate(input.recordDateISO);   // the bond's own terms declare ex-date == record date
    if (!Number.isNaN(d.getTime()) && inPeriod(d)) exDate = d;
  }

  // Accrued uses the same convention as the coupon itself, with the interest year chosen by
  // the coupon period the settlement falls in (period end = next coupon).
  const cumInterest = () => +(outstandingAtSettlement * ((coupon ?? 0) / 100) * dcf(lastCoupon, settlement, nextCoupon)).toFixed(4);
  const accruedDays = () => input.dayCount === '30_360' ? days30E360(lastCoupon, settlement) : days(lastCoupon, settlement);
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
    accrued = +(outstandingAtSettlement * ((coupon ?? 0) / 100) * dcf(settlement, nextCoupon, nextCoupon) * -1).toFixed(4);
    accrual_convention = 'ex'; coupon_to_seller = 'seller';
  } else if (exDate !== null) {
    // Entitlement is known (an ex-date exists) and settlement is before it → cum-interest,
    // buyer becomes holder of record, seller is paid normal positive accrued.
    accrued_days = accruedDays(); accrued = cumInterest();
    accrual_convention = 'cum'; coupon_to_seller = 'buyer';
  } else if (rule === 'always_cum') {
    accrued_days = accruedDays(); accrued = cumInterest();
    accrual_convention = 'cum'; coupon_to_seller = 'buyer';
  } else {
    // No actual ex-interest date and no usable rule → entitlement cannot be established.
    // Preserve the EXISTING positive cum-interest calculation exactly; flag 'unknown'.
    accrued_days = accruedDays(); accrued = cumInterest();
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
    record_date: providerRecordDate ? toISO(providerRecordDate) : (input.recordDateISO ?? null),
    ex_interest_date: exDate ? toISO(exDate) : (input.exInterestDateISO ?? null),
    clean_price: clean, dirty_price: dirty, current_yield,
    ytm, macaulay_duration: mac, modified_duration: mod,
    days_to_maturity: dtm, years_to_maturity: +(dtm / 365).toFixed(3),
    total_future_interest_per_100: +totInt.toFixed(4), total_future_principal_per_100: +totPrin.toFixed(4),
    assumed_bullet,
    last_coupon_date: zero ? null : toISO(lastCoupon),
    coupons_per_year: zero ? null : perYear,
    day_count_used: input.dayCount,
    calendar_source: zero ? 'none' : useProvider ? 'provider' : pattern.source,
    frequency_assumed: !zero && !useProvider && pattern.frequencyAssumed,
    frequency_conflict: !zero && !useProvider && pattern.frequencyConflict,
    calendar_needs_check: !zero && !useProvider && (pattern.frequencyAssumed || (pattern.source === 'seed' && pattern.perYear === 1
      && !pattern.pairs.some((p) => p.month === maturity.getUTCMonth()))),
  };
}
