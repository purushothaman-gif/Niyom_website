/**
 * useRtaMf
 * -----------------------------------------------------------------------------
 * The signed-in client's mutual funds as the REGISTRAR reports them — holdings
 * and live systematic plans imported daily from the CAMS/KFintech mailback
 * feeds (mf_rta_* tables). Reads on the 'client' surface, so RLS returns only
 * this client's own rows.
 *
 * This is the authoritative "what you actually hold" list, kept apart from the
 * Explore catalog and the BSE order rail. It is read-only and self-updating.
 */
import { useCallback, useEffect, useState } from 'react';
import { getDb } from '../../platform/db';
import { fetchRtaMf, type RtaMfData } from '../../mf/rtaMf';

export function useRtaMf(clientId: string) {
  const [data, setData] = useState<RtaMfData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchRtaMf(getDb('client'), clientId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your mutual funds right now.');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, error, refresh: load };
}
