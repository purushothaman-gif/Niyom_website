/**
 * Partner Unlisted Shares — what this DSA can sell, and the orders they raised.
 *
 * The same Explore / My Orders split as partner Bonds, and the same arrangement
 * of the markup control ABOVE the list: every price below is cost × (1 + this),
 * so changing it visibly reprices the list. The per-share margin on an order or
 * an offer link overrides it for that one action; both are capped at 5% here
 * AND by the server, which re-derives the price on every write.
 *
 * Shares have no rating / tenure / coupon buckets to filter on, so where bonds
 * has a filter sheet this has the website's plain search: company, ISIN, sector.
 */
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Gem, Percent, Search, ShieldCheck } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { fmtDate } from '@shared/crm/utils';
import {
  PartnerService,
  type PartnerBondOrderStatus,
  type PartnerShare,
  type PartnerShareOrder,
} from '@shared/partner/services/PartnerService';
import {
  MAX_PARTNER_SHARE_MARGIN,
  clampShareMargin,
  isShareMarginValid,
} from '@shared/partner/shares/partnerShareMath';
import { font, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { PartnerShareCard } from '@/features/partner/shares/PartnerShareCard';
import { pctLabel, rupee2, sharesLabel } from '@/features/partner/shares/format';
import { usePartnerShareOrders, usePartnerShares } from '@/features/partner/shares/queries';
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

function matches(s: PartnerShare, q: string): boolean {
  const t = q.trim().toLowerCase();
  if (!t) return true;
  return [s.company_name, s.short_name, s.isin, s.sector].some((v) =>
    (v ?? '').toLowerCase().includes(t),
  );
}

export default function PartnerShares() {
  /* `/partner-shares?tab=orders` opens on My Orders — used after placing an order. */
  const { tab: tabParam } = useLocalSearchParams<{ tab?: string }>();
  const sharesQ = usePartnerShares();
  const ordersQ = usePartnerShareOrders();

  const [tab, setTab] = useState<Tab>(tabParam === 'orders' ? 'orders' : 'explore');
  const [query, setQuery] = useState('');

  /* `?? []` inline would be a fresh array every render, re-running the search below. */
  const shares = useMemo(() => sharesQ.data ?? [], [sharesQ.data]);
  const orders = useMemo(() => ordersQ.data ?? [], [ordersQ.data]);
  const shown = useMemo(() => shares.filter((s) => matches(s, query)), [shares, query]);

  /* The global spread belongs to the DSA, so every row carries the same value. */
  const currentMarkup = shares[0]?.self_markup_percent ?? 0;

  const tabs = [
    { value: 'explore' as const, label: 'Explore shares', badge: shares.length || undefined },
    { value: 'orders' as const, label: 'My Orders', badge: orders.length || undefined },
  ];

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Unlisted Shares"
        subtitle="What you can offer, priced at your cost plus your spread."
        showBack
      />

      <TopTabs tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'explore' ? (
        <ExploreTab
          shares={shares}
          shown={shown}
          query={query}
          onQuery={setQuery}
          currentMarkup={currentMarkup}
          loading={sharesQ.loading}
          error={sharesQ.error}
          onReload={sharesQ.refresh}
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
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/*  Explore                                                                   */
/* -------------------------------------------------------------------------- */

function ExploreTab({
  shares,
  shown,
  query,
  onQuery,
  currentMarkup,
  loading,
  error,
  onReload,
}: {
  shares: PartnerShare[];
  shown: PartnerShare[];
  query: string;
  onQuery: (q: string) => void;
  currentMarkup: number;
  loading: boolean;
  error: string | null;
  onReload: () => void;
}) {
  const p = usePalette();

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
        message="Your relationship manager sets your pricing. Once it is approved, the shares you can sell appear here."
      />
    );
  }

  return (
    <FlatList
      data={shown}
      keyExtractor={(s) => s.id}
      renderItem={({ item }) => (
        <PartnerShareCard share={item} onPress={() => router.push(`/partner-share?id=${item.id}`)} />
      )}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      onRefresh={onReload}
      refreshing={loading}
      contentContainerStyle={{ gap: space[3], paddingTop: space[4], paddingBottom: space[8] }}
      ListHeaderComponent={
        <View style={{ gap: space[3] }}>
          <MarkupCard current={currentMarkup} onSaved={onReload} />

          <Input
            icon={Search}
            placeholder="Search by company, ISIN or sector"
            value={query}
            onChangeText={onQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />

          <Text variant="small" tone="secondary">
            {query.trim() ? `${shown.length} of ${shares.length}` : shares.length} share
            {shares.length === 1 ? '' : 's'}
          </Text>
        </View>
      }
      ListEmptyComponent={
        <EmptyState
          icon={Search}
          title={`Nothing matched “${query.trim()}”`}
          message="Try a company name, an ISIN or a sector."
          action={<Button label="Clear search" variant="secondary" size="sm" onPress={() => onQuery('')} />}
        />
      }
      ListFooterComponent={
        shown.length > 0 ? (
          <View style={{ flexDirection: 'row', gap: space[2], paddingTop: space[5] }}>
            <ShieldCheck size={13} color={p.state.successSoft} style={{ marginTop: 1 }} />
            <Text variant="caption" tone="faint" style={{ flex: 1 }}>
              “Your price” includes your {pctLabel(currentMarkup)} markup. Your cost is set by your
              relationship manager and is never shown to a client. Prices are indicative, per
              share; availability and final terms are confirmed by the RM.
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

  const dirty = value !== '' && clampShareMargin(value) !== current;
  const canSave = value !== '' && isShareMarginValid(value) && !saving;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await PartnerService.setShareMarkup(clampShareMargin(value));
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
            Added on top of your cost, capped at {MAX_PARTNER_SHARE_MARGIN}%.
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
  orders: PartnerShareOrder[];
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
        message="Unlisted-share orders you place for your clients appear here, so you can follow the RM's confirmation."
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
                  {sharesLabel(o.qty)} @ {rupee2(o.price_per_share)}
                  {o.partner_markup_percent != null
                    ? ` · your margin ${pctLabel(o.partner_markup_percent)}`
                    : ''}
                </Text>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text variant="overline" tone="faint" caps>
                    Indicative
                  </Text>
                  <Text variant="moneySmall" style={{ marginTop: 2 }}>
                    {rupee2(o.amount ?? 0)}
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
