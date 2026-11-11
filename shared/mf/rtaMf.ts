/**
 * Read a client's registrar-sourced mutual-fund position — the holdings and
 * systematic registrations imported daily from the CAMS/KFintech mailback feeds
 * (mf_rta_* tables). One copy, used by both the client portal (its own 'client'
 * surface) and the CRM (the staff 'default' surface); RLS scopes each caller to
 * what they may see, so the same query is safe from either.
 *
 * This is read-only evidence from the registrar, deliberately kept apart from
 * the in-house book (nw_holdings) and the BSE order rail — it is what the client
 * actually holds, refreshed without anyone lifting a finger.
 */
import type { NiyomDb } from '../platform/db';
import type { NWTransaction } from '../crm/types';

export interface RtaHoldingRow {
  id: string;
  folio: string;
  schemeName: string | null;
  schemeCode: string;
  amcCode: string | null;
  units: number;
  /**
   * Current value: units at the newest NAV we have — the daily AMFI NAV for the
   * resolved ISIN, or the registrar's own when that is newer (mf_rta_holdings
   * .live_value). Falls back to the registrar's valuation when the scheme could
   * not be resolved. Every surface reads this, so registrar funds move with the
   * market daily instead of freezing at the last mailback.
   */
  rtaValue: number | null;
  /** The registrar's own valuation (RUPEE_BAL) as of snapshotDate, untouched. */
  registrarValue: number | null;
  /** NAV behind rtaValue (live when priced, else the registrar's). */
  nav: number | null;
  navValue: number | null;
  /** Date of `nav` — the AMFI NAV date when live-priced, else snapshotDate. */
  navDate: string | null;
  /** AMFI ISIN resolved from the scheme name, when known. */
  isin: string | null;
  /** Date of the registrar snapshot the UNITS come from. */
  snapshotDate: string | null;
  /** Cost of acquisition: the registrar's own valuation cost (WBR53) when we have it — authoritative, and the only source that covers units transferred in from a prior broker — else net purchases−redemptions from the transaction feed, else null. */
  investedCost: number | null;
  /** Earliest purchase trade date from the transaction feed, or null. */
  firstInvestmentDate: string | null;
  /**
   * True when the imported transactions explain every unit held (net units
   * from the feed = units held). Only then is the feed's cost trusted, and only
   * then are its cash flows usable for a money-weighted return — a feed that
   * misses a redemption, or the purchases before a broker transfer, would
   * otherwise produce a confident but wrong figure.
   */
  reconciled: boolean;
  /** Investor-signed cash flows (invest = negative), present only when reconciled. */
  flows: { date: string; amount: number }[];
}

export interface RtaSipRow {
  id: string;
  folio: string;
  schemeName: string | null;
  schemeCode: string;
  type: string | null;         // SIP | STP | SWP
  amount: number | null;
  frequency: string | null;
  sipDay: string | null;
  status: 'active' | 'paused' | 'ceased' | string;
  fromDate: string | null;
  toDate: string | null;
}

export interface RtaMfData {
  holdings: RtaHoldingRow[];
  sips: RtaSipRow[];
  /** Registrar valuation (RUPEE_BAL) total; falls back to units*nav. */
  totalValue: number;
  /** Net invested across holdings that have transaction history, or null when none do. */
  totalInvested: number | null;
  /** Most recent holdings snapshot across the client's folios. */
  snapshotDate: string | null;
  /** Newest NAV date the holdings are valued at (live AMFI price when known). */
  navDate: string | null;
  hasData: boolean;
}

const EMPTY: RtaMfData = { holdings: [], sips: [], totalValue: 0, totalInvested: null, snapshotDate: null, navDate: null, hasData: false };

// Transaction directions that add to / subtract from invested cost.
const INFLOW = new Set(['purchase', 'sip', 'switch_in']);
const OUTFLOW = new Set(['redemption', 'switch_out']);

