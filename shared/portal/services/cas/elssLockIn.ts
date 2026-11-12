/**
 * ELSS lock-in, lot by lot — pure, no I/O.
 *
 * An ELSS unit is locked for THREE YEARS from the date it was allotted, and the
 * lock is per purchase: each SIP instalment, and each dividend reinvestment,
 * starts its own three-year clock. So the question "what can I redeem, and
 * when?" can only be answered one lot at a time — a scheme-level average would
 * be wrong for every instalment except the mean one.
 *
 * The lots themselves are not computed here. The capital-gains engine already
 * walks the full CAS ledger (FIFO, with SIP reversals and same-day ordering
 * handled) and emits the surviving, still-held positions as `openLots`. This
 * module is only the lock-in overlay on top of them: identify the ELSS schemes,
 * add three years to each lot's buy date, and say whether that date has passed.
 *
 * ## The one soft edge: identifying ELSS
 *
 * Neither a CAS nor the registrar feed states a scheme category, so ELSS is
 * recognised from the fund NAME — "ELSS", "Tax Saver/Saving", or the older
 * "Long Term Equity" branding (Axis, etc.). This is the same matcher the ELSS
 * report uses, and it is the single source of truth for both. It is good, not
 * perfect: a tax-saver that hides its nature in its name would be missed. If
 * certainty is ever needed, a curated ISIN set would slot in alongside this.
 */
import type { OpenLot } from './gains';

/** The lock-in period, in years, under the ELSS notification (s.80C). */
const LOCK_IN_YEARS = 3;

/**
 * The slice of a computed scheme the lock-in overlay needs. Both the CAS gains
 * engine's `SchemeGains` and the registrar-feed adapter produce this shape, so
 * one overlay serves both sources — see [[registrarElss]].
 */
export interface ElssLockInSource {
  schemeName: string;
  isin: string | null;
  /** False when the lots cannot be trusted (truncated history / unreconciled feed). */
  complete: boolean;
  openLots: OpenLot[];
  openCost: number;
  openUnits: number;
  /** Unrealised gain at the latest NAV, or null when none is known. */
  unrealised: number | null;
}

/** A still-held purchase and where it stands against its three-year lock. */
export interface ElssLockInLot {
  /** The fund's name exactly as the statement prints it (for reconciliation). */
  schemeName: string;
  isin: string | null;
  /** Allotment date of this lot. */
  buyDate: string;
  units: number;
  /** What was paid for these units — the 80C-relevant figure. */
  invested: number;
  /** Value at the latest NAV, where one is known; null otherwise. */
  currentValue: number | null;
  /** buyDate + 3 years. */
  unlockDate: string;
  /** True while today is before the unlock date. */
  locked: boolean;
  /** Whole days until it unlocks; 0 once free. */
  daysToUnlock: number;
}

export interface ElssLockIn {
  lots: ElssLockInLot[];
  /** Cost of units still inside their lock-in. */
  lockedInvested: number;
  /** Cost of units now free to redeem. */
  freeInvested: number;
  lockedUnits: number;
  freeUnits: number;
  totalInvested: number;
  /** Current value across all lots, or null when no NAV is known for any. */
  currentValue: number | null;
  /** The soonest a locked lot unlocks, or null when nothing is locked. */
  nextUnlockDate: string | null;
  /** Distinct ELSS schemes represented. */
  schemeCount: number;
}

/**
 * Recognise an ELSS scheme from its name. Exported so every surface — this
 * module, the ELSS report, the lock-in panel — agrees on what counts as ELSS.
 */
const ELSS_RE = /\b(elss|tax[\s-]?saver|tax[\s-]?saving|long[\s-]?term\s+equity)\b/i;
export function isElssName(name: string | null | undefined): boolean {
  return !!name && ELSS_RE.test(name);
}

/**
 * Combine the two lot sources into one list, counting a fund once.
 *
 * A client can have both an imported CAS and a registrar feed for the same ELSS
 * scheme. The CAS copy wins — it carries the real cost and any grandfathering —
 * so a registrar source is dropped when a complete CAS source shares its ISIN.
 */
