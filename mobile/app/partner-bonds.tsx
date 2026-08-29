/**
 * Partner Bonds — what this DSA can sell, and the orders they have raised.
 *
 * Reached from Account rather than the tab bar, which is full (Home, Clients,
 * Payouts, Leads, Account). Same Explore / My Orders split as the web partner
 * portal and as the client's own Bonds screen.
 *
 * ## The markup control sits above the list on purpose
 *
 * Every price in the list below is cost × (1 + this). Putting the control at the
 * top makes that relationship visible: change it, and the whole list reprices.
 * Buried in Account it would read as a setting rather than as the thing that
 * decides what the partner is looking at.
 *
 * The per-bond margin on an order or a share link overrides it for that one
 * action; this is only the default. Both are capped at 5% here AND by the
 * server, which re-derives the price on every write and never trusts a number
 * the app sends.
 *
 * ## Filtering reuses the client's sheet
 *
 * `PartnerBond` satisfies `FilterableBond`, so the same sheet serves both — the
 * arrangement the website already has, where the partner list imports the
 * portal's filter modal. One set of buckets, whoever is looking.
 */
import { useMemo, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Landmark, Percent, ShieldCheck, SlidersHorizontal, X } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { fmt, fmtDate } from '@shared/crm/utils';
import {
  PartnerService,
  type PartnerBond,
  type PartnerBondOrder,
  type PartnerBondOrderStatus,
} from '@shared/partner/services/PartnerService';
import {
  MAX_PARTNER_MARGIN,
  clampMargin,
  isMarginValid,
} from '@shared/partner/bonds/partnerBondMath';
import {
  EMPTY_FILTERS,
  countFilters,
  filterChips,
  matchesFilters,
  removeFilter,
  type BondFilters,
} from '@shared/portal/bonds/bondFilters';
import { font, radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { BondFilterSheet } from '@/features/client/bonds/BondFilterSheet';
import { PartnerBondCard } from '@/features/partner/bonds/PartnerBondCard';
import { usePartnerBonds, usePartnerBondOrders } from '@/features/partner/bonds/queries';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Input } from '@/ui/Input';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, SkeletonScreen, StatusPill } from '@/ui/kit';
import { TopTabs } from '@/ui/TopTabs';

type Tab = 'explore' | 'orders';

