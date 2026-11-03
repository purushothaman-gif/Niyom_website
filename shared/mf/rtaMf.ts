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

export interface RtaHoldingRow {
  id: string;
  folio: string;
  schemeName: string | null;
  schemeCode: string;
  amcCode: string | null;
  units: number;
  rtaValue: number | null;
  nav: number | null;
  navValue: number | null;
  snapshotDate: string | null;
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
  /** Most recent holdings snapshot across the client's folios. */
  snapshotDate: string | null;
  hasData: boolean;
}

const EMPTY: RtaMfData = { holdings: [], sips: [], totalValue: 0, snapshotDate: null, hasData: false };

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

  const [holdingsRes, sipsRes] = await Promise.all([
    folioIds.length
      ? db
          .from('mf_rta_holdings')
          .select('id, folio, scheme_name, scheme_code, amc_code, units, rta_value, nav, nav_value, snapshot_date')
          .in('folio_id', folioIds)
      : Promise.resolve({ data: [], error: null }),
    db
      .from('mf_rta_sips')
      .select('id, folio, scheme_name, scheme_code, txn_type, amount, frequency, sip_day, status, from_date, to_date')
      .eq('client_id', clientId),
  ]);
  if (holdingsRes.error) throw new Error(holdingsRes.error.message);
  if (sipsRes.error) throw new Error(sipsRes.error.message);

  const holdings: RtaHoldingRow[] = (holdingsRes.data ?? [])
    .map((h) => ({
      id: h.id,
      folio: h.folio,
      schemeName: h.scheme_name,
      schemeCode: h.scheme_code,
      amcCode: h.amc_code,
      units: Number(h.units ?? 0),
      rtaValue: h.rta_value == null ? null : Number(h.rta_value),
      nav: h.nav == null ? null : Number(h.nav),
      navValue: h.nav_value == null ? null : Number(h.nav_value),
      snapshotDate: h.snapshot_date,
    }))
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
  const snapshotDate = holdings.reduce<string | null>(
    (m, h) => (h.snapshotDate && (!m || h.snapshotDate > m) ? h.snapshotDate : m),
    null,
  );

  return { holdings, sips, totalValue, snapshotDate, hasData: holdings.length > 0 || sips.length > 0 };
}

function valueOf(h: RtaHoldingRow): number {
  if (h.rtaValue != null) return h.rtaValue;
  if (h.navValue != null) return h.navValue;
  if (h.nav != null) return h.units * h.nav;
  return 0;
}
