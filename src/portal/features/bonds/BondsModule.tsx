// Client Bonds module — a self-contained screen machine (list → detail → order →
// my orders), mirroring the Mutual Funds module's shape. Loads the client's
// priced bond list and their own orders; ordering routes to the RM via the
// place-bond-order edge function. Prices shown are the client's approved,
// indicative marked-up price only.

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { LogoLoader } from '../../../components/LogoLoader';
import { Segmented } from '../../components/Segmented';
import {
  BondOrderService,
  type BondOrder,
  type ClientBond,
} from '../../../../shared/portal/services/BondOrderService';
import { BondsListPage } from './BondsListPage';
import { BondDetailPage } from './BondDetailPage';
import { BondOrderFlow } from './BondOrderFlow';
import { MyOrdersPage } from './MyOrdersPage';

type Tab = 'explore' | 'orders';

type Screen =
  | { name: 'list' }
  | { name: 'detail'; bond: ClientBond }
  | { name: 'order'; bond: ClientBond; units: number };

export function BondsModule({
  clientId,
  onboardingComplete,
}: {
  clientId: string;
  /** True once KYC is verified — gates placing an order (not browsing). */
  onboardingComplete: boolean;
}) {
  const [bonds, setBonds] = useState<ClientBond[]>([]);
  const [orders, setOrders] = useState<BondOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('explore');
  const [screen, setScreen] = useState<Screen>({ name: 'list' });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, o] = await Promise.all([
        BondOrderService.getBonds(),
        BondOrderService.getMyOrders(clientId),
      ]);
      setBonds(b);
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
        <p className="text-sm text-text-primary">Couldn’t load bonds. {error}</p>
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

  // --- Detail / order flow take over the whole view ------------------------
  if (screen.name === 'detail') {
    return (
      <BondDetailPage
        bond={screen.bond}
        canInvest={onboardingComplete}
        onBack={goList}
        onInvest={(units) => setScreen({ name: 'order', bond: screen.bond, units })}
      />
    );
  }

  if (screen.name === 'order') {
    return (
      <BondOrderFlow
        bond={screen.bond}
        units={screen.units}
        clientId={clientId}
        onBack={() => setScreen({ name: 'detail', bond: screen.bond })}
        onDone={() => {
          void load();
          setTab('orders');
          goList();
        }}
      />
    );
  }

  // --- List view: Explore / My Orders --------------------------------------
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
        <BondsListPage bonds={bonds} onOpen={(bond) => setScreen({ name: 'detail', bond })} />
      ) : (
        <MyOrdersPage orders={orders} onExplore={() => setTab('explore')} />
      )}
    </div>
  );
}
