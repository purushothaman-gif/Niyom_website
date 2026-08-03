/**
 * CAS domain logic — pure, no I/O.
 *
 * Split out from CasPortfolioService deliberately. Everything here is a
 * decision (is this holding ours, is this a cash flow, which source wins, is
 * the statement stale) and every one of those decisions is wrong in a way that
 * looks completely normal on screen. Keeping them free of Supabase means they
 * can be tested directly rather than through a mocked client.
 *
 * The service module above this one does the fetching and calls in here.
 */
import type { NWHolding } from '../../../crm/types';
import type { CasFreshness, CasHoldingMeta, PortalHolding } from '../../types/cas';
import { ownershipOf } from '../../types/ownership';

/** A cash flow as the investor experienced it: negative paid in, positive received. */
export interface CasCashFlow {
  amount: number;
  date: string;
}

/** A cas_schemes row joined to its folio, as the portal reads it. */
export interface CasSchemeRow {
  id: string;
  name: string;
  units: number | null;
  nav: number | null;
  nav_date: string | null;
  value: number | null;
  cost: number | null;
  isin: string | null;
  rta: string | null;
  rta_code: string | null;
  advisor_code: string | null;
  is_ours: boolean | null;
  cas_folios: { folio_number: string; amc: string | null; registrar: string | null } | null;
}

export interface CasTxnRow {
  scheme_id?: string | null;
  txn_date: string;
  txn_type: string | null;
  amount: number | null;
  units: number | null;
}

/* ------------------------------------------------------------- cash flows -- */

/**
 * Which ledger entries are money entering or leaving the INVESTOR's pocket.
 *
 * A CAS prints amounts from the fund's point of view, so the sign has to be
 * decided per type rather than flipped wholesale:
 *
 *   purchases and charges   the investor pays        -> negative
 *   redemptions             the investor receives    -> positive
 *   dividend PAYOUTS        the investor receives    -> positive
 *
 * Two kinds are excluded on purpose. A switch moves money between schemes
 * without any of it reaching the investor, so counting both legs would add
 * noise to a portfolio-level return that they cancel out of anyway. And a
 * dividend carrying units is a REINVESTMENT — no cash changed hands, which is
 * exactly what distinguishes it from a payout.
 */
export function toFlow(t: CasTxnRow): CasCashFlow | null {
  const amount = Math.abs(Number(t.amount) || 0);
  if (!amount || !t.txn_date) return null;
  switch (t.txn_type) {
    case 'PURCHASE':
    case 'STT':
    case 'STAMP_DUTY':
      return { amount: -amount, date: t.txn_date };
    // REFUND is money the AMC could not invest and sent back — cash returned to
    // the investor, even though no units were sold.
    case 'REDEMPTION':
    case 'REFUND':
      return { amount, date: t.txn_date };
    case 'DIVIDEND':
      return Number(t.units) ? null : { amount, date: t.txn_date };
    default:
      return null;
  }
}

/* ---------------------------------------------------------------- mapping -- */

/**
 * A CAS scheme in the shape the rest of the portal already speaks.
 *
 * Mapping into NWHolding rather than introducing a parallel type means every
 * aggregate, breakdown and table keeps working untouched — the portfolio screen
 * does not need to know where a holding came from. The statement's own details
 * ride along in `cas` for the badge and for a future migration.
 */
export function toHolding(
  s: CasSchemeRow,
  ctx: { clientId: string; importId: string; importedAt: string; statementTo: string | null },
): PortalHolding {
  const units = Number(s.units) || 0;
  const value = Number(s.value) || 0;
  const cost = Number(s.cost) || 0;
  const folio = s.cas_folios?.folio_number ?? '';
  const amc = s.cas_folios?.amc ?? null;
  const registrar = s.rta ?? s.cas_folios?.registrar ?? null;

  const cas: CasHoldingMeta = {
    source: 'cas',
    importId: ctx.importId,
    importedAt: ctx.importedAt,
    statementTo: ctx.statementTo,
    schemeId: s.id,
    isin: s.isin,
    rtaCode: s.rta_code,
    schemeName: s.name,
    amc,
    folioNumber: folio,
    registrar,
    units,
    value,
    cost,
    navDate: s.nav_date,
    advisorCode: s.advisor_code,
    isOurs: Boolean(s.is_ours),
    ownership: ownershipOf(s.advisor_code, s.is_ours),
  };

  return {
    id: s.id,
    client_id: ctx.clientId,
    product_type: 'mutual_fund',
    product_name: s.name,
    quantity: units,
    avg_cost: units > 0 ? cost / units : 0,
    current_value: value,
    invested_amount: cost,
    maturity_date: '',
    notes: '',
    created_at: ctx.importedAt,
    updated_at: ctx.importedAt,
    folio_number: folio || undefined,
    // Only a DETAILED statement names the AMC; a summary does not, and guessing
    // it from the scheme name would put funds under the wrong house.
    fund_house: amc ?? undefined,
    // A CAS never states a scheme category. Left empty so the classifier falls
    // back to the scheme name instead of inventing one.
    scheme_type: undefined,
    isin: s.isin,
    nav_date: s.nav_date,
    current_nav: Number(s.nav) || null,
    cas,
  };
}