export function mergeElssSources(
  cas: ElssLockInSource[],
  registrar: ElssLockInSource[],
): ElssLockInSource[] {
  const casElssIsins = new Set(
    cas.filter((s) => s.complete && isElssName(s.schemeName) && s.isin).map((s) => s.isin as string),
  );
  return [...cas, ...registrar.filter((r) => !r.isin || !casElssIsins.has(r.isin))];
}

const day = (d: string) => d.slice(0, 10);
const UNIT_EPSILON = 0.001;

/** Today in UTC, as yyyy-mm-dd — the lock-in boundary is a date, not an instant. */
function todayUtc(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * buyDate + 3 years, as yyyy-mm-dd. Built through a UTC Date so an allotment on
 * 29 February (which has no third anniversary) normalises to 1 March rather than
 * producing an impossible date string.
 */
function addLockIn(buyDate: string): string {
  const [y, m, d] = day(buyDate).split('-').map(Number);
  return new Date(Date.UTC(y + LOCK_IN_YEARS, m - 1, d)).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const [ay, am, ad] = from.split('-').map(Number);
  const [by, bm, bd] = to.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/**
 * The ELSS lock-in overlay for a client's computed gains.
 *
 * `now` is injected so the pure function stays testable; callers pass the real
 * clock. Returns null when the client holds no ELSS lots we can date — nothing
 * to show rather than an empty panel.
 */
export function computeElssLockIn(schemes: ElssLockInSource[], now: Date = new Date()): ElssLockIn | null {
  const today = todayUtc(now);
  const lots: ElssLockInLot[] = [];
  const schemeNames = new Set<string>();

  for (const s of schemes) {
    // An incomplete scheme has no trustworthy lots (the engine withholds them),
    // and a non-ELSS one has no lock-in to show.
    if (!s.complete || !isElssName(s.schemeName) || s.openLots.length === 0) continue;

    // Latest NAV, recovered from the engine's own unrealised figure, so no extra
    // read is needed: currentNav = (cost + unrealised) / units.
    const currentNav =
      s.unrealised !== null && s.openUnits > UNIT_EPSILON
        ? (s.openCost + s.unrealised) / s.openUnits
        : null;

    for (const lot of s.openLots) {
      if (lot.units <= UNIT_EPSILON) continue;
      const unlockDate = addLockIn(lot.buyDate);
      const locked = today < unlockDate;
      lots.push({
        schemeName: s.schemeName,
        isin: s.isin,
        buyDate: day(lot.buyDate),
        units: lot.units,
        invested: lot.cost,
        currentValue: currentNav !== null ? lot.units * currentNav : null,
        unlockDate,
        locked,
        daysToUnlock: locked ? Math.max(0, daysBetween(today, unlockDate)) : 0,
      });
      schemeNames.add(s.schemeName);
    }
  }

  if (lots.length === 0) return null;

  // Locked first (soonest to unlock at the top), then the units already free.
  lots.sort((a, b) => {
    if (a.locked !== b.locked) return a.locked ? -1 : 1;
    return a.unlockDate < b.unlockDate ? -1 : a.unlockDate > b.unlockDate ? 1 : 0;
  });

  let lockedInvested = 0;
  let freeInvested = 0;
  let lockedUnits = 0;
  let freeUnits = 0;
  let currentValue: number | null = null;
  let nextUnlockDate: string | null = null;

  for (const l of lots) {
    if (l.locked) {
      lockedInvested += l.invested;
      lockedUnits += l.units;
      if (nextUnlockDate === null || l.unlockDate < nextUnlockDate) nextUnlockDate = l.unlockDate;
    } else {
      freeInvested += l.invested;
      freeUnits += l.units;
    }
    if (l.currentValue !== null) currentValue = (currentValue ?? 0) + l.currentValue;
  }

  const round = (n: number) => Number(n.toFixed(2));
  return {
    lots,
    lockedInvested: round(lockedInvested),
    freeInvested: round(freeInvested),
    lockedUnits: Number(lockedUnits.toFixed(3)),
    freeUnits: Number(freeUnits.toFixed(3)),
    totalInvested: round(lockedInvested + freeInvested),
    currentValue: currentValue === null ? null : round(currentValue),
    nextUnlockDate,
    schemeCount: schemeNames.size,
  };
}
