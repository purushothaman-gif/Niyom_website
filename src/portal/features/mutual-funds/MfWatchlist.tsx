import { useEffect, useState, type ReactNode } from 'react';
import { LogoLoader } from '../../../components/LogoLoader';
import { useMfCatalog } from '../../hooks/useMfCatalog';
import { WatchlistTab } from '../../watchlist/Watchlist';
import { FundCard } from '../explore/cards';
import { CatalogFundPage } from './explore/CatalogFundPage';
import type { CatalogFund } from '../../types/funds';

/** Mutual Funds → Watchlist: starred funds, each opening its research page. */
export function MfWatchlist({ fundInvest, onExplore }: { fundInvest: (fund: CatalogFund) => ReactNode; onExplore: () => void }) {
  const catalog = useMfCatalog();
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [open]);

  if (catalog.loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <LogoLoader size={40} />
      </div>
    );
  }

  const fund = open ? catalog.funds.find((f) => f.amfiCode === open) : null;
  if (fund) {
    return (
      <CatalogFundPage
        fund={fund}
        schemes={[]}
        gate={null}
        onBack={() => setOpen(null)}
        onInvest={() => undefined}
        platformInvest={fundInvest(fund)}
      />
    );
  }

  return (
    <WatchlistTab
      type="fund"
      items={catalog.funds}
      idOf={(f) => f.amfiCode}
      what="funds"
      onExplore={onExplore}
      render={(f) => <FundCard fund={f} onOpen={() => setOpen(f.amfiCode)} />}
    />
  );
}
