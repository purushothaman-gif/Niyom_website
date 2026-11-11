/**
 * Market Watch, client app. Reads as the signed-in client, and adds the 1-day
 * move of the funds on this phone's watchlist.
 */
import { getDb } from '@shared/platform/db';
import { MarketWatchScreen } from '@/features/market/MarketWatchScreen';
import { useWatchlist } from '@/features/client/mf/useWatchlist';

const clientDb = () => getDb('client');

export default function MarketWatch() {
  const watchlist = useWatchlist();
  return (
    <MarketWatchScreen
      getDb={clientDb}
      watchlistFundCodes={watchlist.ready ? watchlist.codes : undefined}
    />
  );
}
