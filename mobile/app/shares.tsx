/**
 * Unlisted Shares — the marketplace, and the client's own orders.
 *
 * The same shape as Bonds (`bonds.tsx`): two views of one product as top tabs
 * inside a single screen. `?tab=orders` opens straight onto My Orders, which is
 * where the order confirmation sends the client.
 *
 * ## What a client may see here
 *
 * Only shares priced at a markup an admin has APPROVED for them, and only the
 * marked-up price. The base price and the markup are stripped server-side by
 * `nw_client_unlisted_shares` and never travel. Browsing is open before KYC;
 * the gate is on the order button, on the detail screen.
 */
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Gem, Search, ShieldCheck } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { fmtDate, fmtFull } from '@shared/crm/utils';
import type { ShareOrder, ShareOrderStatus } from '@shared/portal/services/ShareOrderService';
import { matchesShareSearch } from '@shared/portal/shares/shareSearch';
import { space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { ShareCard, sharesLabel } from '@/features/client/shares/ShareCard';
import { useMyShareOrders, useShares } from '@/features/client/shares/queries';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Input } from '@/ui/Input';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, SkeletonScreen, StatusPill } from '@/ui/kit';
import { TopTabs } from '@/ui/TopTabs';

type Tab = 'explore' | 'orders';

const STATUS: Record<ShareOrderStatus, { label: string; tone: 'accent' | 'info' | 'success' | 'neutral' }> = {
  submitted: { label: 'Submitted', tone: 'accent' },
  deal_sent: { label: 'Deal sent — action needed', tone: 'info' },
  accepted: { label: 'Accepted', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export default function Shares() {
  const clientId = useClientId();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { shares, loading, refreshing, error, reload } = useShares();
  const orders = useMyShareOrders(clientId);

  const [tab, setTab] = useState<Tab>(params.tab === 'orders' ? 'orders' : 'explore');

  const tabs = [
    { value: 'explore' as const, label: 'Explore', badge: shares.length || undefined },
    { value: 'orders' as const, label: 'My Orders', badge: orders.orders.length || undefined },
  ];

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Unlisted Shares"
        subtitle="Pre-IPO and unlisted companies, at your approved pricing."
        showBack
      />

      <TopTabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'explore' ? (
        <ExploreTab shares={shares} loading={loading} refreshing={refreshing} error={error} onReload={reload} />
      ) : (
        <OrdersTab
          orders={orders.orders}
          loading={orders.loading}
          error={orders.error}
          onReload={orders.reload}
          onExplore={() => setTab('explore')}
        />
      )}
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/*  Explore                                                                   */
/* -------------------------------------------------------------------------- */

function ExploreTab({
  shares,
  loading,
  refreshing,
  error,
  onReload,
}: {
  shares: ReturnType<typeof useShares>['shares'];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onReload: () => void;
}) {
  const p = usePalette();
  const [query, setQuery] = useState('');
  const shown = useMemo(() => shares.filter((s) => matchesShareSearch(s, query)), [shares, query]);

  if (loading && shares.length === 0) {
    return (
      <View style={{ paddingTop: space[4] }}>
        <SkeletonScreen rows={3} />
      </View>
    );
  }
  if (error) return <ErrorState message={error} onRetry={onReload} />;

  if (shares.length === 0) {
    return (
      <EmptyState
        icon={Gem}
        title="No unlisted shares available yet"
        message="Pre-IPO and unlisted opportunities curated for you will appear here. Speak to your relationship manager to get started."
      />
    );
  }

  return (
    <FlatList
      data={shown}
      keyExtractor={(s) => s.id}
      renderItem={({ item }) => (
        <ShareCard share={item} onPress={() => router.push(`/share?id=${item.id}`)} />
      )}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      onRefresh={onReload}
      refreshing={refreshing}
      contentContainerStyle={{ gap: space[3], paddingTop: space[4], paddingBottom: space[8] }}
      ListHeaderComponent={
        <Input
          icon={Search}
          value={query}
          onChangeText={setQuery}
          placeholder="Search by company, ISIN or sector"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
        />
      }
      ListEmptyComponent={
        <EmptyState
          icon={Search}
          title="Nothing matched"
          message="Try a different company name, ISIN or sector."
          action={<Button label="Clear search" variant="secondary" size="sm" onPress={() => setQuery('')} />}
        />
      }
      ListFooterComponent={
        shown.length > 0 ? (
          <View style={{ flexDirection: 'row', gap: space[2], paddingTop: space[5] }}>
            <ShieldCheck size={13} color={p.state.successSoft} style={{ marginTop: 1 }} />
            <Text variant="caption" tone="faint" style={{ flex: 1 }}>
              Prices are indicative. Availability and the final terms are confirmed by your
              relationship manager on the deal confirmation.
            </Text>
          </View>
        ) : null
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  My Orders                                                                 */
/* -------------------------------------------------------------------------- */

function OrdersTab({
  orders,
  loading,
  error,
  onReload,
  onExplore,
}: {
  orders: ShareOrder[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onExplore: () => void;
}) {
  if (loading && orders.length === 0) {
    return (
      <View style={{ paddingTop: space[4] }}>
        <SkeletonScreen rows={3} />
      </View>
    );
  }
  if (error) return <ErrorState message={error} onRetry={onReload} />;

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={Gem}
        title="No orders yet"
        message="When you place an unlisted share order it appears here, and you can follow your relationship manager's confirmation."
        action={<Button label="Explore unlisted shares" variant="secondary" size="sm" onPress={onExplore} />}
      />
    );
  }

  return (
    <FlatList
      data={orders}
      keyExtractor={(o) => o.id}
      showsVerticalScrollIndicator={false}
      onRefresh={onReload}
      refreshing={loading}
      contentContainerStyle={{ gap: space[3], paddingTop: space[4], paddingBottom: space[8] }}
      renderItem={({ item: o }) => {
        const s = STATUS[o.status] ?? STATUS.submitted;
        return (
          <Animated.View entering={FadeIn.duration(260)}>
            <Card padding={4} style={{ gap: space[3] }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium" numberOfLines={2}>
                    {o.company_name || o.isin}
                  </Text>
                  <Text variant="caption" tone="faint" style={{ marginTop: 2 }}>
                    {o.ref} · {fmtDate(o.created_at)}
                  </Text>
                </View>
                <StatusPill label={s.label} tone={s.tone} />
              </View>

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'flex-end',
                  justifyContent: 'space-between',
                  gap: space[3],
                }}
              >
                <Text variant="small" tone="muted" style={{ flex: 1 }}>
                  {sharesLabel(o.qty)} @ {fmtFull(Number(o.price_per_share) || 0)}
                </Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text variant="overline" tone="faint" caps>
                    Indicative
                  </Text>
                  <Text variant="moneySmall" style={{ marginTop: 2 }}>
                    {fmtFull(o.amount ?? 0)}
                  </Text>
                </View>
              </View>
            </Card>
          </Animated.View>
        );
      }}
    />
  );
}
