/**
 * Bond data, fetched once and shared.
 * -----------------------------------------------------------------------------
 * Three screens read the same two lists — the marketplace, the detail page and
 * the order review — and on a phone those are three separate mounts, not one
 * component tree. Without a shared cache, tapping a bond would re-run
 * `nw_client_bonds` just to look up the row the previous screen already had, and
 * the detail page would open behind a spinner for data that was already on the
 * device. The same mistake cost the fund screen its NAV chart once; see
 * `../mf/queries.ts`.
 *
 * So the detail screen takes only an `id` in its route params (a route param is
 * a URL — passing a whole bond object through one is how a deep link breaks) and
 * resolves it out of this cache.
 *
 * Orders are cached separately and invalidated on placement, because placing one
 * changes that list and nothing else.
 */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BondOrderService,
  type BondOrder,
  type ClientBond,
} from '@shared/portal/services/BondOrderService';

/**
 * Prices are an admin-approved markup on a slow-moving master, not a live
 * quote — they change when someone in the CRM changes them, which is not
 * within a session. Refetching on every screen push would buy nothing.
 */
const BONDS_STALE_MS = 15 * 60 * 1000;
/** An order's status moves when the RM acts, so this is worth re-reading sooner. */
const ORDERS_STALE_MS = 60 * 1000;

export function useBonds() {
  const query = useQuery({
    queryKey: ['bonds', 'list'],
    queryFn: () => BondOrderService.getBonds(),
    staleTime: BONDS_STALE_MS,
  });

  return {
    bonds: (query.data ?? []) as ClientBond[],
    loading: query.isLoading,
    refreshing: query.isRefetching,
    error: query.error ? errorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

/**
 * One bond, out of the marketplace list already in cache.
 *
 * Falls back to the single-row RPC when it isn't there — which is the deep-link
 * case (an order notification opening straight onto a bond), and also the case
 * where a bond has been withdrawn from the list since it was cached.
 */
export function useBond(id: string | undefined) {
  const qc = useQueryClient();
  const cached = useMemo(
    () => (qc.getQueryData(['bonds', 'list']) as ClientBond[] | undefined)?.find((b) => b.id === id),
    [qc, id],
  );

  const query = useQuery({
    queryKey: ['bonds', 'one', id],
    queryFn: () => BondOrderService.getBond(id!),
    enabled: !!id && !cached,
    staleTime: BONDS_STALE_MS,
  });

  const bond = cached ?? ((query.data ?? null) as ClientBond | null);

  return {
    bond,
    loading: !bond && query.isLoading,
    error: query.error ? errorMessage(query.error) : null,
  };
}

export function useMyBondOrders(clientId: string | undefined) {
  const query = useQuery({
    queryKey: ['bonds', 'orders', clientId],
    queryFn: () => BondOrderService.getMyOrders(clientId!),
    enabled: !!clientId,
    staleTime: ORDERS_STALE_MS,
  });

  return {
    orders: (query.data ?? []) as BondOrder[],
    loading: query.isLoading,
    error: query.error ? errorMessage(query.error) : null,
    reload: () => void query.refetch(),
  };
}

/** Drop the cached order list so the next read of it includes a new order. */
export function useInvalidateBondOrders() {
  const qc = useQueryClient();
  return () => void qc.invalidateQueries({ queryKey: ['bonds', 'orders'] });
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Could not load bonds.';
}
