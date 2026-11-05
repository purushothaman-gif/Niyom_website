/**
 * Watchlist UI: a provider (one per portal — client or partner), a star
 * toggle any card can render, and the Watchlist tab body.
 *
 * Cards render a star only when a provider is present, so the same card works
 * on pages that have no watchlist without any prop plumbing.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Star } from 'lucide-react';
import { getDb, type DbSurface } from '../../../shared/platform/db';
import { WatchlistService, watchKey, type WatchType } from '../../../shared/watchlist/WatchlistService';

interface Ctx {
  has: (type: WatchType, ref: string) => boolean;
  toggle: (type: WatchType, ref: string) => void;
  refs: (type: WatchType) => string[];
  ready: boolean;
  /** "Watchlist" for clients, "Shortlist" for partners. */
  noun: string;
}

const WatchlistCtx = createContext<Ctx | null>(null);

export function useWatchlist(): Ctx | null {
  return useContext(WatchlistCtx);
}

export function WatchlistProvider({
  surface,
  demo,
  noun = 'Watchlist',
  children,
}: {
  surface: DbSurface;
  /** Sample portals keep the list in the session instead of the database. */
  demo: boolean;
  noun?: string;
  children: ReactNode;
}) {
  const [keys, setKeys] = useState<Set<string>>(new Set());
  const [ready, setReady] = useState(false);
  const db = demo ? null : getDb(surface);

  useEffect(() => {
    let alive = true;
    WatchlistService.list(db, surface)
      .then((s) => alive && setKeys(s))
      .catch(() => undefined)
      .finally(() => alive && setReady(true));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [surface, demo]);

  const toggle = useCallback(
    (type: WatchType, ref: string) => {
      const k = watchKey(type, ref);
      const on = keys.has(k);
      // Optimistic: flip now, roll back if the write fails.
      setKeys((prev) => {
        const next = new Set(prev);
        if (on) next.delete(k);
        else next.add(k);
        return next;
      });
      (on ? WatchlistService.remove(db, type, ref, surface) : WatchlistService.add(db, type, ref, surface)).catch(() =>
        setKeys((prev) => {
          const next = new Set(prev);
          if (on) next.add(k);
          else next.delete(k);
          return next;
        }),
      );
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [keys, surface, demo],
  );

  const value = useMemo<Ctx>(
    () => ({
      has: (t, r) => keys.has(watchKey(t, r)),
      toggle,
      refs: (t) => [...keys].filter((k) => k.startsWith(`${t}:`)).map((k) => k.slice(t.length + 1)),
      ready,
      noun,
    }),
    [keys, toggle, ready, noun],
  );

  return <WatchlistCtx.Provider value={value}>{children}</WatchlistCtx.Provider>;
}

/** Star toggle. Renders nothing without a provider. */
export function WatchStar({
  type,
  itemRef,
  variant = 'icon',
  className = '',
}: {
  type: WatchType;
  itemRef: string;
  /** 'icon' for cards, 'pill' (with a label) for detail pages. */
  variant?: 'icon' | 'pill';
  className?: string;
}) {
  const w = useWatchlist();
  if (!w) return null;
  const on = w.has(type, itemRef);
  const label = on ? `Remove from ${w.noun.toLowerCase()}` : `Add to ${w.noun.toLowerCase()}`;
  const onClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    w.toggle(type, itemRef);
  };
  if (variant === 'pill') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={on}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
          on ? 'border-accent/40 bg-accent/10 text-accent' : 'border-border bg-bg-surface text-text-secondary hover:text-accent'
        } ${className}`}
      >
        <Star className={`h-3.5 w-3.5 ${on ? 'fill-current' : ''}`} />
        {on ? `In ${w.noun.toLowerCase()}` : w.noun === 'Shortlist' ? 'Shortlist' : 'Watch'}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
        on ? 'text-accent' : 'text-text-faint hover:bg-bg-surface hover:text-accent'
      } ${className}`}
    >
      <Star className={`h-4 w-4 ${on ? 'fill-current' : ''}`} />
    </button>
  );
}

/**
 * The Watchlist tab body: a grid of the watched items (rendered by the caller,
 * which owns the catalogue), or a Groww-style empty state.
 */
export function WatchlistTab<T>({
  type,
  items,
  idOf,
  render,
  what,
  onExplore,
}: {
  type: WatchType;
  /** The product's full catalogue; filtered here to what is watched. */
  items: T[];
  idOf: (item: T) => string;
  render: (item: T) => ReactNode;
  /** "bonds", "funds", "shares". */
  what: string;
  onExplore: () => void;
}) {
  const w = useWatchlist();
  const watched = useMemo(() => {
    if (!w) return [];
    const set = new Set(w.refs(type));
    return items.filter((i) => set.has(idOf(i)));
  }, [w, items, idOf, type]);

  if (!w) return null;
  if (!watched.length) {
    return (
      <div className="flex flex-col items-center gap-6 rounded-token-xl border border-border bg-bg-elevated px-6 py-14 text-center shadow-token-card sm:flex-row sm:justify-center sm:text-left">
        <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-accent/10">
          <Star className="h-10 w-10 text-accent" />
        </span>
        <div>
          <p className="font-display text-lg font-bold text-text-primary">
            {w.noun === 'Shortlist' ? `No ${what} shortlisted` : `Not watching any ${what}`}
          </p>
          <p className="mt-1 max-w-sm text-sm text-text-secondary">
            {w.noun === 'Shortlist'
              ? `Tap the star on any ${what.replace(/s$/, '')} to keep it here, ready to pitch.`
              : `Tap the star on any ${what.replace(/s$/, '')} to keep an eye on it here.`}
          </p>
          <button
            type="button"
            onClick={onExplore}
            className="mt-5 rounded-token-md bg-accent px-5 py-2.5 text-sm font-bold text-on-accent hover:bg-accent-strong"
          >
            Explore all {what}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
      {watched.map((i) => (
        <div key={idOf(i)}>{render(i)}</div>
      ))}
    </div>
  );
}
