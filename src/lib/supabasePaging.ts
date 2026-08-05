/**
 * Reading a table that can outgrow one response.
 *
 * PostgREST caps every response, and Supabase's cap is 1000 rows. It does not
 * error and it does not warn — the array is simply short, which is the worst
 * shape a bug can take: a client with 1,639 CAS transactions received the
 * oldest 1,000, every scheme's ledger fell short of its closing balance, the
 * statement was judged truncated, and their return vanished. The portfolio
 * VALUE was right throughout, because the schemes fitted in one page.
 *
 * Anything that can exceed a thousand rows has to be read page by page, and
 * every paged query needs a UNIQUE tiebreaker in its ORDER BY: rows sharing a
 * date (or a value) can otherwise come back in a different order per request,
 * so a row lands on two pages or on none. Silent duplication in a ledger is
 * worse than the truncation it replaces.
 */

export const PAGE_SIZE = 1000;

/**
 * Read every page.
 *
 * The boundary that decides whether this is correct is a row count that is an
 * exact multiple of the page size: a full last page is indistinguishable from a
 * full middle one, so the loop asks once more and stops on the empty response.
 * A failed page throws rather than returning what it has, because a short list
 * reads as missing data rather than as an error.
 */
export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
}
