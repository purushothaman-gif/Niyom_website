// Shared bond text search — one implementation for the client and partner bond
// lists. Case-insensitive substring match across the fields a user would type:
// ISIN, bond name, issuer, and rating.

export interface SearchableBond {
  isin?: string | null;
  bond_name?: string | null;
  issuer_name?: string | null;
  rating?: string | null;
}

export function bondMatchesQuery(b: SearchableBond, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [b.isin, b.bond_name, b.issuer_name, b.rating].some(
    (f) => (f || '').toLowerCase().includes(q),
  );
}
