/**
 * Bonds — the marketplace, and the client's own orders.
 *
 * Two views of one product, so they are top tabs inside a single screen rather
 * than two entries in More, exactly as the website puts them behind one
 * segmented control. The bottom bar is full (Home, Portfolio, Mutual Funds,
 * SIPs, More) and Bonds arrives from More; that is the same shape the fund
 * screen has.
 *
 * ## What a client may see here
 *
 * Only bonds priced at a markup an admin has APPROVED for them, and only the
 * marked-up price. The base price, the desk's cost and the margin are stripped
 * server-side by `nw_client_bonds` and never travel. Nothing on this screen
 * recomputes a price — every figure is the server's, or is derived from it by
 * `shared/portal/bonds/bondMath.ts`, which the website runs too.
 *
 * ## Why ordering is gated on KYC but browsing is not
 *
 * Someone who has not finished onboarding still has a good reason to look —
 * that is often what makes them finish. The gate is on the order button, on the
 * detail screen, where it can say what to do about it.
 */
import { useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Landmark, ShieldCheck, SlidersHorizontal, X } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { fmt, fmtDate } from '@shared/crm/utils';
import type { BondOrder, BondOrderStatus } from '@shared/portal/services/BondOrderService';
import {
  EMPTY_FILTERS,
  countFilters,
  filterChips,
  matchesFilters,
  removeFilter,
  type BondFilters,
} from '@shared/portal/bonds/bondFilters';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { BondCard } from '@/features/client/bonds/BondCard';
import { BondFilterSheet } from '@/features/client/bonds/BondFilterSheet';
import { useBonds, useMyBondOrders } from '@/features/client/bonds/queries';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, SkeletonScreen, StatusPill } from '@/ui/kit';
import { TopTabs } from '@/ui/TopTabs';

type Tab = 'explore' | 'orders';

