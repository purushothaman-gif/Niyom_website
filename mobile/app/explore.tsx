/**
 * Explore — everything Niyom offers, on one screen.
 *
 * The website's Invest → Explore page: popular bonds, popular funds and
 * unlisted shares as rails, the client's own investments, and a short list of
 * products and tools. Every tile hands off to the product's own screen, which
 * owns the order flow and the KYC gating; nothing is bought from here.
 *
 * Which bonds and funds make the rails is decided in
 * `shared/market/explorePicks.ts`, not in this file.
 *
 * ## Mutual funds on the MF platform
 *
 * When mutual funds run on the MF platform (`mfSsoEnabled`), the Mutual Funds
 * tab is a single launch screen and the in-app fund catalogue is retired. So
 * this screen does not show fund rails that would lead into retired screens;
 * it shows one card that opens the Mutual Funds tab instead.
 *
 * ## Products switched off for this client
 *
 * A product an admin or RM has switched off has no rail and no tools entry.
 * That read fails open, because the order triggers refuse a switched-off
 * product server-side whatever this screen shows.
 */
import { useMemo } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import {
  Activity,
  ArrowLeftRight,
  FileBarChart,
  Gem,
  Landmark,
  LineChart,
  Sparkles,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react-native';
import { fmt } from '@shared/crm/utils';
import { curatedBonds, popularFunds } from '@shared/market/explorePicks';
import { mfSsoEnabled } from '@shared/platform/env';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import { buildDashboardData } from '@shared/portal/services/dashboardModel';
import type { CatalogFund } from '@shared/portal/types/funds';
import { space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { useBonds } from '@/features/client/bonds/queries';
import {
  BondTile,
  EmptyRail,
  Rail,
  RailSkeleton,
  ShareTile,
  TILE_WIDTH,
  TileRow,
} from '@/features/client/explore/ExploreCards';
import { useExploreShares, useHiddenProducts } from '@/features/client/explore/queries';
import { FundTile } from '@/features/client/mf/FundCards';
import { useFundCatalog } from '@/features/client/mf/queries';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Money, Delta } from '@/ui/Money';
import { ListRow } from '@/ui/kit';

/**
 * The category lists popular funds are drawn from, one fund per list per round.
 * AMFI category names are inconsistent, so these match on a substring.
 */
const FUND_LISTS: Array<(f: CatalogFund) => boolean> = [
  (f) => /flexi\s*cap/i.test(f.subCategory),
  (f) => /large\s*cap/i.test(f.subCategory) && !/mid/i.test(f.subCategory),
  (f) => /mid\s*cap/i.test(f.subCategory) && !/large/i.test(f.subCategory),
  (f) => /small\s*cap/i.test(f.subCategory),
  (f) => (f.returns['3Y'] ?? 0) >= 20,
  (f) => /hybrid|balanced/i.test(`${f.category} ${f.subCategory}`),
];

const by3Y = (a: CatalogFund, b: CatalogFund) => (b.returns['3Y'] ?? 0) - (a.returns['3Y'] ?? 0);

export default function Explore() {
  const p = usePalette();
  const clientId = useClientId();
  const hidden = useHiddenProducts(clientId);
  const showBonds = !hidden.has('bonds');
  const showShares = !hidden.has('unlisted-shares');
  const showFunds = !hidden.has('mutual-funds');
  const mfOnPlatform = mfSsoEnabled();

  const { snapshot, refreshedAt, loading: snapshotLoading, refresh } = useClientSnapshot(clientId);
  const summary = useMemo(
    () => (refreshedAt ? buildDashboardData(snapshot).summary : null),
    [refreshedAt, snapshot],
  );

  const bonds = useBonds();
  const shares = useExploreShares(showShares);
  const catalog = useFundCatalog();

  const popBonds = useMemo(() => curatedBonds(bonds.bonds), [bonds.bonds]);
  const popFunds = useMemo(() => {
    if (mfOnPlatform || !showFunds) return [];
    const ranked = catalog.funds.filter((f) => f.returns['3Y'] != null);
    return popularFunds(
      catalog.funds,
      catalog.recommendations.map((r) => r.amfiCode),
      FUND_LISTS.map((match) => ranked.filter(match).sort(by3Y)),
    );
  }, [mfOnPlatform, showFunds, catalog.funds, catalog.recommendations]);

  const reload = () => {
    refresh();
    bonds.reload();
    shares.reload();
    if (!mfOnPlatform) catalog.reload();
  };

  const tools: { key: string; label: string; subtitle: string; icon: LucideIcon; href: string }[] = [
    ...(showBonds
      ? [{
          key: 'bonds',
          label: 'Bonds',
          subtitle: bonds.bonds.length ? `${bonds.bonds.length} open` : 'Fixed income',
          icon: Landmark,
          href: '/bonds',
        }]
      : []),
    ...(showShares
      ? [{
          key: 'shares',
          label: 'Unlisted Shares',
          subtitle: shares.shares.length ? `${shares.shares.length} open` : 'Pre-IPO and unlisted companies',
          icon: Gem,
          href: '/shares',
        }]
      : []),
    ...(showFunds
      ? [{
          key: 'mf',
          label: 'Mutual Funds',
          subtitle: 'Holdings, investments and SIPs',
          icon: TrendingUp,
          href: '/(client)/invest',
        }]
      : []),
    {
      key: 'market',
      label: 'Market Watch',
      subtitle: 'Indices, gold, the rupee and fund movers',
      icon: Activity,
      href: '/market-watch',
    },
    {
      key: 'portfolio',
      label: 'My Portfolio',
      subtitle: 'Every holding, valued daily',
      icon: LineChart,
      href: '/(client)/portfolio',
    },
    {
      key: 'txns',
      label: 'Transactions',
      subtitle: 'Everything you have bought and sold',
      icon: ArrowLeftRight,
      href: '/transactions',
    },
    {
      key: 'reports',
      label: 'Reports & statements',
      subtitle: 'Downloadable statements',
      icon: FileBarChart,
      href: '/reports',
    },
  ];

  const gutter = { paddingHorizontal: space[5] };

  return (
    <Screen padded={false} onRefresh={reload} refreshing={snapshotLoading && !!refreshedAt}>
      <View style={gutter}>
        <ScreenHeader title="Explore" subtitle="Popular bonds, mutual funds and shares." showBack />
      </View>

      <View style={{ gap: space[7] }}>
        {/* --------------------------- Your investments --------------------- */}
        {summary && summary.holdingsCount > 0 ? (
          <View style={gutter}>
            <Card padding={5} onPress={() => router.push('/(client)/portfolio')}>
              <Text variant="overline" tone="muted" caps>
                Your investments
              </Text>
              <Money value={summary.netWorth} variant="money" style={{ marginTop: space[2] }} />
              <View style={{ marginTop: space[2] }}>
                <Delta amount={summary.gain} percent={summary.gainPercent} />
              </View>
              <Text variant="caption" tone="muted" style={{ marginTop: space[2] }}>
                {fmt(summary.invested)} invested · {summary.holdingsCount} holding
                {summary.holdingsCount === 1 ? '' : 's'}
              </Text>
            </Card>
          </View>
        ) : null}

        {/* ----------------------------- Popular bonds ---------------------- */}
        {showBonds ? (
          <Rail title="Popular Bonds" icon={Landmark} more="See more" onMore={() => router.push('/bonds')}>
            {bonds.loading ? (
              <RailSkeleton />
            ) : popBonds.length ? (
              <TileRow>
                {popBonds.map((b) => (
                  <BondTile key={b.id} bond={b} onPress={() => router.push(`/bond?id=${b.id}`)} />
                ))}
              </TileRow>
            ) : (
              <EmptyRail text="New bond offers are added regularly — check back soon." />
            )}
          </Rail>
        ) : null}

        {/* ----------------------------- Mutual funds ----------------------- */}
        {showFunds && mfOnPlatform ? (
          <View style={gutter}>
            <Card padding={5} onPress={() => router.push('/(client)/invest')}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[4] }}>
                <View style={{ flex: 1 }}>
                  <Text variant="h3">Mutual Funds</Text>
                  <Text variant="small" tone="muted" style={{ marginTop: space[2] }}>
                    Holdings, investments and SIPs open in our MF platform, with no separate sign-in.
                  </Text>
                </View>
                <TrendingUp size={24} color={p.accent.DEFAULT} />
              </View>
            </Card>
          </View>
        ) : null}

        {showFunds && !mfOnPlatform && (catalog.loading || popFunds.length > 0) ? (
          <Rail
            title="Popular Mutual Funds"
            icon={Sparkles}
            more="All mutual funds"
            onMore={() => router.push('/(client)/invest')}
          >
            {catalog.loading ? (
              <RailSkeleton />
            ) : (
              <TileRow>
                {popFunds.map((f) => (
                  <FundTile key={f.amfiCode} fund={f} width={TILE_WIDTH} />
                ))}
              </TileRow>
            )}
          </Rail>
        ) : null}

        {/* ---------------------------- Unlisted shares --------------------- */}
        {showShares ? (
          <Rail
            title="Unlisted Shares"
            icon={Gem}
            more="See more"
            onMore={() => router.push('/shares' as never)}
          >
            {shares.loading ? (
              <RailSkeleton />
            ) : shares.shares.length ? (
              <TileRow>
                {shares.shares.slice(0, 8).map((s) => (
                  <ShareTile
                    key={s.id}
                    share={s}
                    onPress={() => router.push(`/share?id=${s.id}` as never)}
                  />
                ))}
              </TileRow>
            ) : (
              <EmptyRail text="No unlisted shares are open right now." />
            )}
          </Rail>
        ) : null}

        {/* --------------------------- Products & tools --------------------- */}
        <View style={gutter}>
          <Text variant="h2" style={{ marginBottom: space[4] }}>
            Products & tools
          </Text>
          <Card padding={4}>
            {tools.map((t, i) => (
              <ListRow
                key={t.key}
                icon={t.icon}
                title={t.label}
                subtitle={t.subtitle}
                showChevron
                last={i === tools.length - 1}
                onPress={() => router.push(t.href as never)}
              />
            ))}
          </Card>
          <Text variant="caption" tone="faint" style={{ marginTop: space[4] }}>
            Fund returns are the scheme's own trailing returns from AMFI NAVs, not a forecast. Bond
            yields are at today's offer price.
          </Text>
        </View>
      </View>
    </Screen>
  );
}
