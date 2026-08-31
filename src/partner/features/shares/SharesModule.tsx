// Partner Unlisted Shares module — self-contained screen machine (list | detail)
// with an Explore / My Orders tab bar. Loads the partner's priced share list
// (their cost + their spread), and lets the partner place an order for a client
// or mint a shareable offer link at a per-share margin.

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Segmented } from '../../../portal/components/Segmented';
import {
  PartnerService, PARTNER_ACCESS_REVOKED,
  type PartnerShare, type PartnerShareOrder,
} from '../../services/PartnerService';
import { PartnerSharesList } from './PartnerSharesList';
import { PartnerShareDetail } from './PartnerShareDetail';
import { PartnerShareOrderModal } from './PartnerShareOrderModal';
import { PartnerShareLinkModal } from './PartnerShareLinkModal';
import { PartnerMyShareOrders } from './PartnerMyShareOrders';

type Tab = 'explore' | 'orders';
type Screen = { name: 'list' } | { name: 'detail'; share: PartnerShare };

export function SharesModule({ onAccessRevoked }: { onAccessRevoked?: () => void }) {
  const [shares, setShares] = useState<PartnerShare[]>([]);
  const [orders, setOrders] = useState<PartnerShareOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('explore');
  const [screen, setScreen] = useState<Screen>({ name: 'list' });
  const [orderShare, setOrderShare] = useState<PartnerShare | null>(null);
  const [linkShare, setLinkShare] = useState<PartnerShare | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, o] = await Promise.all([PartnerService.getShares(), PartnerService.getMyShareOrders()]);
      setShares(s);
      setOrders(o);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load';
      if (msg === PARTNER_ACCESS_REVOKED) { onAccessRevoked?.(); return; }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [onAccessRevoked]);

  useEffect(() => { void load(); }, [load]);

  const currentMarkup = shares[0]?.self_markup_percent ?? 0;

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>;
  }
  if (error) {
    return (
      <div className="rounded-token-xl border border-border bg-bg-elevated py-16 text-center">
        <AlertTriangle className="mx-auto mb-3 h-7 w-7 text-danger" />
        <p className="text-sm text-text-primary">Couldn’t load unlisted shares. {error}</p>
        <button type="button" onClick={() => void load()}
          className="mt-4 rounded-token-md border border-border bg-bg-surface px-4 py-2 text-xs font-semibold text-text-primary hover:text-accent">
          Try again
        </button>
      </div>
    );
  }

  // Detail takes over the whole view.
  if (screen.name === 'detail') {
    return (
      <>
        <PartnerShareDetail
          share={screen.share}
          onBack={() => setScreen({ name: 'list' })}
          onOrder={() => setOrderShare(screen.share)}
          onShare={() => setLinkShare(screen.share)}
        />
        {orderShare && (
          <PartnerShareOrderModal
            share={orderShare}
            defaultMargin={currentMarkup}
            onClose={() => setOrderShare(null)}
            onPlaced={() => { setOrderShare(null); void load(); setTab('orders'); setScreen({ name: 'list' }); }}
          />
        )}
        {linkShare && (
          <PartnerShareLinkModal share={linkShare} defaultMargin={currentMarkup} onClose={() => setLinkShare(null)} />
        )}
      </>
    );
  }

  return (
    <div className="space-y-5">
      <Segmented<Tab>
        options={[
          { value: 'explore', label: 'Explore shares', count: shares.length || undefined },
          { value: 'orders', label: 'My Orders', count: orders.length || undefined },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'explore' ? (
        <PartnerSharesList
          shares={shares}
          currentMarkup={currentMarkup}
          onSaveMarkup={async (pct) => { await PartnerService.setShareMarkup(pct); await load(); }}
          onOpen={(share) => setScreen({ name: 'detail', share })}
        />
      ) : (
        <PartnerMyShareOrders orders={orders} onExplore={() => setTab('explore')} />
      )}
    </div>
  );
}