/**
 * Fully exited funds stay in the statement because they carry realised gains,
 * but they are not holdings and must not appear on a holdings list.
 */
export const isOpenPosition = (s: CasSchemeRow): boolean =>
  (Number(s.value) || 0) > 0 || (Number(s.units) || 0) > 0;

/* ----------------------------------------------------------- source choice -- */

/**
 * Choose between the two sources for mutual funds.
 *
 * Separate and named because getting this wrong is invisible and expensive:
 * concatenating instead of replacing shows every fund bought through us twice
 * and doubles the client's net worth, and nothing about the resulting screen
 * looks broken.
 *
 * Only mutual funds are affected. Bonds, insurance, fixed deposits and unlisted
 * shares always come from nw_holdings — a statement knows nothing about them,
 * and they carry DSA pricing and trail fields no CAS could supply.
 */
export function selectHoldings(
  manual: NWHolding[],
  casHoldings: PortalHolding[] | null,
): PortalHolding[] {
  if (!casHoldings) return manual;
  return [...manual.filter((h) => h.product_type !== 'mutual_fund'), ...casHoldings].sort(
    (a, b) => (b.current_value || 0) - (a.current_value || 0),
  );
}

/* -------------------------------------------------------------- freshness -- */

/**
 * Is the imported picture still current?
 *
 * A CAS is a snapshot as at its statement date. Anything the client does with
 * us afterwards — a purchase, a redemption — is real and recorded, but will not
 * appear in the imported holdings until they import a newer statement. The
 * client should be told that rather than left to notice the discrepancy.
 *
 * Only OUR OWN mutual fund transactions can prove this. A bond purchase after
 * the statement date says nothing about whether the fund picture is behind, and
 * warning on it would train people to ignore the notice.
 *
 * Compared as ISO date strings, which sort lexicographically — no timezone
 * shifting, which is what makes a same-day comparison flip around midnight UTC.
 */
export function assessCasFreshness(
  statementTo: string | null,
  latestOwnMfTxnDate: string | null,
): CasFreshness {
  if (!statementTo) {
    return { state: 'none', statementTo: null, latestOwnMfTxnDate: latestOwnMfTxnDate ?? null };
  }
  const stale = Boolean(latestOwnMfTxnDate && latestOwnMfTxnDate.slice(0, 10) > statementTo.slice(0, 10));
  return {
    state: stale ? 'stale' : 'current',
    statementTo,
    latestOwnMfTxnDate: latestOwnMfTxnDate ?? null,
  };
}

/* -------------------------------------------------------------- migration -- */

/**
 * The folios a future ARN migration could act on.
 *
 * Held-away only, and never `unknown`: a summary statement names no distributor
 * at all, and offering to move a folio on that basis could mean "migrating"
 * something already ours. The wizard is not built yet — this exists so that
 * when it is, it reads a list rather than re-parsing anyone's statement.
 */
export function migrationCandidates(holdings: PortalHolding[]): CasHoldingMeta[] {
  return holdings
    .map((h) => h.cas)
    .filter((c): c is CasHoldingMeta => !!c && c.ownership === 'held_away');
}

/* --------------------------------------------------------------- valuation -- */

/** The latest published NAV for one scheme, and the one before it. */
export interface NavQuote {
  isin: string;
  nav: number;
  navDate: string;
  /** The prior published NAV, for the day's change. Null when there is no prior. */
  previousNav: number | null;
}

/** A nav_daily row as read from the database. */
export interface NavRow {
  isin: string;
  nav: number | string;
  nav_date: string;
}

/**
 * Reduce raw NAV rows to one quote per scheme.
 *
 * "Latest" is per ISIN, never a single portfolio-wide date: a wound-up fund
 * keeps its final NAV for years, and taking the newest date across the whole
 * file would leave those schemes with no quote at all rather than their real
 * last price.
 */