interface TxnAgg {
  invested: number;
  first: string | null;
  seen: boolean;
  netUnits: number;
  flows: { date: string; amount: number }[];
}

const newAgg = (): TxnAgg => ({ invested: 0, first: null, seen: false, netUnits: 0, flows: [] });

function foldTxn(agg: TxnAgg, kind: string, amount: number, units: number, tradeDate: string | null): void {
  if (INFLOW.has(kind)) {
    agg.invested += amount;
    agg.netUnits += Math.abs(units);
    agg.seen = true;
    if (tradeDate && (!agg.first || tradeDate < agg.first)) agg.first = tradeDate;
    if (tradeDate && amount) agg.flows.push({ date: tradeDate, amount: -Math.abs(amount) });
  } else if (OUTFLOW.has(kind)) {
    agg.invested -= amount;
    agg.netUnits -= Math.abs(units);
    agg.seen = true;
    if (tradeDate && amount) agg.flows.push({ date: tradeDate, amount: Math.abs(amount) });
  }
}

/** Do the feed's net units explain the units held (0.1% / 0.01-unit tolerance)? */
export function unitsReconcile(held: number, net: number): boolean {
  return Math.abs(held - net) <= Math.max(0.01, Math.abs(held) * 0.001);
}

export async function fetchRtaMf(db: NiyomDb, clientId: string): Promise<RtaMfData> {
  if (!clientId) return EMPTY;

  // The client's folios first — holdings have no client_id of their own, they
  // hang off the folio. (RLS would hide other clients' rows anyway; this also
  // keeps the holdings query to this client's folios without an embed.)
  const { data: folios, error: fErr } = await db
    .from('mf_rta_folios')
    .select('id')
    .eq('client_id', clientId);
  if (fErr) throw new Error(fErr.message);
  const folioIds = (folios ?? []).map((f) => f.id);

  const [holdingsRes, sipsRes, txnsRes] = await Promise.all([
    folioIds.length
      ? db
          .from('mf_rta_holdings')
          .select('id, folio, scheme_name, scheme_code, amc_code, units, rta_value, nav, nav_value, snapshot_date, invested_cost, isin, live_nav, live_nav_date, live_value')
          .in('folio_id', folioIds)
      : Promise.resolve({ data: [], error: null }),
    db
      .from('mf_rta_sips')
      .select('id, folio, scheme_name, scheme_code, txn_type, amount, frequency, sip_day, status, from_date, to_date')
      .eq('client_id', clientId),
    db
      .from('mf_rta_transactions')
      .select('folio, scheme_code, txn_kind, amount, units, trade_date')
      .eq('client_id', clientId),
  ]);
  if (holdingsRes.error) throw new Error(holdingsRes.error.message);
  if (sipsRes.error) throw new Error(sipsRes.error.message);
  // Transactions are additive: if they can't be read (older DB, RLS), the view
  // falls back to value-only exactly as before rather than failing.
  const txnRows = (txnsRes.error ? [] : txnsRes.data) ?? [];

  // Aggregate invested cost + first purchase date per (folio, scheme) and per
  // folio. The scheme-level key is preferred; the folio-level one is a fallback
  // for folios that hold a single scheme (where the transaction feed's product
  // code may be formatted differently from the holdings feed's).
  const byScheme = new Map<string, TxnAgg>();
  const byFolio = new Map<string, TxnAgg>();
  const schemeKey = (folio: string, code: string) => `${folio}\u0000${code}`;
  for (const t of txnRows) {
    const amount = Number(t.amount ?? 0);
    const units = Number((t as { units?: number | string | null }).units ?? 0);
    const kind = (t.txn_kind ?? 'other') as string;
    const sk = schemeKey(t.folio, t.scheme_code);
    if (!byScheme.has(sk)) byScheme.set(sk, newAgg());
    if (!byFolio.has(t.folio)) byFolio.set(t.folio, newAgg());
    foldTxn(byScheme.get(sk)!, kind, amount, units, t.trade_date);
    foldTxn(byFolio.get(t.folio)!, kind, amount, units, t.trade_date);
  }

  const rawHoldings = (holdingsRes.data ?? []);
  const holdingsPerFolio = new Map<string, number>();
  for (const h of rawHoldings) holdingsPerFolio.set(h.folio, (holdingsPerFolio.get(h.folio) ?? 0) + 1);

  const holdings: RtaHoldingRow[] = rawHoldings
    .map((h) => {
      const exact = byScheme.get(schemeKey(h.folio, h.scheme_code));
      const folioOnly = holdingsPerFolio.get(h.folio) === 1 ? byFolio.get(h.folio) : undefined;
      const agg = exact?.seen ? exact : folioOnly?.seen ? folioOnly : null;
      // Prefer the registrar's own valuation cost (WBR53) when present: it is the
      // authoritative cost of acquisition and the only source that covers units
      // transferred in from a prior broker, which the transaction feed misses.
      // Fall back to the transaction-derived net investment otherwise.
      const registrarCost = h.invested_cost == null ? null : Number(h.invested_cost);
      const held = Number(h.units ?? 0);
      const reconciled = !!agg && unitsReconcile(held, agg.netUnits);
      // The feed's cost is only a cost when its units add up to what is held.
      const txnCost = agg && reconciled ? Math.max(0, Math.round(agg.invested * 100) / 100) : null;
      return {
        id: h.id,
        folio: h.folio,
        schemeName: h.scheme_name,
        schemeCode: h.scheme_code,
        amcCode: h.amc_code,
        units: Number(h.units ?? 0),
        rtaValue: h.live_value != null ? Number(h.live_value) : h.rta_value == null ? null : Number(h.rta_value),
        registrarValue: h.rta_value == null ? null : Number(h.rta_value),
        nav: h.live_nav != null ? Number(h.live_nav) : h.nav == null ? null : Number(h.nav),
        navValue: h.nav_value == null ? null : Number(h.nav_value),
        navDate: h.live_nav_date ?? h.snapshot_date,
        isin: h.isin ?? null,
        snapshotDate: h.snapshot_date,
        investedCost: registrarCost != null ? registrarCost : txnCost,
        firstInvestmentDate: agg ? agg.first : null,
        reconciled,
        flows: reconciled && agg ? agg.flows : [],
      };
    })
    // Registrar value when present, else units*nav; biggest first.
    .sort((a, b) => valueOf(b) - valueOf(a));

  const rank: Record<string, number> = { active: 0, paused: 1, ceased: 2 };
  const sips: RtaSipRow[] = (sipsRes.data ?? [])
    .map((s) => ({
      id: s.id,
      folio: s.folio,
      schemeName: s.scheme_name,
      schemeCode: s.scheme_code,
      type: s.txn_type,
      amount: s.amount == null ? null : Number(s.amount),
      frequency: s.frequency,
      sipDay: s.sip_day,
      status: (s.status ?? 'active') as RtaSipRow['status'],
      fromDate: s.from_date,
      toDate: s.to_date,
    }))
    .sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || (b.amount ?? 0) - (a.amount ?? 0));

  const totalValue = holdings.reduce((sum, h) => sum + valueOf(h), 0);
  const anyCost = holdings.some((h) => h.investedCost != null);
  const totalInvested = anyCost
    ? holdings.reduce((sum, h) => sum + (h.investedCost ?? valueOf(h)), 0)
    : null;
  const snapshotDate = holdings.reduce<string | null>(
    (m, h) => (h.snapshotDate && (!m || h.snapshotDate > m) ? h.snapshotDate : m),
    null,
  );

  const navDate = holdings.reduce<string | null>(
    (m, h) => (h.navDate && (!m || h.navDate > m) ? h.navDate : m),
    null,
  );

  return { holdings, sips, totalValue, totalInvested, snapshotDate, navDate, hasData: holdings.length > 0 || sips.length > 0 };
}

