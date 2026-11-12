/**
 * HoldingService
 * -----------------------------------------------------------------------------
 * The ONLY portal boundary that talks to Supabase for client wealth data.
 * Components and hooks call this; they never import `supabase` directly.
 *
 * This keeps the data source swappable: when holdings/transactions eventually
 * flow from a BSE-backed sync, only this file changes.
 *
 * ## One source per asset class, deliberately not merged
 *
 *   Mutual funds      the client's own CAS, once one has been imported and
 *                     reconciled; nw_holdings until then
 *   Bonds             nw_holdings
 *   Unlisted shares   nw_holdings
 *   Insurance         nw_holdings
 *   Fixed deposits    nw_holdings
 *
 * For mutual funds the two are alternatives rather than a union. A fund the
 * client bought through us appears in BOTH — in nw_holdings because we recorded
 * the sale, and in the CAS because the registrar did — so combining them would
 * list it twice and double its value. The CAS wins where it applies: it is
 * complete, covering funds bought elsewhere that we could never have recorded.
 *
 * Nothing else is touched by an import. A statement knows nothing about a bond
 * or a policy, so those rows pass straight through.
 */
import { clientSupabase as supabase } from '../../lib/supabase';
import type { NWClient, NWHolding, NWTransaction } from '../../crm/types';
import type { CasFreshness, PortalHolding } from '../types/cas';
import { CasPortfolioService } from './CasPortfolioService';
import { DematPortfolioService } from './DematPortfolioService';
import { mfSsoEnabled } from '../../platform/env';
import {
  applyNav,
  assessCasFreshness,
  folioIsinKey,
  portfolioDayChange,
  selectHoldings,
  sumRegistrarUnits,
  toNavQuotes,
  valuationDate,
  type CasCashFlow,
  type NavRow,
} from './cas/model';
import { MF_OWNERSHIP } from '../types/ownership';
import { isDemoClientSession, demoSnapshot } from '../demo/demoClient';
import { fetchRtaMf, fetchRtaTransactions, mergeByDateDesc, type RtaHoldingRow } from '../../mf/rtaMf';

/**
 * How far back to look for a quote.
 *
 * Long enough to cover a long weekend or a stalled feed, short enough that a
 * wound-up scheme's years-old final NAV is not presented as today's price. A
 * holding with nothing inside the window keeps whatever priced it before.
 */
const NAV_LOOKBACK_DAYS = 15;

/**
 * Current prices for every holding that can be priced.
 *
 * Deliberately not limited to statement-sourced funds: a fund bought through us
 * and recorded in the console is just as entitled to a current value, and it is
 * the same ISIN and the same feed. The only requirement is that someone said
 * WHICH scheme it is.
 */
