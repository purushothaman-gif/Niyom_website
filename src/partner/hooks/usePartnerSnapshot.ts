/**
 * usePartnerSnapshot — one fetch that feeds every view, mirroring the client
 * portal's useClientSnapshot. Navigating between Dashboard / Clients / Payouts
 * never re-queries; the per-client portfolio drill-down is the only lazy load.
 *
 * Also owns the kill-switch: if any RPC reports that partner access has been
 * revoked (the RM disabled the login or deactivated the DSA), onAccessRevoked
 * fires so the host can sign the partner out immediately instead of waiting for
 * the JWT to expire.
 */
import { useCallback, useEffect, useState } from 'react';
import { PartnerService, PARTNER_ACCESS_REVOKED } from '../services/PartnerService';
import type {
  PartnerIdentity,
  PartnerClientRow,
  PartnerPayoutSummary,
  PartnerDebitNote,
  PartnerReferral,
  PartnerLead,
} from '../types';

export interface PartnerSnapshot {
  profile: PartnerIdentity | null;
  clients: PartnerClientRow[];
  payout: PartnerPayoutSummary | null;
  notes: PartnerDebitNote[];
  referral: PartnerReferral | null;
  leads: PartnerLead[];
}

const EMPTY: PartnerSnapshot = {
  profile: null, clients: [], payout: null, notes: [], referral: null, leads: [],
};

export function usePartnerSnapshot(onAccessRevoked: () => void) {
  const [snapshot, setSnapshot] = useState<PartnerSnapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [profile, clients, payout, notes, referral, leads] = await Promise.all([
        PartnerService.getProfile(),
        PartnerService.getClients(),
        PartnerService.getPayoutSummary(),
        PartnerService.getDebitNotes(),
        PartnerService.getReferral(),
        PartnerService.getLeads(),
      ]);

      // A live session whose DSA row no longer resolves is the same revocation
      // case as an explicit error — don't render an empty portal.
      if (!profile) {
        onAccessRevoked();
        return;
      }

      setSnapshot({ profile, clients, payout, notes, referral, leads });
      setRefreshedAt(new Date());
    } catch (err) {
      if ((err as Error)?.message === PARTNER_ACCESS_REVOKED) {
        onAccessRevoked();
        return;
      }
      setError((err as Error)?.message || 'Could not load your partner data.');
    } finally {
      setLoading(false);
    }
  }, [onAccessRevoked]);

  useEffect(() => {
    void load();
  }, [load]);

  return { snapshot, loading, error, refreshedAt, refresh: load };
}
