// Client Unlisted Shares module — a self-contained screen machine (list → detail
// → order → my orders), mirroring the Bonds module's shape. Loads the client's
// priced share list and their own orders; ordering routes to the RM through the
// place-share-order edge function. Prices shown are the client's approved,
// indicative marked-up price only.

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { LogoLoader } from '../../../components/LogoLoader';
import { ProductHoldings, ProductTabs } from '../../components/ProductTabs';
import { WatchlistTab, WatchStar } from '../../watchlist/Watchlist';
import { ShareCard } from '../explore/cards';
import type { PortalHolding } from '../../types/cas';
import {
  ShareOrderService,
  type ShareOrder,
  type ClientShare,
} from '../../../../shared/portal/services/ShareOrderService';
import { SharesListPage } from './SharesListPage';
import { ShareDetailPage } from './ShareDetailPage';
import { ShareOrderFlow } from './ShareOrderFlow';
import { MyShareOrdersPage } from './MyShareOrdersPage';

type Tab = 'explore' | 'holdings' | 'orders' | 'watchlist';

type Screen =
  | { name: 'list' }
  | { name: 'detail'; share: ClientShare }
  | { name: 'order'; share: ClientShare; qty: number };

export function SharesModule({
  clientId,
  onboardingComplete,
  initialShareId = null,
  onInitialConsumed,
  holdings = [],
}: {
  clientId: string;
  /** The client's holdings — this product's rows feed the Holdings tab. */
  holdings?: PortalHolding[];
  /** Open this share's detail page once the list has loaded (from Explore). */
  initialShareId?: string | null;
  onInitialConsumed?: () => void;
  /** True once KYC is verified — gates placing an order (not browsing). */
  onboardingComplete: boolean;
}) {
  const [shares, setShares] = useState<ClientShare[]>([]);
  const [orders, setOrders] = useState<ShareOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('explore');
  const [screen, setScreen] = useState<Screen>({ name: 'list' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, o] = await Promise.all([
        ShareOrderService.getShares(),
        ShareOrderService.getMyOrders(clientId),
      ]);
      setShares(s);
      setOrders(o);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Deep link from Explore: open the picked share once, then forget it.
  useEffect(() => {
    if (loading || !initialShareId) return;
    const hit = shares.find((x) => x.id === initialShareId);
    if (hit) setScreen({ name: 'detail', share: hit });
    onInitialConsumed?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, initialShareId, shares]);

  const goList = () => setScreen({ name: 'list' });

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <LogoLoader size={52} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-md py-16 text-center">
        <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-danger" />
        <p className="text-sm text-text-primary">Couldn’t load unlisted shares. {error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-4 rounded-token-md border border-border bg-bg-surface px-4 py-2 text-xs font-semibold text-text-primary hover:text-accent"
        >
          Try again
        </button>
      </div>
    );
  }

  if (screen.name === 'detail') {
    return (
      <div className="relative">
        <div className="absolute right-0 top-0 z-10">
          <WatchStar variant="pill" type="share" itemRef={screen.share.id} />
        </div>
        <ShareDetailPage
          share={screen.share}
          canInvest={onboardingComplete}
          onBack={goList}
          onInvest={(qty) => setScreen({ name: 'order', share: screen.share, qty })}
        />
      </div>
    );
  }

  if (screen.name === 'order') {
    return (
      <ShareOrderFlow
        share={screen.share}
        qty={screen.qty}
        clientId={clientId}
        onBack={() => setScreen({ name: 'detail', share: screen.share })}
        onDone={() => {
          void load();
          setTab('orders');
          goList();
        }}
      />
    );
  }

  return (
    <div className="space-y-5">
      <ProductTabs<Tab>
        tabs={[
          { key: 'explore', label: 'Explore', count: shares.length || undefined },
          { key: 'holdings', label: 'Holdings' },
          { key: 'orders', label: 'Orders', count: orders.length || undefined },
          { key: 'watchlist', label: 'Watchlist' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'explore' ? (
        <SharesListPage shares={shares} onOpen={(share) => setScreen({ name: 'detail', share })} />
      ) : tab === 'watchlist' ? (
        <WatchlistTab
          type="share"
          items={shares}
          idOf={(x) => x.id}
          what="shares"
          onExplore={() => setTab('explore')}
          render={(b) => <ShareCard share={b} price={b.client_price} onOpen={() => setScreen({ name: 'detail', share: b })} />}
        />
      ) : tab === 'holdings' ? (
        <ProductHoldings holdings={holdings} asset="unlisted_share" title="Unlisted shares" onExplore={() => setTab('explore')} />
      ) : (
        <MyShareOrdersPage orders={orders} onExplore={() => setTab('explore')} />
      )}
    </div>
  );
}