async function loadNavQuotes(isins: string[]) {
  const unique = [...new Set(isins)].filter(Boolean);
  if (!unique.length) return new Map();
  const since = new Date(Date.now() - NAV_LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from('nav_daily')
    .select('isin,nav,nav_date')
    .in('isin', unique)
    .gte('nav_date', since)
    .order('nav_date', { ascending: false });
  if (error || !data) return new Map();
  return toNavQuotes(data as NavRow[]);
}

// Re-exported so existing importers of these from HoldingService keep working.
export { selectHoldings } from './cas/model';

export interface ClientWealthSnapshot {
  client: NWClient | null;
  holdings: PortalHolding[];
  transactions: NWTransaction[];
  /** Where the mutual fund holdings above came from. */
  mfSource: 'cas' | 'manual';
  /** The date the statement was drawn up to — MF figures are as of then. */
  casStatementTo: string | null;
  /** Whether our own records show mutual fund activity after that date. */
  casFreshness: CasFreshness;
  /**
   * Cash flows from the statement's own ledger, for a real money-weighted
   * return. Empty when no statement has been imported.
   */
  casFlows: CasCashFlow[];
  /**
   * False when the imported statement starts mid-history. Holdings stay correct;
   * the return is suppressed, because flows that do not explain the closing
   * value produce an answer that is not merely imprecise but absurd.
   */
  historyComplete: boolean;
  /** Where the statement's period begins, for explaining a suppressed return. */
  casStatementFrom: string | null;
  /** Value change across the last published NAV move; null when not revalued. */
  dayChange: number | null;
  /** The date the mutual fund valuations are as at, when newer than the statement. */
  valuedOn: string | null;
  /**
   * Inputs for a money-weighted return when mutual funds come from the
   * registrar (MF on platform). Only holdings whose cash flows fully explain
   * them are inside: non-MF holdings with ALL their recorded transactions, and
   * registrar funds whose imported transactions reconcile to the units held.
   * Funds the feeds cannot explain (missing redemptions, history before a broker
   * transfer, held-away funds) sit in `excludedValue` — left out of both sides,
   * never guessed. Absent off-platform, where the statement ledger is used.
   */
  xirrBasis?: {
    transactions: { txn_type: 'buy' | 'sell'; consolidated_amount: number; txn_date: string }[];
    extraFlows: CasCashFlow[];
    value: number;
    excludedValue: number;
  };
}

export const HoldingService = {
  /** Fetch the client, all holdings, and recent transactions in one round-trip. */
  async getSnapshot(clientId: string): Promise<ClientWealthSnapshot> {
    if (isDemoClientSession()) {
      return mfSsoEnabled() ? withoutMutualFunds(demoSnapshot()) : demoSnapshot();
    }
    // Mutual funds live on the MF platform: our in-house MF rows give way to the
    // daily registrar feed. An imported CAS is still read, though — it is the one
    // source for funds the client holds AWAY from us (other distributors), which
    // the registrar feed by definition cannot see.
    const mfOnPlatform = mfSsoEnabled();
    const [clientRes, holdingsRes, txnRes, latestMfRes, cas, demat] = await Promise.all([
      supabase.from('nw_clients').select('*').eq('id', clientId).maybeSingle(),
      supabase
        .from('nw_holdings')
        .select('*')
        .eq('client_id', clientId)
        .order('current_value', { ascending: false }),
      supabase
        .from('nw_transactions')
        .select('*')
        .eq('client_id', clientId)
        .order('txn_date', { ascending: false })
        .limit(25),
      /*
       * Asked for separately rather than scanned out of the 25 above: those are
       * the most recent transactions across ALL products, so a client with a
       * busy month of bond activity could push their latest fund transaction
       * out of the window and make a stale statement look current.
       */
      supabase
        .from('nw_transactions')
        .select('txn_date')
        .eq('client_id', clientId)
        .eq('product_type', 'mutual_fund')
        .order('txn_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      // Best-effort: a client with no import, or a failure reading one, still
      // gets the portfolio we hold for them rather than an error screen. Read on
      // the platform path too — not for the funds we service (the registrar feed
      // owns those) but for the held-away ones only a CAS carries.
      CasPortfolioService.getPortfolio(clientId).catch(() => null),
      // Demat holdings (shares, bonds, G-secs, NPS) from a CDSL eCAS. Best-effort:
      // a failure leaves the rest of the portfolio intact.
      DematPortfolioService.getPortfolio(clientId).catch(() => null),
    ]);

    const manual = (holdingsRes.data as NWHolding[]) ?? [];
    const latestOwnMfTxnDate = (latestMfRes.data?.txn_date as string) ?? null;
    const chosen = [
      ...selectHoldings(manual, cas?.holdings ?? null),
      ...(demat?.holdings ?? []),
    ].sort((a, b) => (b.current_value || 0) - (a.current_value || 0));

    /*
     * Price everything that carries an ISIN, from either source, in one query.
     * Best-effort throughout: a feed that is down or behind leaves each holding
     * at whatever priced it before rather than failing the portfolio.
     */
    const quotes = await loadNavQuotes(chosen.map((h) => h.cas?.isin ?? h.isin ?? ''));
    const holdings = chosen.map((h) => applyNav(h, quotes.get(h.cas?.isin ?? h.isin ?? '')));

    const snapshot: ClientWealthSnapshot = {
      client: (clientRes.data as NWClient) ?? null,
      holdings,
      transactions: (txnRes.data as NWTransaction[]) ?? [],
      mfSource: cas ? 'cas' : 'manual',
      casStatementTo: cas?.statementTo ?? null,
      casFreshness: assessCasFreshness(cas?.statementTo ?? null, latestOwnMfTxnDate),
      casFlows: cas?.flows ?? [],
      historyComplete: cas ? cas.historyComplete : true,
      casStatementFrom: cas?.statementFrom ?? null,
      dayChange: portfolioDayChange(holdings),
      valuedOn: valuationDate(holdings),
    };
    if (!mfOnPlatform) return snapshot;
    // Mutual funds run on the platform, so the registrar feed (mf_rta_*) is the
    // authoritative, daily source for funds the client holds THROUGH US; in-house
    // MF rows and the CAS copies of those same funds are dropped to avoid double
    // counting. On top of that we fold in the client's HELD-AWAY funds — the CAS
    // schemes not serviced under our ARN (is_ours = false), which the registrar
    // can never see — priced live by ISIN, so "external funds" actually appear.
    const stripped = withoutMutualFunds(snapshot);
    const rta = await fetchRtaMf(supabase, clientId).catch(() => null);
    const rtaAll = rta?.holdings ?? [];
    // Every registrar row is kept — the feed is the record of what we broker.
    const registrarMf = rtaAll.map((h) => toRegistrarMfHolding(clientId, h));

    /*
     * Split each CAS mutual fund into what we broker and what the client holds
     * away. The registrar feed carries only transactions under our ARN, so its
     * units ARE the Niyom-serviced portion of a folio; units the CAS shows beyond
     * that were bought elsewhere (a prior distributor, or before a SIP moved to
     * us) and are HELD AWAY. The excess is priced live by ISIN and labelled as
     * such, so a part-transferred folio reads honestly — part "Held with Niyom"
     * (the registrar row), part "Held away" (this slice) — instead of being shown
     * entirely as ours or entirely away.
     *
     * A fund we fully service yields no excess (registrar = CAS); a fund bought
     * entirely elsewhere yields all of it (registrar = 0), the ordinary held-away
     * case. The registrar is never contradicted downward: if it shows more units
     * than the CAS (a redemption the CAS predates), the excess is nil.
     */
    const registrarUnits = sumRegistrarUnits(
      rtaAll.map((h) => ({ folio: h.folio, isin: h.isin, units: h.units, snapshotDate: h.snapshotDate })),
    );
    const heldAwaySlices = (cas?.holdings ?? [])
      .filter((h) => h.product_type === 'mutual_fund' && h.cas != null)
      .map((h) => {
        const casUnits = Number(h.quantity) || h.cas!.units;
        const key = folioIsinKey(h.folio_number ?? h.cas!.folioNumber, h.cas!.isin ?? h.isin);
        return { h, casUnits, excess: casUnits - (registrarUnits.get(key) ?? 0) };
      })
      .filter((x) => x.excess > HELD_AWAY_UNIT_EPSILON);
    const heldAwayQuotes = await loadNavQuotes(heldAwaySlices.map((x) => x.h.cas?.isin ?? x.h.isin ?? ''));
    const heldAway = heldAwaySlices.map(({ h, casUnits, excess }) =>
      applyNav(heldAwayHolding(h, excess, casUnits), heldAwayQuotes.get(h.cas?.isin ?? h.isin ?? '')),
    );

    const merged = [...stripped.holdings, ...registrarMf, ...heldAway];

    // XIRR basis — see ClientWealthSnapshot.xirrBasis. Every non-MF transaction
    // (the snapshot above keeps only the latest 25 for display).
    const { data: allTxns } = await supabase
      .from('nw_transactions')
      .select('txn_type, consolidated_amount, txn_date, product_type')
      .eq('client_id', clientId)
      .neq('product_type', 'mutual_fund');
    // The registrar feed (what we broker) drives the return; the held-away
    // slices sit in excludedValue — they are the same funds' other units, priced
    // from the CAS with no flows of ours, so they are value without a return.
    const regValue = (h: RtaHoldingRow) => h.rtaValue ?? h.navValue ?? (h.nav != null ? h.units * h.nav : 0);
    const reconciled = rtaAll.filter((h) => h.reconciled && h.flows.length);
    const nonMfValue = stripped.holdings.reduce((t, h) => t + (Number(h.current_value) || 0), 0);
    const xirrBasis = {
      transactions: ((allTxns ?? []) as { txn_type: 'buy' | 'sell'; consolidated_amount: number; txn_date: string }[]),
      extraFlows: reconciled.flatMap((h) => h.flows),
      value: nonMfValue + reconciled.reduce((t, h) => t + regValue(h), 0),
      excludedValue:
        rtaAll.filter((h) => !(h.reconciled && h.flows.length)).reduce((t, h) => t + regValue(h), 0) +
        heldAway.reduce((t, h) => t + (Number(h.current_value) || 0), 0),
    };

    // The activity list: our non-MF records plus the registrar's fund
    // transactions (in-house MF rows were dropped above, so nothing doubles).
    const rtaTxns = await fetchRtaTransactions(supabase, clientId, 25);

    return {
      xirrBasis,
      ...stripped,
      holdings: merged,
      transactions: mergeByDateDesc(stripped.transactions, rtaTxns, 25),
      // A statement was imported — carry its context (held-away funds are stated
      // as of its date) even though the registrar drives the funds we service.
      mfSource: cas ? 'cas' : stripped.mfSource,
      casStatementTo: cas?.statementTo ?? null,
      casStatementFrom: cas?.statementFrom ?? null,
      casFlows: cas?.flows ?? [],
      casFreshness: assessCasFreshness(cas?.statementTo ?? null, latestOwnMfTxnDate),
      historyComplete: cas ? cas.historyComplete : true,
      valuedOn: rta?.navDate ?? rta?.snapshotDate ?? valuationDate(merged),
      dayChange: portfolioDayChange(merged),
    };
  },
};

/** Units at or below this count as fully brokered (registrar ≈ CAS). */
const HELD_AWAY_UNIT_EPSILON = 0.001;

/**
 * The held-away slice of a CAS fund: the units beyond what the registrar shows
 * we broker. A clone of the CAS holding trimmed to the excess units, with cost
 * prorated by the unit share and ownership forced to "held away" — so the Niyom
 * row (the registrar feed) and this slice never claim the same units, and a
 * part-transferred folio is not mislabelled as entirely ours. Left to applyNav
 * at the caller to value the excess units at the latest NAV.
 */
function heldAwayHolding(h: PortalHolding, excessUnits: number, casUnits: number): PortalHolding {
  const fraction = casUnits > 0 ? Math.min(1, excessUnits / casUnits) : 1;
  return {
    ...h,
    id: `${h.id}-away`,
    quantity: excessUnits,
    invested_amount: (Number(h.invested_amount) || 0) * fraction,
    // applyNav recomputes current_value from excessUnits × NAV; this prorated
    // seed keeps an un-priced row sensible rather than showing the whole folio.
    current_value: (Number(h.current_value) || 0) * fraction,
    cas: h.cas
      ? { ...h.cas, units: excessUnits, isOurs: false, ownership: MF_OWNERSHIP.heldAway }
      : h.cas,
  };
}

/**
 * A registrar-fed mutual-fund holding as a PortalHolding. When the transaction
 * feed has given us a cost basis (investedCost), invested and avg_cost reflect
 * the real money put in, so gain is genuine. Without it we fall back to
 * invested = value — the fund shows its real worth and no invented gain. Priced
 * already (current_value set), so it bypasses the NAV repricing that keys off ISIN.
 */
function toRegistrarMfHolding(clientId: string, h: RtaHoldingRow): PortalHolding {
  const value = h.rtaValue ?? h.navValue ?? (h.nav != null ? h.units * h.nav : 0);
  const invested = h.investedCost != null ? h.investedCost : value;
  const now = new Date().toISOString();
  return {
    id: `rta-${h.id}`,
    client_id: clientId,
    product_type: 'mutual_fund',
    product_name: h.schemeName ?? h.schemeCode,
    quantity: h.units,
    avg_cost: h.investedCost != null && h.units > 0 ? h.investedCost / h.units : 0,
    current_value: value,
    invested_amount: invested,
    maturity_date: '',
    notes: '',
    // Earliest purchase from the transaction feed, when known — the client's
    // real "invested since" date; else the snapshot date.
    created_at: h.firstInvestmentDate ? `${h.firstInvestmentDate}T00:00:00.000Z` : now,
    updated_at: now,
    folio_number: h.folio,
    fund_house: h.amcCode ?? undefined,
    current_nav: h.nav ?? undefined,
    nav_date: h.navDate ?? h.snapshotDate ?? undefined,
  };
}

/**
 * The snapshot with every mutual fund trace removed. Once mutual funds run on
 * the MF platform, that platform is the record: an older Niyom row or an
 * imported statement next to it would be stale at best and double-counted at
 * worst. The rows stay in the database; they are only kept out of view and out
 * of every total, return and allocation built from this snapshot.
 */
function withoutMutualFunds(s: ClientWealthSnapshot): ClientWealthSnapshot {
  const holdings = s.holdings.filter((h) => h.product_type !== 'mutual_fund');
  return {
    ...s,
    holdings,
    transactions: s.transactions.filter((t) => t.product_type !== 'mutual_fund'),
    mfSource: 'manual',
    casStatementTo: null,
    casFreshness: { state: 'none', statementTo: null, latestOwnMfTxnDate: null },
    casFlows: [],
    historyComplete: true,
    casStatementFrom: null,
    dayChange: portfolioDayChange(holdings),
    valuedOn: valuationDate(holdings),
  };
}
