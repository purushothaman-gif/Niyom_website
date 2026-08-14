/**
 * A watchlist, kept on the device.
 *
 * Deliberately NOT a table. There is no watchlist anywhere in the Niyom backend
 * and adding one would mean a migration, an RLS policy and a sync path — for a
 * list of funds someone is idly considering. Local storage is the honest scope
 * for that, and it costs nothing if the feature turns out not to be used.
 *
 * The trade is stated in the UI rather than hidden: this list lives on this
 * phone. If it later earns a place server-side, this hook is the only thing
 * that changes.
 */
import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'nw_mf_watchlist';

export function useWatchlist() {
  const [codes, setCodes] = useState<string[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(KEY)
      .then((raw) => {
        if (!alive) return;
        try {
          const parsed: unknown = raw ? JSON.parse(raw) : [];
          setCodes(Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === 'string') : []);
        } catch {
          setCodes([]);
        }
      })
      .catch(() => setCodes([]))
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback((next: string[]) => {
    setCodes(next);
    void AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {
      /* a failed write costs the bookmark, never the session */
    });
  }, []);

  const toggle = useCallback(
    (amfiCode: string) => {
      // Newest first, so a fund just added is at the top where it is looked for.
      persist(codes.includes(amfiCode) ? codes.filter((c) => c !== amfiCode) : [amfiCode, ...codes]);
    },
    [codes, persist],
  );

  const has = useCallback((amfiCode: string) => codes.includes(amfiCode), [codes]);

  return { codes, has, toggle, ready };
}
