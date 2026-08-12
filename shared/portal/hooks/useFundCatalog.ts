/**
 * useFundCatalog
 * -----------------------------------------------------------------------------
 * Loads the BSE scheme master once and exposes it plus its filter facets. Views
 * apply FundService.apply() over `schemes` for instant client-side filtering.
 */
import { useEffect, useMemo, useState } from 'react';
import { BSEService } from '../services/BSEService';
import { FundService } from '../services/FundService';
import type { FundScheme } from '../types/funds';

export function useFundCatalog() {
  const [schemes, setSchemes] = useState<FundScheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    BSEService.getSchemes()
      .then((data) => {
        if (alive) {
          setSchemes(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (alive) {
          setError(err instanceof Error ? err.message : 'Failed to load funds.');
          setLoading(false);
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  const facets = useMemo(() => FundService.facets(schemes), [schemes]);

  return { schemes, facets, loading, error };
}
