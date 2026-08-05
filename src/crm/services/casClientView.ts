/**
 * The client's imported statement, as staff see it.
 *
 * ## Why the console reads cas_* instead of nw_holdings gaining rows
 *
 * Copying imported holdings into nw_holdings would be the quick way to make
 * them appear here, and it would break two things at once.
 *
 * nw_holdings is the book of what WE sold. It carries DSA pricing, landing cost
 * and trail fields, and every MIS and AUM figure in the console is computed from
 * it. Imported rows would arrive with all of that empty and be
 * indistinguishable from a half-entered manual row.
 *
 * And a CAS contains funds bought through OTHER distributors. Copying those in
 * would count a competitor's business inside our own AUM — the one number that
 * has to be right.
 *
 * So the two live side by side and answer different questions: nw_holdings for
 * "what did we sell and what are we paid on", this for "what does the client
 * actually hold". The panel is read-only for the same reason — a statement is
 * evidence, not a record staff maintain.
 *
 * RLS decides visibility (an RM sees their own clients, admins see all), so
 * this passes a client id and lets the database answer.
 */
import { supabase } from '../../lib/supabase';
import { fetchAllPages } from '../../lib/supabasePaging';
import { ownershipOf, type MfOwnership } from '../../portal/types/ownership';

export interface CasCrmScheme {
  id: string;
  name: string;
  folioNumber: string;
  amc: string | null;
  registrar: string | null;
  isin: string | null;
  units: number;
  nav: number;
  navDate: string | null;
  value: number;
  cost: number;
  gain: number;
  gainPercent: number;
  advisorCode: string | null;
  ownership: MfOwnership;
}

export interface CasCrmView {
  importId: string;
  statementTo: string | null;
  importedAt: string;
  schemeCount: number;
  transactionCount: number;
  schemes: CasCrmScheme[];
  /** Totals across open positions only — what the client holds today. */
  totalValue: number;
  totalCost: number;
  /** The slice sitting with another distributor: the migration opportunity. */
  heldAwayValue: number;
  heldAwayCount: number;
}

interface SchemeRow {
  id: string;
  name: string;
  units: number | null;
  nav: number | null;
  nav_date: string | null;
  value: number | null;
  cost: number | null;
  isin: string | null;
  rta: string | null;
  advisor_code: string | null;
  is_ours: boolean | null;
  cas_folios: { folio_number: string; amc: string | null; registrar: string | null } | null;
}

/**
 * The latest reconciled import for one client, or null.
 *
 * Only `reconciled` — a statement that failed its own arithmetic is kept for
 * diagnosis and must never be presented as a client's position, to staff any
 * more than to the client.
 */
export async function loadCasView(clientId: string): Promise<CasCrmView | null> {
  const { data: imp } = await supabase
    .from('cas_imports')
    .select('id,statement_to,created_at,scheme_count,transaction_count')
    .eq('client_id', clientId)
    .eq('status', 'reconciled')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!imp) return null;

  /*
   * Paged, and ordered by a UNIQUE tiebreaker as well as by value.
   *
   * PostgREST caps a response at 1000 rows without saying so, and `value` is
   * not unique, so an unpaged read would quietly drop holdings past the cap
   * and an unstable order would let a row land on two pages. A staff screen
   * that is short by a fund is worse than one that fails: nothing about it
   * looks wrong. Today's biggest client has 34 schemes, so this is protection
   * rather than repair — the same cap cost a client their return when their
   * 1,639 transactions crossed it.
   */
  const data = await fetchAllPages<SchemeRow>((from, to) =>
    supabase
      .from('cas_schemes')
      .select('id,name,units,nav,nav_date,value,cost,isin,rta,advisor_code,is_ours,cas_folios(folio_number,amc,registrar)')
      .eq('import_id', imp.id)
      .order('value', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: SchemeRow[] | null; error: unknown }>,
  );

  const schemes: CasCrmScheme[] = (data as unknown as SchemeRow[])
    // Fully exited funds stay in the statement for realised gains but are not
    // holdings, and a position list that includes them overstates the client.
    .filter((s) => (Number(s.value) || 0) > 0 || (Number(s.units) || 0) > 0)
    .map((s) => {
      const value = Number(s.value) || 0;
      const cost = Number(s.cost) || 0;
      return {
        id: s.id,
        name: s.name,
        folioNumber: s.cas_folios?.folio_number ?? '',
        amc: s.cas_folios?.amc ?? null,
        registrar: s.rta ?? s.cas_folios?.registrar ?? null,
        isin: s.isin,
        units: Number(s.units) || 0,
        nav: Number(s.nav) || 0,
        navDate: s.nav_date,
        value,
        cost,
        gain: value - cost,
        gainPercent: cost > 0 ? ((value - cost) / cost) * 100 : 0,
        advisorCode: s.advisor_code,
        // Same three-state rule the portal uses — imported from one place so the
        // console and the client can never disagree about whose a folio is.
        ownership: ownershipOf(s.advisor_code, s.is_ours),
      };
    });

  const heldAway = schemes.filter((s) => s.ownership === 'held_away');

  return {
    importId: imp.id as string,
    statementTo: (imp.statement_to as string) ?? null,
    importedAt: (imp.created_at as string) ?? '',
    schemeCount: Number(imp.scheme_count) || schemes.length,
    transactionCount: Number(imp.transaction_count) || 0,
    schemes,
    totalValue: schemes.reduce((s, x) => s + x.value, 0),
    totalCost: schemes.reduce((s, x) => s + x.cost, 0),
    heldAwayValue: heldAway.reduce((s, x) => s + x.value, 0),
    heldAwayCount: heldAway.length,
  };
}
