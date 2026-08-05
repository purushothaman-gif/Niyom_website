/**
 * Paging the CAS reads.
 *
 * PostgREST caps every response at 1000 rows and says nothing about it — no
 * error, no warning, just a short array. A client with 1,639 transactions
 * received the oldest 1,000, so every scheme's ledger fell short of its closing
 * balance, the statement was judged truncated, and their return disappeared.
 * The portfolio VALUE was right the whole time, because 34 schemes fit in one
 * page — which is exactly why it went unnoticed.
 */
import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages } from './supabasePaging';

/** A fake table of `total` rows, served in pages like PostgREST does. */
const pager = (total: number) => {
  const rows = Array.from({ length: total }, (_, i) => ({ id: i }));
  return vi.fn((from: number, to: number) =>
    Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
  );
};

describe('fetchAllPages', () => {
  it('returns everything when it fits in one page', async () => {
    const fetch = pager(34);
    await expect(fetchAllPages(fetch, 1000)).resolves.toHaveLength(34);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reads past the cap — the 1,639-transaction case', async () => {
    const fetch = pager(1639);
    const rows = await fetchAllPages(fetch, 1000);
    expect(rows).toHaveLength(1639);
    // No row read twice, none missed.
    expect(new Set(rows.map((r) => r.id)).size).toBe(1639);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('handles an EXACT multiple of the page size', async () => {
    /*
     * The boundary that decides whether this helper is correct. A full last
     * page is indistinguishable from a full middle page, so stopping on it
     * would silently drop everything after — and there is nothing after only
     * because the count happened to divide evenly.
     */
    const fetch = pager(2000);
    const rows = await fetchAllPages(fetch, 1000);
    expect(rows).toHaveLength(2000);
    // Two full pages plus the empty one that proves there is no third.
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('copes with an empty table', async () => {
    await expect(fetchAllPages(pager(0), 1000)).resolves.toEqual([]);
  });

  it('asks for the right ranges', async () => {
    const fetch = pager(2500);
    await fetchAllPages(fetch, 1000);
    expect(fetch.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it('throws rather than returning a short list when a page fails', async () => {
    // Half a ledger is worse than an error: it reads as a truncated statement.
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ data: Array.from({ length: 1000 }, (_, i) => ({ id: i })), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'network' } });
    await expect(fetchAllPages(fetch, 1000)).rejects.toBeTruthy();
  });
});
