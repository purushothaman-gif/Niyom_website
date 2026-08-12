/**
 * Capital gains from a CAS ledger — FIFO lot matching, pure and no I/O.
 *
 * A gain is arithmetic: units bought at one price, sold at another. A TAX is a
 * claim about the law applied to a fund whose composition we may not know. This
 * module keeps those apart on purpose. Every disposal carries a gain, always.
 * Only some carry a tax treatment, and none carries a figure the client should
 * file without checking.
 *
 * ## Why FIFO
 *
 * Income-tax law gives no choice: units are deemed sold in the order acquired.
 * There is no averaging and no specific-lot election, so the cost of a
 * redemption depends on the entire purchase history preceding it — which is
 * exactly why an incomplete ledger cannot produce a defensible number.
 *
 * ## What makes this dangerous rather than merely fiddly
 *
 * Three traps, all of them live in the real data:
 *
 * 1. A REVERSED purchase. When a SIP instalment bounces the registrar prints the
 *    row again, negative. There are 52 such rows across the book. Treated as a
 *    sale it invents a disposal that never happened AND leaves phantom units in
 *    the ledger; the same rows already produced a -38.9% XIRR on a portfolio
 *    that was up 6% before `toFlow` was fixed. Here they cancel the lot instead.
 *
 * 2. Grandfathering. Equity units bought before 01-Feb-2018 have their cost
 *    re-based to 31-Jan-2018 under s.55(2)(ac) — 639 purchases across 16 schemes
 *    and two clients, the oldest from 2005. Ignore it and a client is taxed on
 *    twenty years of growth Parliament exempted.
 *
 * 3. A truncated statement. A CAS requested for one financial year opens with
 *    units the client already held, bought with money the file never mentions.
 *    The holdings are right and the cost basis is unknowable. That must produce
 *    a refusal, not an estimate.
 */

/* --------------------------------------------------------------- inputs -- */

/** What the fund holds, which is what decides its holding period and rate. */
export type AssetClass = 'equity' | 'debt' | 'other';

export interface GainsTxn {
  scheme_id?: string | null;
  txn_date: string;
  txn_type: string | null;
  amount: number | null;
  units: number | null;
  nav?: number | null;
  /**
   * The running unit balance the registrar printed after this transaction. The
   * only reliable evidence of same-day ordering — see `inLedgerOrder`.
   */
  balance_units?: number | null;
}

export interface GainsScheme {
  id: string;
  name: string;
  isin: string | null;
  /** Closing units per the statement — the completeness check compares to this. */
  units: number | null;
}

export interface GainsContext {
  /** Per ISIN. Absent or null means undecided: gains yes, tax treatment no. */
  assetClassByIsin: Map<string, AssetClass | null>;
  /** NAV on 31-Jan-2018 per ISIN, for grandfathering. */
  grandfatherNavByIsin: Map<string, number>;
  /** Latest NAV per ISIN, for unrealised gains on what is still held. */
  currentNavByIsin?: Map<string, number>;
}

/* -------------------------------------------------------------- outputs -- */

export type Term = 'short' | 'long';

/**
 * How the gain is taxed.
 *
 * `slab` means the rate depends on the client's own income and cannot be
 * computed here. `undecided` means we do not know what the fund holds — the
 * gain is still correct, the treatment simply is not known yet.
 */
export type TaxTreatment =
  | { kind: 'equity'; term: Term; rate: number }
  | { kind: 'non_equity'; term: 'long'; rate: number }
  | { kind: 'slab'; term: Term }
  | { kind: 'undecided'; term: null };

export interface Disposal {
  schemeId: string;
  schemeName: string;
  isin: string | null;
  /** Financial year of the SALE, "2026-27" style. */
  fy: string;
  buyDate: string;
  sellDate: string;
  units: number;
  /** What was actually paid per unit, before any grandfathering. */
  buyNav: number;
  sellNav: number;
  /** Money actually paid for these units. */
  actualCost: number;
  /** Cost after s.55(2)(ac). Equals actualCost when grandfathering does not apply. */
  cost: number;
  grandfathered: boolean;
  proceeds: number;
  gain: number;
  holdingDays: number;
  treatment: TaxTreatment;
}

