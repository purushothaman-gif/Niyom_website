/**
 * Mutual Funds — four views of one product.
 *
 * Explore / Dashboard / SIPs / Watchlist sit as TOP tabs rather than as
 * separate destinations, which is the arrangement every Indian investing app
 * has converged on. It is not imitation: the bottom bar has five slots and
 * three are already spoken for by Home, Portfolio and More, so four views of
 * the fund product cannot each have one. They belong here, together.
 *
 * The catalog is ~9,600 funds, so the "All funds" list is a FlatList with a
 * memoised row. Explore is a ScrollView because it is a fixed number of
 * shelves.
 */
import { useCallback, useMemo, useState } from 'react';
import { FlatList, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Bookmark, ChevronLeft, Search, ShieldCheck } from 'lucide-react-native';
import { Pressable } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { fmt } from '@shared/crm/utils';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import { onboardingIncomplete } from '@shared/portal/onboarding/onboardingSteps';
import { buildDashboardData } from '@shared/portal/services/dashboardModel';
import { isBseMock } from '@shared/portal/services/bse/gateway';
import type { CatalogFund } from '@shared/portal/types/funds';
import { space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ExploreTab, COLLECTIONS, type Collection } from '@/features/client/mf/ExploreTab';
import { useFundCatalog } from '@/features/client/mf/queries';
import { FundRow } from '@/features/client/mf/FundCards';
import { useWatchlist } from '@/features/client/mf/useWatchlist';
import { Screen, TAB_BAR_HEIGHT } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Money, Delta } from '@/ui/Money';
import { Input } from '@/ui/Input';
import { Button } from '@/ui/Button';
import { TopTabs } from '@/ui/TopTabs';
import { EmptyState, ErrorState, KpiStat, Segmented, SkeletonScreen } from '@/ui/kit';

type Tab = 'explore' | 'dashboard' | 'all' | 'watchlist';
type Period = '1Y' | '3Y' | '5Y';

export default function Invest() {
  const clientId = useClientId();
  const p = usePalette();
  const { funds, recommendations, loading, error, reload } = useFundCatalog();
  const { snapshot, refreshedAt } = useClientSnapshot(clientId);
  const watchlist = useWatchlist();

  const [tab, setTab] = useState<Tab>('explore');
  const [query, setQuery] = useState('');
  const [period, setPeriod] = useState<Period>('3Y');
  /** Set when a Collection is opened, which filters the All-funds list. */
  const [collection, setCollection] = useState<Collection | null>(null);

  const client = snapshot.client;
  const kycPending = !!client && onboardingIncomplete(client);

  const openCollection = useCallback((c: Collection) => {
    setCollection(c);
    setQuery('');
    setTab('all');
  }, []);

  const listed = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return funds
      .filter((f) => (collection ? collection.match(f) : true))
      .filter(
        (f) =>
          !needle ||
          f.name.toLowerCase().includes(needle) ||
          f.amc.toLowerCase().includes(needle),
      )
      .sort((a, b) => {
        // Nulls last — a fund with no history is not a fund that returned 0%.
        const av = a.returns[period];
        const bv = b.returns[period];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        return bv - av;
      });
  }, [funds, query, period, collection]);

  const watched = useMemo(
    () => watchlist.codes.map((c) => funds.find((f) => f.amfiCode === c)).filter((f): f is CatalogFund => !!f),
    [watchlist.codes, funds],
  );

  const mf = useMemo(
    () => (refreshedAt ? buildDashboardData(snapshot).mutualFunds : null),
    [refreshedAt, snapshot],
  );

  const tabs = [
    { value: 'explore' as const, label: 'Explore' },
    { value: 'dashboard' as const, label: 'Dashboard' },
    { value: 'all' as const, label: 'All funds' },
    { value: 'watchlist' as const, label: 'Watchlist', badge: watched.length || undefined },
  ];

  /*
   * No `tabBarInset` on the Screen, deliberately. Each tab below owns a
   * scrolling list that already reserves the tab bar's height in its own
   * content padding — asking the Screen to reserve it as well shortens the
   * scroll area AND pads the content, leaving a dead gap under every list.
   * A non-scrolling Screen should let its scrolling child run under the bar.
   */
  return (
    <Screen scroll={false} padded={false}>
      <View style={{ paddingHorizontal: space[5], paddingBottom: space[3] }}>
        <Text variant="h1">Mutual Funds</Text>
      </View>

      <TopTabs
        tabs={tabs}
        value={tab}
        onChange={(next) => {
          if (next !== 'all') setCollection(null);
          setTab(next);
        }}
      />

      {kycPending ? (
        <View style={{ paddingHorizontal: space[5], paddingTop: space[4] }}>
          <Card padding={4} onPress={() => router.push('/onboarding')} style={{ borderColor: p.accent.tint(0.4) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
              <ShieldCheck size={19} color={p.accent.DEFAULT} />
              <View style={{ flex: 1 }}>
                <Text variant="smallMedium">Finish your KYC to invest</Text>
                <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                  Browsing is open — placing an order needs an active account.
                </Text>
              </View>
            </View>
          </Card>
        </View>
      ) : null}

      {loading && funds.length === 0 ? (
        <View style={{ padding: space[5] }}>
          <SkeletonScreen rows={4} />
        </View>
      ) : error ? (
        <View style={{ padding: space[5] }}>
          <ErrorState message={error} onRetry={reload} />
        </View>
      ) : tab === 'explore' ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT + space[8] }}>
          <ExploreTab
            funds={funds}
            recommendations={recommendations}
            onOpenAll={() => setTab('all')}
            onOpenCollection={openCollection}
          />
        </ScrollView>
      ) : tab === 'dashboard' ? (
        <MfDashboard mf={mf} onExplore={() => setTab('explore')} />
      ) : tab === 'watchlist' ? (
        <WatchlistTab funds={watched} period={period} watchlist={watchlist} onExplore={() => setTab('explore')} />
      ) : (
        <AllFunds
          funds={listed}
          period={period}
          setPeriod={setPeriod}
          query={query}
          setQuery={setQuery}
          collection={collection}
          onClearCollection={() => setCollection(null)}
          watchlist={watchlist}
          loading={loading}
          onRefresh={reload}
        />
      )}

      {isBseMock() ? (
        <Text variant="caption" tone="faint" center style={{ paddingVertical: space[2] }}>
          Illustrative catalog — the live exchange connection is not enabled.
        </Text>
      ) : null}
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */

