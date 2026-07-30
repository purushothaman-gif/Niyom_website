/**
 * useBseData — generic loader for the console's live BSE panels.
 * Mirrors useAdminDashboard's { data, loading, error, refresh } shape so the
 * views all read the same way.
 */
import { useCallback, useEffect, useState } from 'react';

export function useBseData<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await load());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reach BSE.');
    } finally {
      setLoading(false);
    }
    // `load` is expected to be a stable module-level fn (BseOpsService.*).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  return { data, loading, error, refresh: run };
}
