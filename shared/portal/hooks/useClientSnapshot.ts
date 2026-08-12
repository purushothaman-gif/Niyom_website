/**
 * useClientSnapshot
 * -----------------------------------------------------------------------------
 * Single source of client wealth data for the whole portal. Fetches the
 * client + holdings + transactions ONCE, then every view (dashboard, portfolio,
 * allocation) derives its own view models from this snapshot via useMemo — no
 * duplicate queries, and one refresh updates everything consistently.
 */
import { useCallback, useEffect, useState } from 'react';
import { HoldingService, type ClientWealthSnapshot } from '../services/HoldingService';

interface SnapshotState {
  snapshot: ClientWealthSnapshot;
  loading: boolean;
  error: string | null;
  refreshedAt: Date | null;
}

const EMPTY: ClientWealthSnapshot = {
  client: null,
  holdings: [],
  transactions: [],
  mfSource: 'manual',
  casStatementTo: null,
  casFreshness: { state: 'none', statementTo: null, latestOwnMfTxnDate: null },
  casFlows: [],
  historyComplete: true,
  casStatementFrom: null,
  dayChange: null,
  valuedOn: null,
};

export function useClientSnapshot(clientId: string) {
  const [state, setState] = useState<SnapshotState>({
    snapshot: EMPTY,
    loading: true,
    error: null,
    refreshedAt: null,
  });

  const load = useCallback(
    async (silent = false) => {
      setState((s) => ({ ...s, loading: !silent, error: null }));
      try {
        const snapshot = await HoldingService.getSnapshot(clientId);
        setState({ snapshot, loading: false, error: null, refreshedAt: new Date() });
      } catch (err) {
        setState((s) => ({
          ...s,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to load your portfolio.',
        }));
      }
    },
    [clientId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => load(true), [load]);

  return { ...state, refresh };
}
