// Partner Bonds module — self-contained screen machine (list | detail) with an
// Explore / My Orders tab bar. Loads the partner's priced bond list (their cost +
// their spread), reuses the shared filter panel and detail primitives, and lets
// the partner place an order for a client (routed to the RM). Share + marketing
// image are layered on in later phases via the detail actions.

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Segmented } from '../../../portal/components/Segmented';
import {
  PartnerService, PARTNER_ACCESS_REVOKED,
  type PartnerBond, type PartnerBondOrder,
} from '../../services/PartnerService';
import type { PartnerIdentity } from '../../types';
import { PartnerBondsList } from './PartnerBondsList';
import { PartnerBondDetail } from './PartnerBondDetail';
import { PartnerOrderModal } from './PartnerOrderModal';
import { PartnerMyOrders } from './PartnerMyOrders';
import { PartnerMarketingModal } from './PartnerMarketingModal';
import { PartnerShareModal } from './PartnerShareModal';

type Tab = 'explore' | 'orders';
type Screen = { name: 'list' } | { name: 'detail'; bond: PartnerBond };

export function BondsModule({ partner, onAccessRevoked }: { partner: PartnerIdentity | null; onAccessRevoked?: () => void }) {
  const [bonds, setBonds] = useState<PartnerBond[]>([]);
  const [orders, setOrders] = useState<PartnerBondOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('explore');
  const [screen, setScreen] = useState<Screen>({ name: 'list' });
  const [orderBond, setOrderBond] = useState<PartnerBond | null>(null);
  const [marketingBond, setMarketingBond] = useState<PartnerBond | null>(null);
  const [shareBond, setShareBond] = useState<PartnerBond | null>(null);

  const revoked = (msg: string) => msg === PARTNER_ACCESS_REVOKED;

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [b, o] = await Promise.all([PartnerService.getBonds(), PartnerService.getMyBondOrders()]);
      setBonds(b);
      setOrders(o);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to load';
      if (revoked(msg)) { onAccessRevoked?.(); return; }
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [onAccessRevoked]);

  useEffect(() => { void load(); }, [load]);

  const currentMarkup = bonds[0]?.self_markup_percent ?? 0;

  if (loading) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div>;
  }
  if (error) {
    return (
      <div className="rounded-token-xl border border-border bg-bg-elevated py-16 text-center">
        <AlertTriangle className="mx-auto mb-3 h-7 w-7 text-danger" />
        <p className="text-sm text-text-primary">Couldn’t load bonds. {error}</p>
        <button type="button" onClick={() => void load()} className="mt-4 rounded-token-md border border-border bg-bg-surface px-4 py-2 text-xs font-semibold text-text-primary hover:text-accent">Try again</button>
      </div>
    );
  }

  // Detail takes over the whole view.
  if (screen.name === 'detail') {
    return (
      <>
        <PartnerBondDetail
          bond={screen.bond}
          onBack={() => setScreen({ name: 'list' })}
          onOrder={() => setOrderBond(screen.bond)}
          onShare={() => setShareBond(screen.bond)}
          onMarketingImage={() => setMarketingBond(screen.bond)}
        />
        {orderBond && (
          <PartnerOrderModal
            bond={orderBond}
            defaultMargin={currentMarkup}
            onClose={() => setOrderBond(null)}
            onPlaced={() => { setOrderBond(null); void load(); setTab('orders'); setScreen({ name: 'list' }); }}
          />
        )}
        {marketingBond && (
          <PartnerMarketingModal bond={marketingBond} partner={partner} onClose={() => setMarketingBond(null)} />
        )}
        {shareBond && (
          <PartnerShareModal bond={shareBond} defaultMargin={currentMarkup} onClose={() => setShareBond(null)} />
        )}
      </>
    );
  }

  return (
    <div className="space-y-5">
      <Segmented<Tab>
        options={[
          { value: 'explore', label: 'Explore bonds', count: bonds.length || undefined },
          { value: 'orders', label: 'My Orders', count: orders.length || undefined },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'explore' ? (
        <PartnerBondsList
          bonds={bonds}
          currentMarkup={currentMarkup}
          onSaveMarkup={async (pct) => { await PartnerService.setBondMarkup(pct); await load(); }}
          onOpen={(bond) => setScreen({ name: 'detail', bond })}
        />
      ) : (
        <PartnerMyOrders orders={orders} onExplore={() => setTab('explore')} />
      )}
    </div>
  );
}