export interface OpenLot {
  buyDate: string;
  units: number;
  buyNav: number;
  cost: number;
}

export interface SchemeGains {
  schemeId: string;
  schemeName: string;
  isin: string | null;
  assetClass: AssetClass | null;
  /**
   * False when the ledger cannot explain every unit — a truncated statement, or
   * a sale with no purchase behind it. Disposals are NOT reported in that case.
   */
  complete: boolean;
  /** Why it is incomplete, for a message the client can act on. */
  incompleteReason?: string;
  disposals: Disposal[];
  openLots: OpenLot[];
  /** Cost of what is still held, from the surviving lots. */
  openCost: number;
  openUnits: number;
  /** Unrealised gain at the latest NAV, when one is known. */
  unrealised: number | null;
}

/* --------------------------------------------------------- date helpers -- */

const day = (d: string) => d.slice(0, 10);

/** Indian financial year of a date: 01 Apr to 31 Mar. "2026-27". */
export function financialYear(date: string): string {
  const [y, m] = day(date).split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** Whole days between two ISO dates. */
function daysBetween(from: string, to: string): number {
  const a = Date.UTC(...(day(from).split('-').map(Number) as [number, number, number]));
  const b = Date.UTC(...(day(to).split('-').map(Number) as [number, number, number]));
  return Math.round((b - a) / 86_400_000);
}

/**
 * Has a whole number of months elapsed between two dates?
 *
 * Counted in calendar months rather than in days, because the law says months.
 * A 365-day rule makes 31-Jan to 31-Jan of a leap year short-term by one day,
 * which is both wrong and impossible to explain to a client.
 */
function heldAtLeastMonths(buy: string, sell: string, months: number): boolean {
  const [by, bm, bd] = day(buy).split('-').map(Number);
  const [sy, sm, sd] = day(sell).split('-').map(Number);
  const elapsed = (sy - by) * 12 + (sm - bm);
  if (elapsed > months) return true;
  if (elapsed < months) return false;
  return sd > bd; // the anniversary itself is not "more than"
}

/* ------------------------------------------------------------ tax rules -- */

/**
 * The dates the rules changed. Kept as named constants because every one of
 * them is a cliff: the same disposal on either side is taxed differently.
 */
const RULES = {
  /** Finance (No. 2) Act 2024 — new rates and a 24-month long-term threshold. */
  NEW_REGIME_FROM: '2024-07-23',
  /** Units bought before this are grandfathered under s.55(2)(ac). */
  GRANDFATHER_BEFORE: '2018-02-01',
  /** The FMV date grandfathering is measured on. */
  GRANDFATHER_DATE: '2018-01-31',
  /**
   * Debt funds bought on or after this are "specified mutual funds" under
   * s.50AA — deemed short-term however long they are held.
   */
  SPECIFIED_FUND_FROM: '2023-04-01',
} as const;

/**
 * Long-term thresholds, in months.
 *
 * Equity has been 12 throughout. Everything else was 36 and became 24 for
 * disposals on or after 23-Jul-2024.
 */
function longTermMonths(assetClass: AssetClass, sellDate: string): number {
  if (assetClass === 'equity') return 12;
  return day(sellDate) >= RULES.NEW_REGIME_FROM ? 24 : 36;
}

/**
 * How a single disposal is taxed.
 *
 * Rates are the statutory ones where a statutory one exists. Where the law says
 * "at slab", no rate is returned — the client's slab is not ours to assume, and
 * a plausible 30% would be a number they might actually file.
 */
export function taxTreatmentOf(
  assetClass: AssetClass | null,
  buyDate: string,
  sellDate: string,
): TaxTreatment {
  if (!assetClass) return { kind: 'undecided', term: null };

  const newRegime = day(sellDate) >= RULES.NEW_REGIME_FROM;

  if (assetClass === 'equity') {
    const term: Term = heldAtLeastMonths(buyDate, sellDate, 12) ? 'long' : 'short';
    if (term === 'long') {
      // 10% over ₹1L, then 12.5% over ₹1.25L. The exemption is applied on the
      // year's total, not here — see summariseFinancialYear.
      return { kind: 'equity', term, rate: newRegime ? 0.125 : 0.1 };
    }
    return { kind: 'equity', term, rate: newRegime ? 0.2 : 0.15 };
  }

  /*
   * A debt fund bought on or after 01-Apr-2023 is deemed short-term no matter
   * how long it is held, and taxed at slab. Holding period is not consulted.
   */
  if (assetClass === 'debt' && day(buyDate) >= RULES.SPECIFIED_FUND_FROM) {
    return { kind: 'slab', term: 'short' };
  }

  const months = longTermMonths(assetClass, sellDate);
  const term: Term = heldAtLeastMonths(buyDate, sellDate, months) ? 'long' : 'short';

  if (term === 'short') return { kind: 'slab', term };

  /*
   * Long-term on a non-equity fund: 12.5% without indexation under the new
   * regime. Before it, 20% WITH indexation — which needs the cost inflation
   * index for both years, a table we do not carry. Rather than quietly apply
   * 20% to an unindexed cost and overstate the tax, those fall to slab-style
   * "no rate stated".
   */
  if (!newRegime) return { kind: 'slab', term };
  return { kind: 'non_equity', term: 'long', rate: 0.125 };
}

/* ------------------------------------------------------- grandfathering -- */

/**
 * Cost of acquisition under s.55(2)(ac).
 *
 *   cost = max( actual cost, min( FMV on 31-Jan-2018, sale value ) )
 *
 * Both halves matter. The inner `min` stops a fund that has since FALLEN from
 * generating an artificial loss — you cannot claim relief for a decline that
 * happened before the exemption. The outer `max` stops a fund that fell before
 * 2018 and recovered from being taxed on less than the client actually paid.
 *
 * Applies only to EQUITY units bought before 01-Feb-2018. It never applies to
 * debt, and it never applies to a sale before 01-Apr-2018 — but no statement in
 * the book has one, and the units test alone would be misleading, so the sale
 * date is checked too.
 */
export function grandfatheredCost(args: {
  assetClass: AssetClass | null;
  buyDate: string;
  sellDate: string;
  units: number;
  actualCost: number;
  proceeds: number;
  fmvPerUnit: number | undefined;
}): { cost: number; grandfathered: boolean } {
  const { assetClass, buyDate, sellDate, units, actualCost, proceeds, fmvPerUnit } = args;

  const eligible =
    assetClass === 'equity' &&
    day(buyDate) < RULES.GRANDFATHER_BEFORE &&
    day(sellDate) >= '2018-04-01' &&
    typeof fmvPerUnit === 'number' &&
    fmvPerUnit > 0;

  if (!eligible) return { cost: actualCost, grandfathered: false };

  const fmv = fmvPerUnit * units;
  const cost = Math.max(actualCost, Math.min(fmv, proceeds));
  return { cost, grandfathered: cost !== actualCost };
}

/* -------------------------------------------------------- the ledger walk -- */

/** Units tolerance — a CAS prints three decimals. */
const UNIT_EPSILON = 0.001;

/** Types that ADD units the investor now owns. */
const ACQUISITIONS = new Set(['PURCHASE', 'SWITCH_IN', 'DIVIDEND', 'BONUS', 'OTHER']);
/** Types that REMOVE units, and are disposals for tax. */
const DISPOSALS = new Set(['REDEMPTION', 'SWITCH_OUT']);

interface WorkingLot {
  buyDate: string;
  units: number;
  costPerUnit: number;
}

/**
 * Order the ledger the way it actually happened.
 *
 * Same-day order is not cosmetic. A purchase and a redemption on one day give
 * different costs depending on which is applied first (4 such days in the book),
 * and a purchase with its own reversal on the same day is the normal shape of a
 * failed SIP instalment (52 days).
 *
 * There is no sequence column to sort by. `created_at` is useless — one bulk
 * insert per import, 16 distinct values across 5,720 rows — and `id` is a random
 * UUID, so sorting by it silently invents an order. Two identical rows can even
 * appear twice in a day (the same redemption, printed twice).
 *
 * What the registrar does give us is `balance_units`, the running unit balance
 * printed after every transaction, populated on all 5,720 rows. That is its own
 * record of the sequence: the true order is the one where each row's balance,
 * less its own units, equals the balance left by the row before it. So the chain
 * is walked rather than guessed.
 *
 * Where the chain cannot be followed — a statement whose opening balance we do
 * not know, or a registrar that omitted a balance — the remaining rows keep the
 * order they arrived in. Those schemes fail the completeness test anyway and are
 * never reported.
 */
export function inLedgerOrder(txns: GainsTxn[], openingBalance = 0): GainsTxn[] {
  const byDate = new Map<string, GainsTxn[]>();
  for (const t of txns) {
    const d = day(t.txn_date);
    const list = byDate.get(d) ?? [];
    list.push(t);
    byDate.set(d, list);
  }

  const out: GainsTxn[] = [];
  let running = openingBalance;

  for (const d of [...byDate.keys()].sort()) {
    const pending = [...(byDate.get(d) as GainsTxn[])];

    while (pending.length) {
      /*
       * The next row is the one that continues the chain: its balance minus its
       * own units is where the previous row left off. Rows that move no units
       * (stamp duty, STT) satisfy this trivially and slot in wherever they sit.
       */
      const next = pending.findIndex((t) => {
        const balance = Number(t.balance_units);
        if (!Number.isFinite(balance)) return false;
        return Math.abs(balance - (Number(t.units) || 0) - running) <= UNIT_EPSILON;
      });

      if (next === -1) {
        // Chain broken — keep what is left in its original order rather than
        // reordering on a guess.
        out.push(...pending);
        const last = pending[pending.length - 1];
        const lastBalance = Number(last?.balance_units);
        running = Number.isFinite(lastBalance)
          ? lastBalance
          : running + pending.reduce((s, t) => s + (Number(t.units) || 0), 0);
        break;
      }

      const [chosen] = pending.splice(next, 1);
      out.push(chosen);
      const balance = Number(chosen.balance_units);
      if (Number.isFinite(balance)) running = balance;
      else running += Number(chosen.units) || 0;
    }
  }

  return out;
}

/**
 * Stamp duty belongs in the cost of the units it was charged on.
 *
 * A CAS records a purchase NET of duty and prints the duty as its own row:
 *
 *   Purchase      199,990.00
 *   *** Stamp Duty ***  10.00
 *
 * The statement's own "Total Cost Value" for that scheme is 200,000 — the gross.
 * Taking the purchase amount alone therefore understates the cost of every unit
 * ever bought, which overstates every gain. Small per transaction (0.005%) and
 * entirely systematic; measured across the 54 schemes with no sales, the gap was
 * the stamp duty total to the paisa in all of them.
 *
 * Duty is charged per transaction and dated with it, so it is apportioned across
 * whatever was acquired that day in proportion to the amount — which is exact
 * when there is one purchase, and the only defensible split when there are
 * several.
 */
function stampDutyByDate(txns: GainsTxn[]): Map<string, number> {
  const duty = new Map<string, number>();
  const acquired = new Map<string, number>();

  for (const t of txns) {
    const d = day(t.txn_date);
    const amount = Number(t.amount) || 0;
    if (t.txn_type === 'STAMP_DUTY') {
      duty.set(d, (duty.get(d) ?? 0) + amount);
    } else if ((Number(t.units) || 0) > 0 && ACQUISITIONS.has(t.txn_type ?? '')) {
      acquired.set(d, (acquired.get(d) ?? 0) + Math.abs(amount));
    }
  }

  // Expressed as a multiplier per rupee acquired, so a lot only has to scale.
  const rate = new Map<string, number>();
  for (const [d, amount] of duty) {
    const base = acquired.get(d) ?? 0;
    // Duty on a day with no purchase belongs to nothing we can price — most
    // often the duty on a reversal, which creates no lot.
    if (base > 0) rate.set(d, amount / base);
  }
  return rate;
}

/**
 * Undo a purchase that the registrar reversed.
 *
 * A bounced SIP instalment is printed again with negative units and a negative
 * amount. It is NOT a sale — no units were ever really owned and no money was
 * ever really received — so it removes units from the lots most recently added,
 * newest first. A reversal always follows the instalment it cancels, usually
 * within days, so the newest lot is the one being undone.
 *
 * Returns whatever could not be cancelled, which should be zero.
 */
function reverseAcquisition(lots: WorkingLot[], units: number): number {
  let remaining = units;
  for (let i = lots.length - 1; i >= 0 && remaining > UNIT_EPSILON; i -= 1) {
    const take = Math.min(lots[i].units, remaining);
    lots[i].units -= take;
    remaining -= take;
    if (lots[i].units <= UNIT_EPSILON) lots.splice(i, 1);
  }
  return remaining;
}

/**
 * Walk one scheme's ledger and produce its disposals and surviving lots.
 *
 * Exported for testing a single scheme in isolation; `computeGains` runs it
 * across a portfolio.
 */
export function computeSchemeGains(
  scheme: GainsScheme,
  txns: GainsTxn[],
  ctx: GainsContext,
): SchemeGains {
  const isin = scheme.isin ?? null;
  const assetClass = (isin ? ctx.assetClassByIsin.get(isin) : null) ?? null;
  const fmv = isin ? ctx.grandfatherNavByIsin.get(isin) : undefined;

  const lots: WorkingLot[] = [];
  const disposals: Disposal[] = [];
  let unmatchedSaleUnits = 0;
  const dutyRate = stampDutyByDate(txns);

  /*
   * A reversal that arrived before the purchase it cancels.
   *
   * Real and common: the very first rows of one client's HSBC Value ledger are
   * a -81.927 unit reversal and a +81.927 unit purchase on the same day, and 52
   * days across the book pair a purchase with a reversal. Where the running
   * balance settles the order this never arises — but where it cannot, a
   * reversal must still never become a sale, and must never leave the scheme
   * looking incomplete. So unmatched reversed units wait here and are absorbed
   * by the next acquisition instead.
   */
  let pendingReversal = 0;

  const openingBalance = (Number(scheme.units) || 0) - txns.reduce((s, t) => s + (Number(t.units) || 0), 0);

  for (const t of inLedgerOrder(txns, openingBalance)) {
    let units = Number(t.units) || 0;
    const amount = Number(t.amount) || 0;
    const type = t.txn_type ?? '';
    if (!units) continue; // stamp duty, STT, a dividend payout — no units move

    /* ---------------------------------------------------- an acquisition -- */
    if (units > 0 && ACQUISITIONS.has(type)) {
      // Settle any reversal that got ahead of its purchase before opening a lot.
      if (pendingReversal > UNIT_EPSILON) {
        const absorbed = Math.min(units, pendingReversal);
        pendingReversal -= absorbed;
        units -= absorbed;
        if (units <= UNIT_EPSILON) continue;
      }
      /*
       * Cost per unit comes from the money actually paid, not from the printed
       * NAV — plus that day's stamp duty, which the statement records on its own
       * line but counts inside its Total Cost Value.
       *
       * A dividend REINVESTMENT has units and an amount too, and is a genuine
       * acquisition: the payout was taxed as income, and those units now carry
       * their own cost.
       */
      const d = day(t.txn_date);
      /*
       * Cost per unit comes from the ORIGINAL transaction, not from whatever
       * survived a partial reversal — the price paid per unit does not change
       * because some of the units were cancelled.
       */
      const bought = Number(t.units) || 0;
      const paid = Math.abs(amount) * (1 + (dutyRate.get(d) ?? 0));
      const costPerUnit = paid > 0 && bought > 0 ? paid / bought : Number(t.nav) || 0;
      lots.push({ buyDate: d, units, costPerUnit });
      continue;
    }

    /* ------------------------------------------------- a reversed purchase -- */
    if (units < 0 && ACQUISITIONS.has(type)) {
      pendingReversal += reverseAcquisition(lots, -units);
      continue;
    }

    /* ------------------------------------------------------- a real sale -- */
    if (units < 0 && DISPOSALS.has(type)) {
      let toSell = -units;
      const sellNav = Number(t.nav) || (Math.abs(amount) > 0 ? Math.abs(amount) / toSell : 0);
      const sellDate = day(t.txn_date);

      while (toSell > UNIT_EPSILON && lots.length) {
        const lot = lots[0];
        const take = Math.min(lot.units, toSell);

        const actualCost = take * lot.costPerUnit;
        const proceeds = take * sellNav;
        const { cost, grandfathered } = grandfatheredCost({
          assetClass,
          buyDate: lot.buyDate,
          sellDate,
          units: take,
          actualCost,
          proceeds,
          fmvPerUnit: fmv,
        });

        disposals.push({
          schemeId: scheme.id,
          schemeName: scheme.name,
          isin,
          fy: financialYear(sellDate),
          buyDate: lot.buyDate,
          sellDate,
          units: take,
          buyNav: lot.costPerUnit,
          sellNav,
          actualCost,
          cost,
          grandfathered,
          proceeds,
          gain: proceeds - cost,
          holdingDays: daysBetween(lot.buyDate, sellDate),
          treatment: taxTreatmentOf(assetClass, lot.buyDate, sellDate),
        });

        lot.units -= take;
        toSell -= take;
        if (lot.units <= UNIT_EPSILON) lots.shift();
      }

      // Units sold that no purchase in this statement accounts for.
      if (toSell > UNIT_EPSILON) unmatchedSaleUnits += toSell;
    }
  }

  /*
   * Two independent completeness checks, because they fail differently.
   *
   * A sale with no lot behind it is proof the history is truncated. But a
   * statement can also be truncated WITHOUT any such sale — the opening units
   * simply sit there and are never sold — and then the ledger's closing balance
   * disagrees with the statement's. Either one means the cost basis of some
   * units is unknown, and an unknown cost basis cannot produce a tax figure.
   */
  const openUnits = lots.reduce((s, l) => s + l.units, 0);
  const closing = Number(scheme.units) || 0;
  const reconstructs = Math.abs(closing - openUnits) <= UNIT_EPSILON;

  let incompleteReason: string | undefined;
  if (unmatchedSaleUnits > UNIT_EPSILON) {
    incompleteReason = `${unmatchedSaleUnits.toFixed(3)} units were sold with no purchase in this statement — request a CAS covering the full history.`;
  } else if (!reconstructs) {
    incompleteReason = `The statement opens with ${(closing - openUnits).toFixed(3)} units already held, bought before it begins.`;
  } else if (pendingReversal > UNIT_EPSILON) {
    incompleteReason = `${pendingReversal.toFixed(3)} reversed units had no matching purchase.`;
  }

  const complete = !incompleteReason;
  const openCost = lots.reduce((s, l) => s + l.units * l.costPerUnit, 0);
  const currentNav = isin ? ctx.currentNavByIsin?.get(isin) : undefined;

  return {
    schemeId: scheme.id,
    schemeName: scheme.name,
    isin,
    assetClass,
    complete,
    incompleteReason,
    // A cost basis we cannot stand behind must not be shown as a gain.
    disposals: complete ? disposals : [],
    openLots: complete ? lots.map((l) => ({ buyDate: l.buyDate, units: l.units, buyNav: l.costPerUnit, cost: l.units * l.costPerUnit })) : [],
    openCost: complete ? openCost : 0,
    openUnits: complete ? openUnits : 0,
    unrealised:
      complete && typeof currentNav === 'number' && currentNav > 0
        ? openUnits * currentNav - openCost
        : null,
  };
}

/** Run the ledger walk across a whole portfolio. */
export function computeGains(
  schemes: GainsScheme[],
  txns: GainsTxn[],
  ctx: GainsContext,
): SchemeGains[] {
  const bySchemeId = new Map<string, GainsTxn[]>();
  for (const t of txns) {
    if (!t.scheme_id) continue;
    const list = bySchemeId.get(t.scheme_id) ?? [];
    list.push(t);
    bySchemeId.set(t.scheme_id, list);
  }
  return schemes.map((s) => computeSchemeGains(s, bySchemeId.get(s.id) ?? [], ctx));
}

/* -------------------------------------------------------- year summaries -- */

export interface FyBucket {
  gain: number;
  /** Indicative tax where a statutory rate exists; null where it is at slab. */
  tax: number | null;
}

export interface FinancialYearGains {
  fy: string;
  equityLong: FyBucket;
  equityShort: FyBucket;
  nonEquityLong: FyBucket;
  /** Everything taxed at the client's own slab — a gain, never a tax. */
  slab: { gain: number };
  /** Gains on schemes whose composition is not yet decided. */
  undecided: { gain: number; schemes: string[] };
  /** Long-term equity gain exempted this year. */
  exemptionUsed: number;
  totalGain: number;
  /** Sum of the buckets where a rate applies. Excludes slab and undecided. */
  indicativeTax: number;
}

/**
 * The exemption on long-term equity gains, by financial year.
 *
 * ₹1L until FY 2023-24, ₹1.25L from FY 2024-25. It is a per-taxpayer annual
 * allowance, which is why it cannot be applied to a single disposal — only to
 * the year's total.
 */
function equityExemption(fy: string): number {
  const startYear = Number(fy.slice(0, 4));
  return startYear >= 2024 ? 125_000 : 100_000;
}

/**
 * Aggregate one financial year.
 *
 * The exemption and the netting of losses both happen here rather than per
 * disposal, because both are properties of the YEAR. A long-term loss on one
 * fund reduces the long-term gain on another before the exemption applies.
 *
 * PASS THE WHOLE PORTFOLIO'S DISPOSALS — `allDisposals(...)`, not one scheme's.
 * The ₹1.25L exemption belongs to the taxpayer, not to the fund. Called once per
 * scheme it is granted once per scheme, and a client holding eight funds is
 * shown a tax bill that is short by up to ₹1.25L of exemption per fund, which is
 * to say almost all of it. Nothing about the resulting screen looks wrong.
 */
export function summariseFinancialYear(disposals: Disposal[], fy: string): FinancialYearGains {
  const inYear = disposals.filter((d) => d.fy === fy);

  let equityLong = 0;
  let equityShort = 0;
  let nonEquityLong = 0;
  let slab = 0;
  let undecided = 0;
  const undecidedSchemes = new Set<string>();

  for (const d of inYear) {
    switch (d.treatment.kind) {
      case 'equity':
        if (d.treatment.term === 'long') equityLong += d.gain;
        else equityShort += d.gain;
        break;
      case 'non_equity':
        nonEquityLong += d.gain;
        break;
      case 'slab':
        slab += d.gain;
        break;
      case 'undecided':
        undecided += d.gain;
        undecidedSchemes.add(d.schemeName);
        break;
    }
  }

  const ltcgRate = inYear.find((d) => d.treatment.kind === 'equity' && d.treatment.term === 'long');
  const equityLongRate =
    ltcgRate && ltcgRate.treatment.kind === 'equity' ? ltcgRate.treatment.rate : 0.125;
  const shortRateSource = inYear.find(
    (d) => d.treatment.kind === 'equity' && d.treatment.term === 'short',
  );
  const equityShortRate =
    shortRateSource && shortRateSource.treatment.kind === 'equity' ? shortRateSource.treatment.rate : 0.2;

  // Only a positive long-term equity gain uses the exemption; a loss carries
  // forward and is not this module's business.
  const exemption = equityExemption(fy);
  const exemptionUsed = Math.max(0, Math.min(equityLong, exemption));
  const taxableEquityLong = Math.max(0, equityLong - exemption);

  const equityLongTax = taxableEquityLong * equityLongRate;
  const equityShortTax = Math.max(0, equityShort) * equityShortRate;
  const nonEquityLongTax = Math.max(0, nonEquityLong) * 0.125;

  return {
    fy,
    equityLong: { gain: equityLong, tax: equityLongTax },
    equityShort: { gain: equityShort, tax: equityShortTax },
    nonEquityLong: { gain: nonEquityLong, tax: nonEquityLongTax },
    slab: { gain: slab },
    undecided: { gain: undecided, schemes: [...undecidedSchemes] },
    exemptionUsed,
    totalGain: equityLong + equityShort + nonEquityLong + slab + undecided,
    indicativeTax: equityLongTax + equityShortTax + nonEquityLongTax,
  };
}

/* ---------------------------------------------------------------- labels -- */

/**
 * How a disposal's tax treatment reads to the client.
 *
 * Here rather than in the view because it is a statement about tax, not about
 * layout. "STCG · 20%" and "STCG · at your slab" look alike and mean very
 * different things, and the difference has to survive a refactor of the screen.
 *
 * Note what is never produced: a rate for a slab-taxed gain. The client's slab
 * is not known to us, and printing 30% because it is the common case would put a
 * number on screen that nobody computed.
 */
export function treatmentLabel(treatment: TaxTreatment): string {
  switch (treatment.kind) {
    case 'equity':
      return treatment.term === 'long'
        ? `LTCG · ${(treatment.rate * 100).toFixed(1)}%`
        : `STCG · ${(treatment.rate * 100).toFixed(0)}%`;
    case 'non_equity':
      return `LTCG · ${(treatment.rate * 100).toFixed(1)}%`;
    case 'slab':
      return `${treatment.term === 'long' ? 'LTCG' : 'STCG'} · at your slab`;
    case 'undecided':
      return 'Treatment pending';
  }
}

/**
 * A scheme name fit to put in a table cell.
 *
 * A registrar prints the fund's full legal identity, which carries every merger
 * and rename it has ever been through:
 *
 *   HDFC Balanced Advantage Fund - Direct Plan - Growth Option (formerly HDFC
 *   Growth Fund, erstwhile HDFC Prudence Fund merged) (Non-Demat)
 *
 * On a gains statement that name repeats on every matched lot — nine rows for
 * one redemption — and the numbers, which are the point of the screen, get
 * pushed off the side of it. The history is real but it is not what the client
 * came to read.
 *
 * Only ever for display. The Excel export keeps the name exactly as the
 * statement prints it, because that is the copy someone reconciles against the
 * CAS itself.
 */
export function displaySchemeName(name: string): string {
  return (
    name
      // The demat marker, in both spellings the registrars use.
      .replace(/\s*\(\s*Non[\s-]?Demat\s*\)/gi, '')
      .replace(/\s*\(\s*Demat\s*\)/gi, '')
      // "(formerly ...)" / "(erstwhile ...)" — a merger history, not an identity.
      .replace(/\s*\((?:formerly|erstwhile)[^)]*\)/gi, '')
      // A trailing "- Growth Option" reads the same as "- Growth".
      .replace(/\s*-\s*Growth Option\b/gi, ' - Growth')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}

/** Long or short, or an em dash where the term itself is not yet decided. */
export function termLabel(treatment: TaxTreatment): string {
  if (treatment.term === 'long') return 'Long term';
  if (treatment.term === 'short') return 'Short term';
  return '—';
}

/** Every financial year that has a disposal in it, newest first. */
export function financialYearsWithDisposals(disposals: Disposal[]): string[] {
  return [...new Set(disposals.map((d) => d.fy))].sort().reverse();
}

/** Flatten a portfolio's per-scheme results into one disposal list. */
export function allDisposals(schemes: SchemeGains[]): Disposal[] {
  return schemes.flatMap((s) => s.disposals);
}

/**
 * Schemes that could not be computed, for the notice the client is shown.
 *
 * Surfacing these is not optional: a gains statement that silently omits a fund
 * looks complete and understates the year.
 */
export function excludedSchemes(schemes: SchemeGains[]): { name: string; reason: string }[] {
  return schemes
    .filter((s) => !s.complete && s.incompleteReason)
    .map((s) => ({ name: s.schemeName, reason: s.incompleteReason as string }));
}

/** Schemes whose tax treatment is waiting on a human decision. */
export function undecidedSchemes(schemes: SchemeGains[]): string[] {
  return schemes.filter((s) => s.complete && !s.assetClass && s.disposals.length).map((s) => s.schemeName);
}