function MfDashboard({
  mf,
  onExplore,
}: {
  mf: ReturnType<typeof buildDashboardData>['mutualFunds'] | null;
  onExplore: () => void;
}) {
  if (!mf || mf.folioCount === 0) {
    return (
      <ScrollView contentContainerStyle={{ padding: space[5] }}>
        <EmptyState
          icon={Bookmark}
          title="No fund holdings yet"
          message="Once you invest — or import your statement — your funds and their returns appear here."
          action={<Button label="Explore funds" onPress={onExplore} />}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ padding: space[5], paddingBottom: TAB_BAR_HEIGHT + space[8], gap: space[5] }}
    >
      <Animated.View entering={FadeIn.duration(240)}>
        <Card padding={5}>
          <Text variant="overline" tone="muted" caps>
            Current value · {mf.folioCount} folio{mf.folioCount === 1 ? '' : 's'}
          </Text>
          <Money value={mf.value} variant="money" animate style={{ marginTop: space[2] }} />
          <View style={{ marginTop: space[2] }}>
            <Delta amount={mf.gain} percent={mf.gainPercent} variant="bodyMedium" />
          </View>
          <View style={{ flexDirection: 'row', gap: space[3], marginTop: space[4] }}>
            <KpiStat label="Invested" value={fmt(mf.invested)} />
            <KpiStat
              label="Returns"
              value={fmt(mf.gain)}
              tone={mf.gain >= 0 ? 'success' : 'danger'}
            />
          </View>
        </Card>
      </Animated.View>

      {mf.topFunds.length > 0 ? (
        <View>
          <Text variant="overline" tone="muted" caps style={{ marginBottom: space[3] }}>
            Your funds
          </Text>
          <Card padding={4}>
            {mf.topFunds.map((f, i, arr) => (
              <View
                key={`${f.name}-${f.folioNumber ?? i}`}
                style={{
                  flexDirection: 'row',
                  paddingVertical: space[3],
                  gap: space[3],
                  borderBottomWidth: i === arr.length - 1 ? 0 : 1,
                  borderBottomColor: 'transparent',
                }}
              >
                <View style={{ flex: 1 }}>
                  <Text variant="smallMedium" numberOfLines={2}>
                    {f.name}
                  </Text>
                  {f.fundHouse ? (
                    <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                      {f.fundHouse}
                    </Text>
                  ) : null}
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text variant="moneySmall">{fmt(f.value)}</Text>
                  <Delta amount={f.gain} percent={f.gainPercent} variant="caption" showAmount={false} />
                </View>
              </View>
            ))}
          </Card>
        </View>
      ) : null}
    </ScrollView>
  );
}

