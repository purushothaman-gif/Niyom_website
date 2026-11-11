/**
 * Explore's own reads.
 *
 * Bonds and funds reuse the queries their own screens already run (same React
 * Query keys, so opening Explore after Bonds costs no request). Only the two
 * reads below are Explore's: the unlisted-share list, and which products have
 * been switched off for this client.
 *
 * Both go straight to `shared/`, not through another feature's hooks, so this
 * screen does not break when a neighbouring feature reshapes its internals.
 */
import { useQuery } from '@tanstack/react-query';
import { NO_HIDDEN_PRODUCTS, fetchHiddenProducts } from '@shared/lib/productAccess';
import { clientSupabase } from '@shared/lib/supabase';
import { ShareOrderService, type ClientShare } from '@shared/portal/services/ShareOrderService';

const STALE_MS = 15 * 60 * 1000;

/** Unlisted shares open to this client. A failure reads as "none", as on the website. */
export function useExploreShares(enabled: boolean) {
  const query = useQuery({
    queryKey: ['explore', 'shares'],
    queryFn: () => ShareOrderService.getShares(),
    enabled,
    staleTime: STALE_MS,
    retry: false,
  });
  return {
    shares: (query.data ?? []) as ClientShare[],
    loading: enabled && query.isLoading,
    reload: () => void query.refetch(),
  };
}

/**
 * Product keys switched off for this client. Fails open (nothing hidden): the
 * order triggers enforce access server-side, so the worst case of a failed read
 * is a rail the client can look at but not order from.
 */
export function useHiddenProducts(clientId: string | undefined): ReadonlySet<string> {
  const query = useQuery({
    queryKey: ['explore', 'hidden-products', clientId],
    queryFn: () => fetchHiddenProducts(clientSupabase, 'client'),
    enabled: !!clientId,
    staleTime: STALE_MS,
    retry: false,
  });
  return query.data ?? NO_HIDDEN_PRODUCTS;
}
