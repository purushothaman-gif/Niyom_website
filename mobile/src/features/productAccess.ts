/**
 * Product access for the app — the one implementation behind the client and
 * partner hooks (`client/useProductAccess`, `partner/useProductAccess`).
 *
 * The answer is cached per audience for the life of the session and refetched
 * whenever the signed-in identity changes, so a menu and a screen guard asking
 * the same question make one request between them.
 */
import { useCallback, useEffect, useState } from 'react';
import {
  NO_HIDDEN_PRODUCTS,
  fetchHiddenProducts,
  type ProductAudience,
  type ProductKey,
} from '@shared/lib/productAccess';
import type { NiyomDb } from '@shared/platform/db';

export interface ProductAccess {
  /** Switched-off product keys. Empty until loaded, and on error (fails open). */
  hidden: ReadonlySet<string>;
  /** True unless the product has been switched off for this person. */
  isEnabled: (product: ProductKey) => boolean;
  /** False until the first answer arrives — gate redirects on this, not menus. */
  ready: boolean;
  refresh: () => void;
}

const cache = new Map<string, ReadonlySet<string>>();

export function useProductAccessFor(
  db: NiyomDb,
  audience: ProductAudience,
  /** Who is signed in — the cache key. Empty/undefined = nobody, nothing fetched. */
  identity: string | null | undefined,
): ProductAccess {
  const key = identity ? `${audience}:${identity}` : '';
  const [hidden, setHidden] = useState<ReadonlySet<string>>(
    () => (key && cache.get(key)) || NO_HIDDEN_PRODUCTS,
  );
  const [ready, setReady] = useState(() => !!key && cache.has(key));
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!key) {
      setHidden(NO_HIDDEN_PRODUCTS);
      setReady(false);
      return;
    }
    const cached = cache.get(key);
    if (cached) {
      setHidden(cached);
      setReady(true);
    }
    let alive = true;
    void fetchHiddenProducts(db, audience).then((next) => {
      if (!alive) return;
      cache.set(key, next);
      setHidden(next);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [db, audience, key, tick]);

  const isEnabled = useCallback((product: ProductKey) => !hidden.has(product), [hidden]);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return { hidden, isEnabled, ready, refresh };
}