/**
 * The "as of" line for a registrar MF block. Units come from the registrar
 * snapshot; values come from the NAV date (the daily AMFI NAV since
 * 2026-11-12). When the two dates differ both are named, so a feed date is
 * never mistaken for the pricing date. `fmt` is the surface's date formatter.
 */
export function rtaAsOfLabel(
  d: Pick<RtaMfData, 'snapshotDate' | 'navDate'>,
  fmt: (iso: string) => string,
): string | null {
  const { snapshotDate: units, navDate: nav } = d;
  if (units && nav && units !== nav) return `units as of ${fmt(units)} · NAV ${fmt(nav)}`;
  const one = nav ?? units;
  return one ? `as of ${fmt(one)}` : null;
}

function valueOf(h: RtaHoldingRow): number {
  if (h.rtaValue != null) return h.rtaValue;
  if (h.navValue != null) return h.navValue;
  if (h.nav != null) return h.units * h.nav;
  return 0;
}

/* ---------------------------------------------------------------------------
 * Registrar transactions (mf_rta_transactions) as the portal's transaction
 * rows. Once mutual funds run on the platform, in-house MF rows are dropped
 * from every list (the registrar is the record) — these take their place, so a
 * client who only holds funds no longer sees an empty history.
 * ------------------------------------------------------------------------- */