const STATUS: Record<PartnerBondOrderStatus, { label: string; tone: 'accent' | 'info' | 'success' | 'neutral' }> = {
  submitted: { label: 'Submitted', tone: 'accent' },
  deal_sent: { label: 'Deal sent', tone: 'info' },
  accepted: { label: 'Accepted', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

const rupee2 = (v: number | null | undefined) => (v == null ? '—' : `₹${Number(v).toFixed(2)}`);
const pctLabel = (v: number | null | undefined) => (v == null ? '—' : `${Number(v).toFixed(2)}%`);

export default function PartnerBonds() {
  const bondsQ = usePartnerBonds();
  const ordersQ = usePartnerBondOrders();

  const [tab, setTab] = useState<Tab>('explore');
  const [filters, setFilters] = useState<BondFilters>(EMPTY_FILTERS);
  const [showFilter, setShowFilter] = useState(false);

  /* `?? []` inline would be a fresh array every render, re-running the filter below. */
  const bonds = useMemo(() => bondsQ.data ?? [], [bondsQ.data]);
  const orders = useMemo(() => ordersQ.data ?? [], [ordersQ.data]);

  const shown = useMemo(() => bonds.filter((b) => matchesFilters(b, filters)), [bonds, filters]);
  const activeCount = countFilters(filters);
  const chips = filterChips(filters);

  /*
   * The global spread is a property of the DSA, not of a bond, so every row
   * carries the same value and the first one is as good as any. `?? 0` covers
   * the empty list, where there is no row to read it from.
   */
  const currentMarkup = bonds[0]?.self_markup_percent ?? 0;

  const tabs = [
    { value: 'explore' as const, label: 'Explore bonds', badge: bonds.length || undefined },
    { value: 'orders' as const, label: 'My Orders', badge: orders.length || undefined },
  ];

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Bonds"
        subtitle="What you can offer, priced at your cost plus your spread."
        showBack
      />

      <TopTabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'explore' ? (
        <ExploreTab
          bonds={bonds}
          shown={shown}
          currentMarkup={currentMarkup}
          activeCount={activeCount}
          chips={chips}
          loading={bondsQ.loading}
          error={bondsQ.error}
          onReload={bondsQ.refresh}
          onOpenFilter={() => setShowFilter(true)}
          onRemoveChip={(cat, k) => setFilters((f) => removeFilter(f, cat, k))}
          onClearAll={() => setFilters(EMPTY_FILTERS)}
        />
      ) : (
        <OrdersTab
          orders={orders}
          loading={ordersQ.loading}
          error={ordersQ.error}
          onReload={ordersQ.refresh}
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
  currentMarkup,
  activeCount,
  chips,
  loading,
  error,
  onReload,
  onOpenFilter,
  onRemoveChip,
  onClearAll,
}: {
  bonds: PartnerBond[];
  shown: PartnerBond[];
  currentMarkup: number;
  activeCount: number;
  chips: ReturnType<typeof filterChips>;
  loading: boolean;
  error: string | null;
  onReload: () => void;
  onOpenFilter: () => void;
  onRemoveChip: (cat: ReturnType<typeof filterChips>[number]['cat'], k: string) => void;
  onClearAll: () => void;
}) {
  const p = usePalette();

  if (loading && bonds.length === 0) {
    return (
      <View style={{ paddingTop: space[4] }}>
        <SkeletonScreen rows={3} />
      </View>
    );
  }
  if (error) return <ErrorState message={error} onRetry={onReload} />;

  if (bonds.length === 0) {
    return (
      <EmptyState
        icon={Landmark}
        title="No bonds available yet"
        message="Bonds you can offer appear here once your relationship manager approves your pricing."
      />
    );
  }

  return (
    <FlatList
      data={shown}
      keyExtractor={(b) => b.id}
      renderItem={({ item }) => (
        <PartnerBondCard bond={item} onPress={() => router.push(`/partner-bond?id=${item.id}`)} />
      )}
      showsVerticalScrollIndicator={false}
      onRefresh={onReload}
      refreshing={loading}
      contentContainerStyle={{ gap: space[3], paddingTop: space[4], paddingBottom: space[8] }}
      ListHeaderComponent={
        <View style={{ gap: space[3] }}>
          <MarkupCard current={currentMarkup} onSaved={onReload} />

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
              Your cost is set by your relationship manager. Prices are indicative, per ₹100 face
              value, and the final terms are confirmed by the RM on the deal confirmation.
            </Text>
          </View>
        ) : null
      }
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  The global spread                                                         */
/* -------------------------------------------------------------------------- */

function MarkupCard({ current, onSaved }: { current: number; onSaved: () => void }) {
  const p = usePalette();
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = value !== '' && clampMargin(value) !== current;
  const canSave = value !== '' && isMarginValid(value) && !saving;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await PartnerService.setBondMarkup(clampMargin(value));
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setValue('');
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save your markup.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card padding={4} style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
        <View style={{ flex: 1 }}>
          <Text variant="overline" tone="faint" caps>
            Your markup
          </Text>
          <Text variant="small" tone="secondary" style={{ marginTop: space[1] }}>
            Added on top of your cost, capped at {MAX_PARTNER_MARGIN}%.
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="caption" tone="faint">
            Current
          </Text>
          <Text
            style={{
              fontFamily: font.displayBold,
              fontSize: 20,
              marginTop: 2,
              color: p.accent.DEFAULT,
            }}
          >
            {pctLabel(current)}
          </Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
        <View style={{ flex: 1 }}>
          <Input
            icon={Percent}
            placeholder={String(current)}
            value={value}
            onChangeText={setValue}
            keyboardType="decimal-pad"
            returnKeyType="done"
          />
        </View>
        <Button
          label={dirty ? 'Save' : 'Saved'}
          size="md"
          variant="secondary"
          disabled={!canSave}
          loading={saving}
          onPress={() => void save()}
        />
      </View>

      {error ? (
        <Text variant="caption" style={{ color: p.state.dangerSoft }}>
          {error}
        </Text>
      ) : null}
    </Card>
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
  orders: PartnerBondOrder[];
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
        icon={Landmark}
        title="No orders yet"
        message="Orders you raise for your clients appear here, so you can follow the RM's confirmation."
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
                    {o.ref} · {o.client?.full_name ?? '—'} · {fmtDate(o.created_at)}
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
                  {o.units} unit{o.units === 1 ? '' : 's'} @ {rupee2(o.price_per_100)}/₹100
                  {o.partner_markup_percent != null
                    ? ` · your margin ${pctLabel(o.partner_markup_percent)}`
                    : ''}
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
