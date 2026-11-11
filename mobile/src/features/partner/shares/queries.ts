/**
 * Partner unlisted-share reads for the app.
 *
 * Built on `usePartnerQuery`, like partner bonds and for the same reason: it is
 * the single place `PARTNER_ACCESS_REVOKED` turns into a sign-out. The detail
 * screen re-reads one share through `nw_partner_unlisted_share(id)` rather than
 * picking it out of the list — the price depends on a markup the RM can change,
 * so re-reading on open is the honest call.
 */
import { useCallback } from 'react';
import {
  PartnerService,
  type PartnerShare,
  type PartnerShareOrder,
} from '@shared/partner/services/PartnerService';
import type { PartnerClientRow } from '@shared/partner/types';
import { usePartnerQuery } from '../usePartnerData';

/** The unlisted shares this partner may sell, at their cost + their own spread. */
export function usePartnerShares() {
  return usePartnerQuery<PartnerShare[]>(useCallback(() => PartnerService.getShares(), []), []);
}

/** One share. `null` once loaded means it is not resolvable for this DSA. */
export function usePartnerShare(id: string | undefined) {
  return usePartnerQuery<PartnerShare | null>(
    useCallback(() => (id ? PartnerService.getShare(id) : Promise.resolve(null)), [id]),
    [id],
  );
}

/** Share orders this partner raised for their clients, newest first. */
export function usePartnerShareOrders() {
  return usePartnerQuery<PartnerShareOrder[]>(
    useCallback(() => PartnerService.getMyShareOrders(), []),
    [],
  );
}

/** The partner's own clients — who an order may be placed for. */
export function usePartnerShareClients() {
  return usePartnerQuery<PartnerClientRow[]>(
    useCallback(() => PartnerService.getClients(), []),
    [],
  );
}