/** How each registrar transaction kind reads to a client. Others are not shown. */
export const RTA_TXN_LABEL: Record<string, { label: string; side: 'buy' | 'sell' }> = {
  purchase: { label: 'Purchase', side: 'buy' },
  sip: { label: 'SIP', side: 'buy' },
  switch_in: { label: 'Switch in', side: 'buy' },
  redemption: { label: 'Redemption', side: 'sell' },
  switch_out: { label: 'Switch out', side: 'sell' },
};

/**
 * The client's registrar fund transactions, newest first, in NWTransaction
 * shape (id prefixed `rta-`, the kind's label in `notes`). RLS scopes rows to
 * the caller. Best-effort: a read failure returns [] so lists still render.
 */
export async function fetchRtaTransactions(db: NiyomDb, clientId: string, limit?: number): Promise<NWTransaction[]> {
  if (!clientId) return [];
  let q = db
    .from('mf_rta_transactions')
    .select('id, scheme_name, scheme_code, folio, txn_kind, amount, units, nav, trade_date, post_date, created_at')
    .eq('client_id', clientId)
    .in('txn_kind', Object.keys(RTA_TXN_LABEL))
    .order('trade_date', { ascending: false, nullsFirst: false });
  if (limit) q = q.limit(limit);
  const { data, error } = await q;
  if (error || !data) return [];
  return data
    .filter((t) => t.trade_date || t.post_date)
    .map((t) => {
      const k = RTA_TXN_LABEL[t.txn_kind as string];
      const date = (t.trade_date ?? t.post_date) as string;
      return {
        id: `rta-${t.id}`,
        client_id: clientId,
        employee_id: null,
        txn_type: k.side,
        product_type: 'mutual_fund',
        product_name: t.scheme_name ?? t.scheme_code,
        quantity: t.units == null ? null : Math.abs(Number(t.units)),
        per_unit_price: t.nav == null ? null : Number(t.nav),
        consolidated_amount: Math.abs(Number(t.amount ?? 0)),
        txn_date: date,
        notes: k.label,
        created_at: t.created_at ?? date,
        updated_at: t.created_at ?? date,
        folio_number: t.folio,
        mf_mode: t.txn_kind === 'sip' ? 'sip' : null,
      } satisfies NWTransaction;
    });
}

/** Merge two newest-first transaction lists into one newest-first list. */
export function mergeByDateDesc<T extends { txn_date: string }>(a: T[], b: T[], limit?: number): T[] {
  const out = [...a, ...b].sort((x, y) => (y.txn_date ?? '').localeCompare(x.txn_date ?? ''));
  return limit ? out.slice(0, limit) : out;
}
