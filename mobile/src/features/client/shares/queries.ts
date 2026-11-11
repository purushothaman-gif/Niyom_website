/**
 * Unlisted-share data, fetched once and shared.
 * -----------------------------------------------------------------------------
 * Same shape and same reasoning as `../bonds/queries.ts`: the marketplace, the
 * detail screen and the order review are three separate mounts on a phone, so
 * the list is cached and the detail screen resolves its share from that cache by
 * `id`, falling back to the single-row RPC for a cold deep link.
 *
 * Orders are cached separately and invalidated on placement.
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ShareOrderService,
  type ClientShare,
  type ShareOrder,
} from '@shared/portal/services/ShareOrderService';

/** The price is a manual daily admin price at an approved markup — not a live quote. */
const SHARES_STALE_MS = 15 * 60 * 1000;
/** An order's status moves when the RM acts, so this is worth re-reading sooner. */
const ORDERS_STALE_MS = 60 * 1000;

export function useShares() {
  const query = useQuery({
    queryKey: ['shares', 'list'],
    queryFn: () => ShareOrderService.getShares(),
    staleTime: SHARES_STALE_MS,
  });

  return {
    shares: (query.data ?? []) as ClientShare[],
    loading: query.isLoading,
    refreshing: query.isRefetching,
    error: query.error ? errorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

export function useShare(id: string | undefined) {
  const qc = useQueryClient();
  const cached = useMemo(
    () => (qc.getQueryData(['shares', 'list']) as ClientShare[] | undefined)?.find((s) => s.id === id),
    [qc, id],
  );

  const query = useQuery({
    queryKey: ['shares', 'one', id],
    queryFn: () => ShareOrderService.getShare(id!),
    enabled: !!id && !cached,
    staleTime: SHARES_STALE_MS,
  });

  const share = cached ?? ((query.data ?? null) as ClientShare | null);

  return {
    share,
    loading: !share && query.isLoading,
    error: query.error ? errorMessage(query.error) : null,
  };
}

export function useMyShareOrders(clientId: string | undefined) {
  const query = useQuery({
    queryKey: ['shares', 'orders', clientId],
    queryFn: () => ShareOrderService.getMyOrders(clientId!),
    enabled: !!clientId,
    staleTime: ORDERS_STALE_MS,
  });

  return {
    orders: (query.data ?? []) as ShareOrder[],
    loading: query.isLoading,
    error: query.error ? errorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

/** Drop the cached order list so the next read of it includes a new order. */
export function useInvalidateShareOrders() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['shares', 'orders'] });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Could not load unlisted shares.';
}
