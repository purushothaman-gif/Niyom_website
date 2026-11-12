/**
 * ELSS lock-in from the registrar feed — Phase 2.
 *
 * Phase 1 took its lots from an imported CAS. This covers the other source: a
 * client whose mutual funds run on the platform, whose purchases arrive through
 * the CAMS/KFintech mailback (mf_rta_transactions) rather than a statement they
 * uploaded. The lock-in rule is identical — three years per purchase — so the
 * only new work is recovering the surviving lots from that feed and handing them
 * to the same overlay (`computeElssLockIn`).
 *
 * ## Why a small FIFO of its own, not the CAS engine
 *
 * The CAS gains engine is shaped around a statement: a `balance_units` chain for
 * same-day ordering, stamp-duty rows, grandfathering. The registrar feed has
 * none of that — just dated purchases and redemptions — so a plain FIFO walk is
 * both sufficient and more honest than bending the feed into the CAS shape.
 *
 * ## The guard that keeps it safe
 *
 * The feed is only trusted for a scheme when its surviving units RECONCILE with
 * the units actually held (the same test the holdings view uses). Units
 * transferred in from a prior broker have no purchase rows here, so they never
 * reconcile — and an un-dated lot must never be shown a lock-in it cannot
 * stand behind. Those schemes are simply left out.
 */
import { unitsReconcile } from '../../../mf/rtaMf';
import { clientSupabase as supabase } from '../../../lib/supabase';
import type { OpenLot } from './gains';
import { isElssName, type ElssLockInSource } from './elssLockIn';

const EPS = 0.001;

/** Registrar transaction kinds that ADD units the investor now owns. */
const INFLOW = new Set(['purchase', 'sip', 'switch_in']);
/** Kinds that REMOVE units. */
const OUTFLOW = new Set(['redemption', 'switch_out']);

/** A registrar transaction, trimmed to what the FIFO needs. */
export interface RegistrarTxn {
  folio: string;
  schemeCode: string;
  txnKind: string;
  amount: number;
  units: number;
  nav: number | null;
  tradeDate: string | null;
}

/** A registrar holding, trimmed to what the reconcile + valuation need. */
export interface RegistrarHolding {
  folio: string;
  schemeCode: string;
  schemeName: string | null;
  isin: string | null;
  units: number;
  /** Latest value of the whole held position, for a per-lot current value. */
  value: number | null;
}

interface WorkingLot {
  buyDate: string;
  units: number;
  costPerUnit: number;
}

/** Remove reversed units from the most recent lots first (a bounced purchase). */
function reverseNewest(lots: WorkingLot[], units: number): void {
  let remaining = units;
  for (let i = lots.length - 1; i >= 0 && remaining > EPS; i -= 1) {
    const take = Math.min(lots[i].units, remaining);
    lots[i].units -= take;
    remaining -= take;
    if (lots[i].units <= EPS) lots.splice(i, 1);
  }
}

/**
 * Walk one scheme's registrar transactions into its surviving lots.
 *
 * Only dated purchases and redemptions move units; anything undated or of an
 * unknown kind (the feed carries occasional malformed 'other' rows) is skipped.
 * If those skipped rows actually held units the scheme will fail to reconcile
 * and be dropped by the caller — which is the safe outcome.
 */
export function buildRegistrarLots(txns: RegistrarTxn[]): WorkingLot[] {
  const usable = txns
    .filter((t) => t.tradeDate && (INFLOW.has(t.txnKind) || OUTFLOW.has(t.txnKind)))
    .sort((a, b) => ((a.tradeDate as string) < (b.tradeDate as string) ? -1 : (a.tradeDate as string) > (b.tradeDate as string) ? 1 : 0));

  const lots: WorkingLot[] = [];
  for (const t of usable) {
    const units = Number(t.units) || 0;
    const amount = Math.abs(Number(t.amount) || 0);
    const date = (t.tradeDate as string).slice(0, 10);

    if (INFLOW.has(t.txnKind)) {
      if (units > EPS) {
        const costPerUnit = amount > 0 ? amount / units : Number(t.nav) || 0;
        lots.push({ buyDate: date, units, costPerUnit });
      } else if (units < -EPS) {
        reverseNewest(lots, -units); // a reversed purchase, not a sale
      }
      continue;
    }

    // An outflow: redeem oldest units first.
    let toSell = Math.abs(units);
    while (toSell > EPS && lots.length) {
      const lot = lots[0];
      const take = Math.min(lot.units, toSell);
      lot.units -= take;
      toSell -= take;
      if (lot.units <= EPS) lots.shift();
    }
  }
  return lots;
}

