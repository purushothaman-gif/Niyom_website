/**
 * The marketplace search rule for unlisted shares — company, short name, ISIN
 * or sector, case-insensitive. Same rule as the website's SharesListPage; kept
 * here so the app does not grow a second, slightly different one.
 */
export interface SearchableShare {
  company_name: string | null;
  short_name: string | null;
  isin: string | null;
  sector: string | null;
}

export function matchesShareSearch(share: SearchableShare, query: string): boolean {
  const t = query.trim().toLowerCase();
  if (!t) return true;
  return [share.company_name, share.short_name, share.isin, share.sector].some((v) =>
    (v ?? '').toLowerCase().includes(t),
  );
}
