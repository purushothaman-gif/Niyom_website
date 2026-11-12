/**
 * The client's imported demat statement (eCAS), as staff see it.
 *
 * The sibling of casClientView for the other imported source: stocks, ETFs,
 * bonds, G-secs, AIFs and NPS the client holds in demat, as their CDSL/NSDL
 * statement stated them. Read from demat_* and never copied into nw_holdings,
 * for the reason casClientView spells out — that table is the book of what WE
 * sold, and a client's holdings elsewhere must not land in our AUM.
 *
 * Two properties of an eCAS shape what this returns:
 *
 *   no cost   It is a holdings snapshot with no transaction ledger, so there is
 *             no cost basis and no gain. Only units and value are reported.
 *
 *   demat MFs Mutual funds held in demat are kept (the statement lists them and
 *             an RM should see the whole document) but flagged, because the
 *             same funds also appear in the CAS panel and the two must not be
 *             added together.
 *
 * RLS decides visibility (an RM sees their own clients, admins see all).
 */
import { supabase } from '../../lib/supabase';
import { fetchAllPages } from '../../lib/supabasePaging';

/** Display order and label for each stored asset_class. */
export const DEMAT_CLASSES: { key: string; label: string }[] = [
  { key: 'equity', label: 'Stocks' },
  { key: 'etf', label: 'ETFs' },
  { key: 'corporate_bond', label: 'Corporate Bonds' },
  { key: 'gsec', label: 'Government Securities' },
  { key: 'aif', label: 'AIFs' },
  { key: 'nps', label: 'NPS' },
  { key: 'demat_mf', label: 'Mutual Funds (demat)' },
  { key: 'other', label: 'Other Securities' },
];

export interface DematCrmHolding {
  id: string;
  assetClass: string;
  name: string;
  isin: string | null;
  units: number;
  value: number;
  /** value / units, when both are present. */
  price: number;
  depository: string | null;
  dpName: string | null;
  boId: string | null;
}

export interface DematCrmGroup {
  key: string;
  label: string;
  value: number;
  holdings: DematCrmHolding[];
}

export interface DematCrmView {
  importId: string;
  statementDate: string | null;
  importedAt: string;
  /** CDSL | NSDL — the depository that issued the statement. */
  issuedBy: string | null;
  groups: DematCrmGroup[];
  holdingCount: number;
  /** Everything on the statement, demat-held mutual funds included. */
  totalValue: number;
  /** The demat-MF slice, which the CAS panel also carries. */
  dematMfValue: number;
}

export interface DematHoldingRow {
  id: string;
  asset_class: string;
  isin: string | null;
  name: string;
  units: number | null;
  value: number | null;
  demat_accounts: { depository: string | null; dp_name: string | null; bo_id: string | null } | null;
}

/** Group raw rows by class, in display order, largest holding first. */
export function buildDematGroups(rows: DematHoldingRow[]): DematCrmGroup[] {
  const known = new Set(DEMAT_CLASSES.map((c) => c.key));
  const byClass = new Map<string, DematCrmHolding[]>();
  for (const r of rows) {
    const units = Number(r.units) || 0;
    const value = Number(r.value) || 0;
    // A zero line is a closed position the statement still prints.
    if (units <= 0 && value <= 0) continue;
    const key = known.has(r.asset_class) ? r.asset_class : 'other';
    const list = byClass.get(key) ?? [];
    list.push({
      id: r.id,
      assetClass: key,
      name: r.name,
      isin: r.isin,
      units,
      value,
      price: units > 0 ? value / units : 0,
      depository: r.demat_accounts?.depository ?? null,
      dpName: r.demat_accounts?.dp_name ?? null,
      boId: r.demat_accounts?.bo_id ?? null,
    });
    byClass.set(key, list);
  }
  return DEMAT_CLASSES.filter((c) => byClass.has(c.key)).map((c) => {
    const holdings = (byClass.get(c.key) ?? []).sort((a, b) => b.value - a.value);
    return { key: c.key, label: c.label, value: holdings.reduce((s, h) => s + h.value, 0), holdings };
  });
}

/**
 * The latest parsed demat statement for one client, or null.
 *
 * Latest only, matching what the client's own portal shows, so staff and client
 * are looking at the same snapshot.
 */
export async function loadDematView(clientId: string): Promise<DematCrmView | null> {
  const { data: imp } = await supabase
    .from('demat_imports')
    .select('id,statement_date,created_at,cas_type')
    .eq('client_id', clientId)
    .eq('status', 'parsed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!imp) return null;

  // Paged with a unique tiebreaker: PostgREST silently caps a read at 1000 rows.
  const rows = await fetchAllPages<DematHoldingRow>((from, to) =>
    supabase
      .from('demat_holdings')
      .select('id,asset_class,isin,name,units,value,demat_accounts(depository,dp_name,bo_id)')
      .eq('import_id', imp.id)
      .order('value', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to) as unknown as PromiseLike<{ data: DematHoldingRow[] | null; error: unknown }>,
  );

  const groups = buildDematGroups(rows as unknown as DematHoldingRow[]);
  if (groups.length === 0) return null;

  return {
    importId: imp.id as string,
    statementDate: (imp.statement_date as string) ?? null,
    importedAt: (imp.created_at as string) ?? '',
    issuedBy: (imp.cas_type as string) ?? null,
    groups,
    holdingCount: groups.reduce((s, g) => s + g.holdings.length, 0),
    totalValue: groups.reduce((s, g) => s + g.value, 0),
    dematMfValue: groups.find((g) => g.key === 'demat_mf')?.value ?? 0,
  };
}