function WatchlistTab({
  funds,
  period,
  watchlist,
  onExplore,
}: {
  funds: CatalogFund[];
  period: Period;
  watchlist: ReturnType<typeof useWatchlist>;
  onExplore: () => void;
}) {
  if (funds.length === 0) {
    return (
      <ScrollView contentContainerStyle={{ padding: space[5] }}>
        <EmptyState
          icon={Bookmark}
          title="Nothing on your watchlist"
          message="Bookmark a fund from any list and it will wait for you here."
          action={<Button label="Explore funds" onPress={onExplore} />}
        />
      </ScrollView>
    );
  }

  return (
    <FlatList
      data={funds}
      keyExtractor={(f) => f.amfiCode}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: space[5], paddingBottom: TAB_BAR_HEIGHT + space[8] }}
      renderItem={({ item }) => (
        <FundRow
          fund={item}
          period={period}
          bookmarked
          onToggleBookmark={() => watchlist.toggle(item.amfiCode)}
        />
      )}
      ListFooterComponent={
        <Text variant="caption" tone="faint" center style={{ paddingTop: space[5] }}>
          Your watchlist is kept on this phone.
        </Text>
      }
    />
  );
}

function AllFunds({
  funds,
  period,
  setPeriod,
  query,
  setQuery,
  collection,
  onClearCollection,
  watchlist,
  loading,
  onRefresh,
}: {
  funds: CatalogFund[];
  period: Period;
  setPeriod: (p: Period) => void;
  query: string;
  setQuery: (q: string) => void;
  collection: Collection | null;
  onClearCollection: () => void;
  watchlist: ReturnType<typeof useWatchlist>;
  loading: boolean;
  onRefresh: () => void;
}) {
  const p = usePalette();

  return (
    <FlatList
      data={funds}
      keyExtractor={(f) => f.amfiCode}
      showsVerticalScrollIndicator={false}
      onRefresh={onRefresh}
      refreshing={loading}
      // Sized so the list never measures all ~9,600 rows on mount.
      initialNumToRender={10}
      windowSize={7}
      removeClippedSubviews
      contentContainerStyle={{ paddingHorizontal: space[5], paddingBottom: TAB_BAR_HEIGHT + space[8] }}
      ListHeaderComponent={
        <View style={{ gap: space[3], paddingTop: space[4], paddingBottom: space[2] }}>
          {collection ? (
            <Pressable
              onPress={onClearCollection}
              style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}
            >
              <ChevronLeft size={16} color={p.accent.DEFAULT} />
              <Text variant="smallMedium" tone="accent">
                {collection.label}
              </Text>
              <Text variant="caption" tone="faint">
                · tap to clear
              </Text>
            </Pressable>
          ) : null}

          <Input
            icon={Search}
            placeholder="Search a fund or fund house"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />
          <Segmented<Period>
            value={period}
            onChange={setPeriod}
            options={[
              { value: '1Y', label: '1Y' },
              { value: '3Y', label: '3Y' },
              { value: '5Y', label: '5Y' },
            ]}
          />
          <Text variant="caption" tone="faint">
            {funds.length.toLocaleString('en-IN')} funds
          </Text>
        </View>
      }
      ListEmptyComponent={
        <EmptyState icon={Search} title="No funds match that" message="Try a different name or fund house." />
      }
      renderItem={({ item }) => (
        <FundRow
          fund={item}
          period={period}
          bookmarked={watchlist.has(item.amfiCode)}
          onToggleBookmark={() => watchlist.toggle(item.amfiCode)}
        />
      )}
    />
  );
}