const STATUS: Record<BondOrderStatus, { label: string; tone: 'accent' | 'info' | 'success' | 'neutral' }> = {
  submitted: { label: 'Submitted', tone: 'accent' },
  deal_sent: { label: 'Deal sent — action needed', tone: 'info' },
  accepted: { label: 'Accepted', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export default function Bonds() {
  const clientId = useClientId();
  const { bonds, loading, refreshing, error, reload } = useBonds();
  const orders = useMyBondOrders(clientId);

  const [tab, setTab] = useState<Tab>('explore');
  const [filters, setFilters] = useState<BondFilters>(EMPTY_FILTERS);
  const [showFilter, setShowFilter] = useState(false);

  const shown = useMemo(() => bonds.filter((b) => matchesFilters(b, filters)), [bonds, filters]);
  const activeCount = countFilters(filters);
  const chips = filterChips(filters);

  const tabs = [
    { value: 'explore' as const, label: 'Explore bonds', badge: bonds.length || undefined },
    { value: 'orders' as const, label: 'My Orders', badge: orders.orders.length || undefined },
  ];

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Bonds"
        subtitle="Fixed income curated for you, at your approved pricing."
        showBack
      />

      <TopTabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'explore' ? (
        <ExploreTab
          bonds={bonds}
          shown={shown}
          activeCount={activeCount}
          chips={chips}
          loading={loading}
          refreshing={refreshing}
          error={error}
          onReload={reload}
          onOpenFilter={() => setShowFilter(true)}
          onRemoveChip={(cat, k) => setFilters((f) => removeFilter(f, cat, k))}
          onClearAll={() => setFilters(EMPTY_FILTERS)}
        />
      ) : (
        <OrdersTab
          orders={orders.orders}
          loading={orders.loading}
          error={orders.error}
          onReload={orders.reload}
          onExplore={() => setTab('explore')}
        />
      )}

      {showFilter ? (
        <BondFilterSheet
          bonds={bonds}
          initial={filters}
          onApply={setFilters}
          onClose={() => setShowFilter(false)}
        />
      ) : null}
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/*  Explore                                                                   */
/* -------------------------------------------------------------------------- */

function ExploreTab({
  bonds,
  shown,
  activeCount,
  chips,
  loading,
  refreshing,
  error,
  onReload,
  onOpenFilter,
  onRemoveChip,
  onClearAll,
}: {
  bonds: ReturnType<typeof useBonds>['bonds'];
  shown: ReturnType<typeof useBonds>['bonds'];
  activeCount: number;
  chips: ReturnType<typeof filterChips>;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  onReload: () => void;
  onOpenFilter: () => void;
  onRemoveChip: (cat: ReturnType<typeof filterChips>[number]['cat'], k: string) => void;
  onClearAll: () => void;
}) {
  const p = usePalette();

  if (loading && bonds.length === 0) return <View style={{ paddingTop: space[4] }}><SkeletonScreen rows={3} /></View>;
  if (error) return <ErrorState message={error} onRetry={onReload} />;

  if (bonds.length === 0) {
    return (
      <EmptyState
        icon={Landmark}
        title="No bonds available yet"
        message="Fixed-income opportunities curated for you will appear here. Speak to your relationship manager to get started."
      />
    );
  }

  return (
    <FlatList
      data={shown}
      keyExtractor={(b) => b.id}
      renderItem={({ item }) => (
        <BondCard bond={item} onPress={() => router.push(`/bond?id=${item.id}`)} />
      )}
      showsVerticalScrollIndicator={false}
      onRefresh={onReload}
      refreshing={refreshing}
      contentContainerStyle={{ gap: space[3], paddingTop: space[4], paddingBottom: space[8] }}
      ListHeaderComponent={
        <View style={{ gap: space[3] }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: space[3],
            }}
          >
            <Text variant="small" tone="secondary">
              {activeCount > 0 ? `${shown.length} of ${bonds.length}` : bonds.length} bond
              {bonds.length === 1 ? '' : 's'}
            </Text>

            <Pressable
              onPress={onOpenFilter}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space[2],
                paddingHorizontal: space[3],
                paddingVertical: space[2],
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: activeCount > 0 ? p.accent.tint(0.4) : p.border.DEFAULT,
                backgroundColor: activeCount > 0 ? p.bg.selected : p.bg.surface,
              }}
            >
              <SlidersHorizontal size={14} color={activeCount > 0 ? p.accent.DEFAULT : p.text.primary} />
              <Text variant="smallMedium" tone={activeCount > 0 ? 'accent' : 'primary'}>
                Filter
              </Text>
              {activeCount > 0 ? (
                <View
                  style={{
                    minWidth: 17,
                    paddingHorizontal: 5,
                    paddingVertical: 1,
                    borderRadius: radius.full,
                    alignItems: 'center',
                    backgroundColor: p.accent.DEFAULT,
                  }}
                >
                  <Text variant="caption" tone="onAccent">
                    {activeCount}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </View>

          {chips.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space[2] }}>
              {chips.map((chip) => (
                <Pressable
                  key={`${chip.cat}:${chip.k}`}
                  onPress={() => onRemoveChip(chip.cat, chip.k)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: space[1] + 2,
                    paddingHorizontal: space[3],
                    paddingVertical: space[1] + 2,
                    borderRadius: radius.full,
                    borderWidth: 1,
                    borderColor: p.accent.tint(0.3),
                    backgroundColor: p.bg.selected,
                  }}
                >
                  <Text variant="caption" tone="accent">
                    {chip.label}
                  </Text>
                  <X size={11} color={p.accent.DEFAULT} strokeWidth={2.5} />
                </Pressable>
              ))}
              <Pressable onPress={onClearAll} hitSlop={8} style={{ paddingHorizontal: space[2], paddingVertical: space[1] }}>
                <Text variant="caption" tone="muted">
                  Clear all
                </Text>
              </Pressable>
            </View>
          ) : null}
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          icon={Landmark}
          title="Nothing matches this filter"
          message="Try a different filter to see more opportunities."
          action={<Button label="Clear filters" variant="secondary" size="sm" onPress={onClearAll} />}
        />
      }
      ListFooterComponent={
        shown.length > 0 ? (
          <View style={{ flexDirection: 'row', gap: space[2], paddingTop: space[5] }}>
            <ShieldCheck size={13} color={p.state.successSoft} style={{ marginTop: 1 }} />
            <Text variant="caption" tone="faint" style={{ flex: 1 }}>
              Yields and prices are indicative, per ₹100 face value, and are finalised by your
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
  orders: BondOrder[];
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onExplore: () => void;
}) {
  if (loading && orders.length === 0) return <View style={{ paddingTop: space[4] }}><SkeletonScreen rows={3} /></View>;
  if (error) return <ErrorState message={error} onRetry={onReload} />;

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={Landmark}
        title="No orders yet"
        message="When you place a bond order it appears here, and you can follow your relationship manager's confirmation."
        action={<Button label="Explore bonds" variant="secondary" size="sm" onPress={onExplore} />}
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
                    {o.bond_name || o.isin}
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
                  {o.units} unit{o.units === 1 ? '' : 's'} @ ₹{Number(o.price_per_100).toFixed(2)}/₹100
                </Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text variant="overline" tone="faint" caps>
                    Indicative
                  </Text>
                  <Text variant="moneySmall" style={{ marginTop: 2 }}>
                    {fmt(o.amount ?? 0)}
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
