/**
 * Partner bond reads for the app.
 *
 * Built on `usePartnerQuery` rather than on React Query, unlike the client
 * bond screens. The reason is the kill-switch: `nw_current_dsa_id()` embeds the
 * enabled/active checks, so an RM disabling a partner mid-session makes every
 * RPC raise `PARTNER_ACCESS_REVOKED`, and the correct response is an immediate
 * sign-out — not a retry, and not a half-empty screen. `usePartnerQuery` is the
 * one place that decision lives; a second data layer beside it would be a second
 * place to forget it.
 *
 * The cost of that is no cross-screen cache, so the detail screen re-reads one
 * bond through `nw_partner_bond(id)` rather than picking it out of the list. For
 * a single row that is a cheap call, and it is the honest one: a partner's
 * price depends on a markup their RM can change, so re-reading on open is a
 * feature rather than an inefficiency to design around.
 */
import { useCallback } from 'react';
import {
  PartnerService,
  type PartnerBond,
  type PartnerBondOrder,
} from '@shared/partner/services/PartnerService';
import type { PartnerClientRow } from '@shared/partner/types';
import { usePartnerQuery } from '../usePartnerData';

/** The bonds this partner may sell, at their cost + their own spread. */
export function usePartnerBonds() {
  return usePartnerQuery<PartnerBond[]>(useCallback(() => PartnerService.getBonds(), []), []);
}

/** One bond. `null` once loaded means it is not resolvable for this DSA. */
export function usePartnerBond(id: string | undefined) {
  return usePartnerQuery<PartnerBond | null>(
    useCallback(() => (id ? PartnerService.getBond(id) : Promise.resolve(null)), [id]),
    [id],
  );
}

/** Orders this partner raised for their clients, newest first. */
export function usePartnerBondOrders() {
  return usePartnerQuery<PartnerBondOrder[]>(
    useCallback(() => PartnerService.getMyBondOrders(), []),
    [],
  );
}

/** The partner's own clients — who an order may be placed for. */
export function usePartnerClients() {
  return usePartnerQuery<PartnerClientRow[]>(
    useCallback(() => PartnerService.getClients(), []),
    [],
  );
}
