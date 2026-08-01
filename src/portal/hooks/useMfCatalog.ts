/**
 * useMfCatalog
 * -----------------------------------------------------------------------------
 * Loads the curated fund catalog and the staff recommendation shelf once for
 * the whole Mutual Funds module. Both come from published/house data, not from
 * the client's own records, so one fetch serves every Explore screen.
 *
 * The recommendation shelf failing is not the catalog failing: a missing shelf
 * hides a section, while a missing catalog is what the error state is for.
 */
import { useCallback, useEffect, useState } from 'react';
import { MfCatalogService } from '../services/MfCatalogService';
import type { CatalogFund, FundRecommendation } from '../types/funds';

interface State {
  funds: CatalogFund[];
  recommendations: FundRecommendation[];
  loading: boolean;
  error: string | null;
}

export function useMfCatalog() {
  const [state, setState] = useState<State>({
    funds: [],
    recommendations: [],
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [funds, recommendations] = await Promise.all([
        MfCatalogService.list(),
        MfCatalogService.recommendations().catch(() => [] as FundRecommendation[]),
      ]);
      setState({ funds, recommendations, loading: false, error: null });
    } catch (err) {
      setState({
        funds: [],
        recommendations: [],
        loading: false,
        error: err instanceof Error ? err.message : 'Could not load funds right now.',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { ...state, reload: load };
}
