/**
 * Market Watch data for a screen.
 *
 * Reads only our own cache tables through `shared/market/marketWatch.ts` (the
 * same module the website runs), never a market API. The caller passes its own
 * surface's database handle, so a client screen reads as the client and a
 * partner screen as the partner.
 *
 * Refreshes every minute while the app is in the foreground. The website gates
 * its timer on `document.visibilityState`; `AppState` is the phone's version of
 * that, and it matters more here because a backgrounded app polling is battery
 * spent on a screen nobody is looking at.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  loadFundMoves,
  loadMarketSnapshot,
  type FundMove,
  type MarketSnapshot,
} from '@shared/market/marketWatch';

const REFRESH_MS = 60_000;

type Db = Parameters<typeof loadMarketSnapshot>[0];

export interface MarketWatchState {
  snapshot: MarketSnapshot | null;
  /** 1-day moves of the viewer's watchlisted funds, biggest first. */
  watched: FundMove[];
  loading: boolean;
  error: string | null;
  /** When we last checked (ISO), which is not when the figures were struck. */
  checkedAt: string | null;
  reload: () => void;
}

export function useMarketWatch(
  getDb: () => Db,
  watchlistFundCodes: string[] = [],
  /** Sees every failure message; the partner screen uses it for the kill-switch. */
  onError?: (message: string) => void,
): MarketWatchState {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [watched, setWatched] = useState<FundMove[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const codesKey = useMemo(() => watchlistFundCodes.slice().sort().join(','), [watchlistFundCodes]);

  // Refs, so the polling effect is not torn down by a new closure each render.
  const getDbRef = useRef(getDb);
  getDbRef.current = getDb;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const db = getDbRef.current();
      const [s, w] = await Promise.all([
        loadMarketSnapshot(db),
        loadFundMoves(db, codesKey ? codesKey.split(',') : []),
      ]);
      setSnapshot(s);
      setWatched(w);
      setError(null);
      setCheckedAt(new Date().toISOString());
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : typeof (e as { message?: unknown })?.message === 'string'
            ? (e as { message: string }).message
            : 'Could not load market data.';
      onErrorRef.current?.(message);
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [codesKey]);

  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (AppState.currentState === 'active') void load();
    }, REFRESH_MS);
    // Coming back to the app should not show minute-old figures until the tick.
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [load]);

  return { snapshot, watched, loading, error, checkedAt, reload: () => void load() };
}