const schemeKey = (folio: string, code: string) => `${folio}\u0000${code}`;

/**
 * Build lock-in sources from a client's registrar holdings and transactions.
 *
 * One source per ELSS holding whose feed reconciles. Transactions are matched to
 * a holding by (folio, scheme code); for a folio that holds a single scheme the
 * whole folio's transactions are used as a fallback, since the transaction feed
 * sometimes formats the scheme code differently from the holdings feed.
 */
export function registrarElssSources(
  holdings: RegistrarHolding[],
  txns: RegistrarTxn[],
): ElssLockInSource[] {
  const byScheme = new Map<string, RegistrarTxn[]>();
  const byFolio = new Map<string, RegistrarTxn[]>();
  const push = (map: Map<string, RegistrarTxn[]>, key: string, t: RegistrarTxn) => {
    const arr = map.get(key);
    if (arr) arr.push(t);
    else map.set(key, [t]);
  };
  for (const t of txns) {
    push(byScheme, schemeKey(t.folio, t.schemeCode), t);
    push(byFolio, t.folio, t);
  }
  const holdingsPerFolio = new Map<string, number>();
  for (const h of holdings) holdingsPerFolio.set(h.folio, (holdingsPerFolio.get(h.folio) ?? 0) + 1);

  const sources: ElssLockInSource[] = [];
  for (const h of holdings) {
    if (!isElssName(h.schemeName)) continue;

    const exact = byScheme.get(schemeKey(h.folio, h.schemeCode));
    const folioOnly = holdingsPerFolio.get(h.folio) === 1 ? byFolio.get(h.folio) : undefined;
    const group = exact?.length ? exact : folioOnly ?? [];

    const lots = buildRegistrarLots(group);
    const openUnits = lots.reduce((s, l) => s + l.units, 0);
    const openCost = lots.reduce((s, l) => s + l.units * l.costPerUnit, 0);
    const complete = lots.length > 0 && unitsReconcile(h.units, openUnits);

    const currentNav = h.units > EPS && h.value !== null ? h.value / h.units : null;
    const currentValue = currentNav !== null ? openUnits * currentNav : null;

    const openLots: OpenLot[] = lots.map((l) => ({
      buyDate: l.buyDate,
      units: l.units,
      buyNav: l.costPerUnit,
      cost: l.units * l.costPerUnit,
    }));

    sources.push({
      schemeName: h.schemeName as string,
      isin: h.isin,
      complete,
      openLots,
      openCost,
      openUnits,
      unrealised: currentValue !== null ? currentValue - openCost : null,
    });
  }
  return sources;
}

const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));

/**
 * Read a client's registrar ELSS lock-in sources. Best-effort: any read failure
 * returns [], so the lock-in panel simply falls back to its CAS-only view rather
 * than erroring. The result feeds straight into `computeElssLockIn`.
 */
export async function fetchRegistrarElssSources(clientId: string): Promise<ElssLockInSource[]> {
  if (!clientId) return [];
  const { data: folios, error: fErr } = await supabase
    .from('mf_rta_folios')
    .select('id')
    .eq('client_id', clientId);
  if (fErr) return [];
  const folioIds = (folios ?? []).map((f) => f.id);
  if (!folioIds.length) return [];

  const [hRes, tRes] = await Promise.all([
    supabase
      .from('mf_rta_holdings')
      .select('folio, scheme_code, scheme_name, isin, units, rta_value, live_value, nav_value, nav')
      .in('folio_id', folioIds),
    supabase
      .from('mf_rta_transactions')
      .select('folio, scheme_code, txn_kind, amount, units, nav, trade_date')
      .eq('client_id', clientId),
  ]);
  if (hRes.error || tRes.error) return [];

  const holdings: RegistrarHolding[] = (hRes.data ?? []).map((h) => {
    const units = Number(h.units) || 0;
    const value =
      numOrNull(h.live_value) ??
      numOrNull(h.rta_value) ??
      numOrNull(h.nav_value) ??
      (h.nav != null ? units * Number(h.nav) : null);
    return {
      folio: h.folio,
      schemeCode: h.scheme_code,
      schemeName: h.scheme_name ?? null,
      isin: h.isin ?? null,
      units,
      value,
    };
  });

  const txns: RegistrarTxn[] = (tRes.data ?? []).map((t) => ({
    folio: t.folio,
    schemeCode: t.scheme_code,
    txnKind: (t.txn_kind ?? 'other') as string,
    amount: Number(t.amount) || 0,
    units: Number(t.units) || 0,
    nav: numOrNull(t.nav),
    tradeDate: t.trade_date ?? null,
  }));

  return registrarElssSources(holdings, txns);
}
