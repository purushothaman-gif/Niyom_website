/**
 * Market Watch, partner app. Reads through the PARTNER database handle, never
 * the client one, so a partner session is the only credential on the wire.
 *
 * The tables behind this screen are published market data and do not pass
 * through `nw_current_dsa_id()`, so the kill-switch cannot fire from here in
 * practice. The check is kept anyway: if these reads are ever moved behind a
 * partner RPC, a revoked partner is signed out exactly as on every other
 * partner screen (see usePartnerQuery), rather than shown an error.
 */
import { useCallback } from 'react';
import { getDb } from '@shared/platform/db';
import { PARTNER_ACCESS_REVOKED } from '@shared/partner/services/PartnerService';
import { useAuth } from '@/features/auth/AuthContext';
import { MarketWatchScreen } from '@/features/market/MarketWatchScreen';

const partnerDb = () => getDb('partner');

export default function PartnerMarketWatch() {
  const { signOut } = useAuth();
  const onError = useCallback(
    (message: string) => {
      if (message === PARTNER_ACCESS_REVOKED) void signOut('revoked');
    },
    [signOut],
  );
  return <MarketWatchScreen getDb={partnerDb} onError={onError} />;
}
