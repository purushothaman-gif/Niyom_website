/**
 * Fund data, fetched once and shared.
 * -----------------------------------------------------------------------------
 * The shared `useMfCatalog` hook is plain `useState`, so every component that
 * mounts it runs its own full fetch. That is fine on the website, where the
 * Mutual Funds module mounts it once at the top. It is not fine here: tapping a
 * fund pushes a new screen, that screen mounts the hook again, and the fund's
 * NAV chart ends up waiting behind a re-download of the WHOLE catalogue —
 * ~9,600 rows, about 4 MB across ten paginated requests — to look up one code.
 *
 * That was the "graph loads slowly" report. The detail endpoint itself answers
 * in under a second; the catalogue in front of it was the wait.
 *
 * React Query gives one cache for the whole app, so the second screen gets the
 * catalogue instantly and the chart is the only thing still loading.
 */
import { useQuery } from '@tanstack/react-query';
import { MfCatalogService } from '@shared/portal/services/MfCatalogService';
import type { CatalogFund, CatalogFundDetail, FundRecommendation } from '@shared/portal/types/funds';

/** NAVs move once a day, so re-fetching within a session buys nothing. */
const CATALOG_STALE_MS = 30 * 60 * 1000;
const DETAIL_STALE_MS = 30 * 60 * 1000;

export function useFundCatalog() {
  const catalog = useQuery({
    queryKey: ['mf', 'catalog'],
    queryFn: () => MfCatalogService.list(),
    staleTime: CATALOG_STALE_MS,
  });

  /*
   * A separate query on purpose. The recommendation shelf failing is not the
   * catalogue failing — a missing shelf hides a section, while a missing
   * catalogue is what the error state is for.
   */
  const recommendations = useQuery({
    queryKey: ['mf', 'recommendations'],
    queryFn: () => MfCatalogService.recommendations(),
    staleTime: CATALOG_STALE_MS,
    // An empty shelf is a perfectly good outcome; never surface this as an error.
    retry: false,
  });

  return {
    funds: (catalog.data ?? []) as CatalogFund[],
    recommendations: (recommendations.data ?? []) as FundRecommendation[],
    loading: catalog.isLoading,
    error: catalog.error ? errorMessage(catalog.error) : null,
    reload: () => {
      void catalog.refetch();
      void recommendations.refetch();
    },
  };
}

/**
 * One fund's NAV history and 52-week band.
 *
 * Keyed by code, so returning to a fund already looked at renders the chart
 * from cache with no spinner at all.
 */
export function useFundDetail(amfiCode: string | undefined) {
  const query = useQuery({
    queryKey: ['mf', 'detail', amfiCode],
    queryFn: () => MfCatalogService.detail(amfiCode!),
    enabled: !!amfiCode,
    staleTime: DETAIL_STALE_MS,
  });

  return {
    detail: (query.data ?? null) as CatalogFundDetail | null,
    loading: query.isLoading,
    error: query.error ? errorMessage(query.error) : null,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Could not load fund data.';
}
