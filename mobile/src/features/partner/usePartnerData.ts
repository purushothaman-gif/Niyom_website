/**
 * Partner reads, wrapped for the app.
 *
 * Every call goes through `PartnerService` from `shared/` — never a table query.
 * That is not a style choice: partners have no SELECT policy on `nw_clients`,
 * `nw_holdings` or `nw_transactions`, because RLS grants ROWS, not columns, and
 * a table read would hand back client PAN, date of birth and bank details along
 * with the portfolio. The `nw_partner_*` functions project explicitly.
 *
 * `PARTNER_ACCESS_REVOKED` is the kill-switch firing: `nw_current_dsa_id()`
 * embeds the enabled and active checks, so an RM disabling a partner mid-session
 * makes every RPC raise. The right response is an immediate sign-out, not a
 * half-empty portal, so it is handled here rather than left to each screen.
 */
import { useCallback, useEffect, useState } from 'react';
import { PARTNER_ACCESS_REVOKED } from '@shared/partner/services/PartnerService';
import { useAuth } from '@/features/auth/AuthContext';

export interface PartnerQuery<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

export function usePartnerQuery<T>(
  load: () => Promise<T>,
  deps: unknown[] = [],
): PartnerQuery<T> {
  const { signOut } = useAuth();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        setData(await load());
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Could not load this.';
        if (message === PARTNER_ACCESS_REVOKED) {
          await signOut('revoked');
          return;
        }
        setError(message);
      } finally {
        setLoading(false);
      }
    },
    // `load` is a fresh closure each render; the caller's deps decide staleness.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [...deps],
  );

  useEffect(() => {
    void run();
  }, [run]);

  return { data, loading, error, refresh: () => void run(true) };
}
