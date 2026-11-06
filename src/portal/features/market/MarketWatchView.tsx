/**
 * Market Watch for the client and partner portals: the shared page, fed with
 * the portal's own client and the viewer's watchlisted funds.
 */
import { getDb } from '../../../../shared/platform/db';
import { MarketWatch } from '../../../components/marketWatch/MarketWatch';
import { useWatchlist } from '../../watchlist/Watchlist';

export function MarketWatchView({ surface }: { surface: 'client' | 'partner' }) {
  const wl = useWatchlist();
  return (
    <MarketWatch
      db={getDb(surface)}
      watchlistFundCodes={wl?.ready ? wl.refs('fund') : undefined}
      watchlistNoun={wl?.noun}
    />
  );
}
