/**
 * The signed-in client's BSE investment account.
 *
 * Scoped entirely by the proxy — it resolves the caller from their token and
 * answers only for their own UCC. Nothing here can widen that.
 */
import { useCallback, useEffect, useState } from 'react';
import { BseAccountService, type AccountState } from '../../services/BseAccountService';

export function useBseAccount(enabled: boolean) {
  const [state, setState] = useState<AccountState | null>(null);
  const [loading, setLoading] = useState(enabled);

  const load = useCallback(async () => {
    if (!enabled) {
      setState(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setState(await BseAccountService.getState());
    setLoading(false);
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, loading, refresh: load };
}