export function toNavQuotes(rows: NavRow[]): Map<string, NavQuote> {
  const byIsin = new Map<string, NavRow[]>();
  for (const r of rows) {
    const list = byIsin.get(r.isin) ?? [];
    list.push(r);
    byIsin.set(r.isin, list);
  }

  const out = new Map<string, NavQuote>();
  for (const [isin, list] of byIsin) {
    // Sorted here rather than trusted from the query: correctness should not
    // depend on a caller remembering an ORDER BY.
    const sorted = [...list].sort((a, b) => (a.nav_date < b.nav_date ? 1 : -1));
    const latest = sorted[0];
    const prior = sorted.find((r) => r.nav_date < latest.nav_date);
    out.set(isin, {
      isin,
      nav: Number(latest.nav),
      navDate: latest.nav_date.slice(0, 10),
      previousNav: prior ? Number(prior.nav) : null,
    });
  }
  return out;
}

/**
 * Revalue a statement holding at the latest published NAV.
 *
 * A CAS is a snapshot: without this, a client's portfolio is frozen on the day
 * they imported it. With it, the VALUE moves daily while the UNITS stay as at
 * the statement — which is why the staleness notice still matters and this is
 * not a substitute for importing a newer statement.
 *
 * Returns the holding untouched when there is nothing newer to apply. Showing
 * the statement's own valuation is right in that case; inventing a movement
 * would not be.
 */
export function applyNav(h: PortalHolding, quote: NavQuote | undefined): PortalHolding {
  if (!quote || !Number.isFinite(quote.nav) || quote.nav <= 0) return h;

  /*
   * Only ever move forward. Whatever priced this holding already — a statement,
   * or a figure staff entered when they recorded the purchase — a NAV at or
   * before that date says nothing new, and applying it would only add noise.
   */
  const pricedOn = (h.cas?.navDate ?? h.nav_date ?? '').slice(0, 10);
  if (pricedOn && quote.navDate <= pricedOn) return h;

  const units = h.quantity || 0;
  if (!units) return h;

  const value = units * quote.nav;
  const dayChange =
    quote.previousNav && quote.previousNav > 0 ? units * (quote.nav - quote.previousNav) : null;

  return {
    ...h,
    current_value: Number(value.toFixed(2)),
    current_nav: quote.nav,
    nav_date: quote.navDate,
    liveNav: {
      nav: quote.nav,
      navDate: quote.navDate,
      dayChange: dayChange === null ? null : Number(dayChange.toFixed(2)),
    },
    // Keep the statement block's own value in step when there is one.
    ...(h.cas ? { cas: { ...h.cas, value: Number(value.toFixed(2)) } } : {}),
  };
}

/** Total value change across the last published NAV move. Null when nothing was revalued. */
export function portfolioDayChange(holdings: PortalHolding[]): number | null {
  const changes = holdings
    .map((h) => h.liveNav?.dayChange)
    .filter((c): c is number => typeof c === 'number');
  return changes.length ? Number(changes.reduce((s, c) => s + c, 0).toFixed(2)) : null;
}

/** The date the revalued figures are as at, or null if nothing was revalued. */
export function valuationDate(holdings: PortalHolding[]): string | null {
  const dates = holdings.map((h) => h.liveNav?.navDate).filter((d): d is string => !!d);
  return dates.length ? dates.sort().slice(-1)[0] : null;
}

/* ------------------------------------------------------- history coverage -- */

/**
 * Does the ledger explain every unit the client holds?
 *
 * A CAS can be requested for any period, and CAMS defaults to the current
 * financial year. Ask for that and the statement opens with units the client
 * already held — real holdings, bought with money that appears nowhere in the
 * file. The reconciliation gate is satisfied, because the statement's own
 * arithmetic (opening + ledger = closing) still balances. The holdings and
 * their value are correct.
 *
 * But a money-weighted return computed from those flows is not, and not by a
 * little: it sees redemptions with no matching purchase and a closing value
 * that came from nowhere. One real client was shown 198,502%.
 *
 * So this asks the one question XIRR depends on — is every unit accounted for
 * by a transaction we can see — by summing the ledger per scheme and comparing
 * with the closing balance. Any shortfall is an opening balance, and an opening
 * balance means the history is truncated.
 */
export function hasCompleteHistory(
  schemes: { id: string; units: number | null }[],
  txns: { scheme_id?: string | null; units: number | null }[],
): boolean {
  const ledger = new Map<string, number>();
  for (const t of txns) {
    if (!t.scheme_id) continue;
    ledger.set(t.scheme_id, (ledger.get(t.scheme_id) ?? 0) + (Number(t.units) || 0));
  }
  return schemes.every((s) => {
    const closing = Number(s.units) || 0;
    const summed = ledger.get(s.id) ?? 0;
    // Units run to three decimals; the same tolerance the gate uses.
    return Math.abs(closing - summed) <= 0.001;
  });
}
