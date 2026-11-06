/**
 * The always-visible market strip: NIFTY 50, SENSEX, gold and silver.
 *
 * A slim band directly under each surface's header (CRM, client portal,
 * partner portal), in normal page flow, so it never covers content and does not
 * move anything except by its own fixed height, which is reserved from the
 * first paint. When the items do not fit it runs as a ticker (paused on hover);
 * otherwise it sits still. Clicking
 * it opens the full Market Watch page. Reads only our cache tables, like the
 * page itself; hovering an item shows its as-of time.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Activity, ChevronRight } from 'lucide-react';
import { fmtSignedPct, loadTicker, toneOfChange, type TickerItem } from '../../../shared/market/marketWatch';

const REFRESH_MS = 60_000;

const tone = { up: 'text-success', down: 'text-danger', flat: 'text-text-secondary' } as const;

function Items({ items, hidden, innerRef }: { items: TickerItem[]; hidden?: boolean; innerRef?: Ref<HTMLDivElement> }) {
  return (
    <div
      ref={innerRef}
      className={`flex shrink-0 items-center ${hidden ? 'nw-ticker-dup' : ''}`}
      aria-hidden={hidden || undefined}
    >
      {items.map((i) => {
        const t = toneOfChange(i.changePct);
        return (
          <span key={i.key} title={`As of ${i.asOf}`} className="flex shrink-0 items-center gap-1.5 whitespace-nowrap px-3">
            <span className="font-semibold text-text-secondary">{i.label}</span>
            <span className="font-semibold tabular-nums text-text-primary">{i.value}</span>
            <span className={`font-semibold tabular-nums ${tone[t]}`}>
              {t === 'up' ? '▲' : t === 'down' ? '▼' : ''} {fmtSignedPct(i.changePct)}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function MarketTicker({
  db,
  onOpen,
}: {
  // Any surface's client; the tables are anon-readable market data.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: SupabaseClient<any, any, any>;
  onOpen?: () => void;
}) {
  const [items, setItems] = useState<TickerItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  // Scroll only when the items do not fit; a still strip reads better.
  const [running, setRunning] = useState(false);
  const viewportRef = useRef<HTMLSpanElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const vp = viewportRef.current;
    const it = itemsRef.current;
    if (!vp || !it) return;
    const measure = () => setRunning(it.scrollWidth > vp.clientWidth + 1);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(vp);
    ro.observe(it);
    return () => ro.disconnect();
  }, [items]);

  const load = useCallback(() => {
    loadTicker(db)
      .then((r) => {
        setItems(r);
        setFailed(false);
      })
      .catch(() => setFailed(true));
  }, [db]);

  useEffect(() => {
    load();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  // A strip with nothing to say is noise: drop it rather than show an error.
  if (failed && !items?.length) return null;
  if (items && !items.length) return null;

  return (
    <div className="nw-ticker flex h-8 shrink-0 items-center overflow-hidden border-b border-border-subtle bg-bg-surface text-xs">
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        aria-label="Open Market Watch"
        className="flex h-full min-w-0 flex-1 items-center text-left disabled:cursor-default"
      >
        <span className="relative z-10 flex h-full shrink-0 items-center gap-1.5 border-r border-border-subtle bg-bg-surface pl-3 pr-2 font-semibold text-accent sm:pl-4">
          <Activity className="h-3.5 w-3.5" aria-hidden />
          <span className="hidden sm:inline">Markets</span>
        </span>
        <span ref={viewportRef} className="nw-ticker-viewport relative h-full min-w-0 flex-1 overflow-hidden">
          {items && (
            <span className={`nw-ticker-track absolute inset-y-0 left-0 flex items-center ${running ? 'is-running' : ''}`}>
              <Items items={items} innerRef={itemsRef} />
              {running && <Items items={items} hidden />}
            </span>
          )}
        </span>
        {onOpen && (
          <span className="hidden h-full shrink-0 items-center gap-0.5 border-l border-border-subtle pl-3 pr-4 font-semibold text-accent sm:flex">
            Market Watch <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </span>
        )}
      </button>
    </div>
  );
}
