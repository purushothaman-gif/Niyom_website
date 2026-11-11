/**
 * A partner raises an unlisted-share order for one of their clients.
 *
 * Client, margin, quantity, confirm — one scrolling screen with the action
 * pinned, as partner bonds does. The client list is a search field rather than
 * a dropdown for the same reason: it works for three clients and three hundred.
 *
 * ## Nothing here is trusted
 *
 * `place-partner-share-order` re-derives the price from `partner_base` and the
 * margin, and re-checks the quantity against the minimum and lot size. The
 * figures below come from the shared `partnerShareMath` / `shareMath` — the same
 * files the website uses — and are labelled indicative; if this screen and the
 * server ever disagree, the server is right.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { CheckCircle2, Minus, Percent, Plus, Search, ShieldCheck, UserRound } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import {
  PartnerService,
  type PartnerShareOrder,
} from '@shared/partner/services/PartnerService';
import {
  MAX_PARTNER_SHARE_MARGIN,
  clampShareMargin,
  isShareMarginValid,
  partnerShareBreakdown,
} from '@shared/partner/shares/partnerShareMath';
import { minQty, qtyError, stepQty } from '@shared/portal/shares/shareMath';
import { font, radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { pctLabel, rupee2, sharesLabel } from '@/features/partner/shares/format';
import { usePartnerShare, usePartnerShareClients } from '@/features/partner/shares/queries';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Input } from '@/ui/Input';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, SkeletonScreen } from '@/ui/kit';

export default function PartnerShareOrderScreen() {
  const p = usePalette();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data: share, loading, error } = usePartnerShare(id);
  const clientsQ = usePartnerShareClients();

  const [clientId, setClientId] = useState('');
  const [query, setQuery] = useState('');
  const [margin, setMargin] = useState<string | null>(null);
  const [qtyState, setQtyState] = useState<number | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PartnerShareOrder | null>(null);

  /* `?? []` inline would be a fresh array every render, re-running the search below. */
  const clients = useMemo(() => clientsQ.data ?? [], [clientsQ.data]);
  /* Defaults come from the share, which is not loaded on first render. */
  const marginValue = margin ?? String(share?.self_markup_percent ?? 0);
  const min = share ? minQty(share) : 1;
  const step = share ? stepQty(share) : 1;
  const qty = qtyState ?? min;

  const bd = useMemo(
    () => (share ? partnerShareBreakdown(share, qty, marginValue) : null),
    [share, qty, marginValue],
  );

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter(
      (c) =>
        c.full_name.toLowerCase().includes(needle) ||
        c.client_code.toLowerCase().includes(needle),
    );
  }, [clients, query]);

  const selected = clients.find((c) => c.client_id === clientId) ?? null;
  const qtyProblem = share ? qtyError(share, qty) : null;
  const canPlace = !!clientId && isShareMarginValid(marginValue) && !qtyProblem && !placing;

  const place = async () => {
    if (!share) return;
    setPlacing(true);
    setPlaceError(null);
    try {
      const order = await PartnerService.placeShareOrder({
        clientId,
        shareId: share.id,
        qty,
        margin: clampShareMargin(marginValue),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPlaced(order);
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPlaceError(e instanceof Error ? e.message : 'Could not place the order.');
    } finally {
      setPlacing(false);
    }
  };

  if (loading || !share || !bd) {
    return (
      <Screen>
        <ScreenHeader title="Order for a client" showBack />
        {error ? (
          <ErrorState message={error} />
        ) : loading ? (
          <SkeletonScreen rows={3} />
        ) : (
          <EmptyState
            icon={UserRound}
            title="This share isn't available to you"
            message="It may have been withdrawn, or your pricing for it hasn't been approved."
          />
        )}
      </Screen>
    );
  }

  const name = share.short_name || share.company_name;

  /* ---- Placed ---------------------------------------------------------- */
  if (placed) {
    return (
      <Screen>
        <Animated.View entering={FadeIn.duration(300)} style={{ gap: space[5], paddingTop: space[8] }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: radius.full,
              alignSelf: 'center',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: `${p.state.successSoft}1F`,
            }}
          >
            <CheckCircle2 size={30} color={p.state.successSoft} strokeWidth={1.8} />
          </View>

          <Text variant="h2" center>
            Order submitted
          </Text>

          <Text variant="small" tone="secondary" center>
            Order <Text variant="smallMedium">{placed.ref}</Text> for {sharesLabel(placed.qty)}
            {selected ? ` on behalf of ${selected.full_name}` : ''} has gone to the client's
            relationship manager, who will confirm availability and the deal.
          </Text>

          <Card weight="surface" padding={4} style={{ gap: space[2] }}>
            <Row label="Quantity" value={sharesLabel(placed.qty)} />
            <Row label="Price / share" value={rupee2(placed.price_per_share)} />
            <Row label="Indicative amount" value={rupee2(placed.amount ?? bd.amount)} strong />
          </Card>

          <View style={{ gap: space[3] }}>
            <Button
              label="View my orders"
              fullWidth
              onPress={() => router.replace('/partner-shares?tab=orders')}
            />
            <Button
              label="Back to my dashboard"
              variant="ghost"
              fullWidth
              onPress={() => router.replace('/(partner)/dashboard')}
            />
          </View>
        </Animated.View>
      </Screen>
    );
  }

  /* ---- Form ------------------------------------------------------------ */
  return (
    <Screen scroll={false}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: space[6] }}
      >
        <ScreenHeader title="Order for a client" subtitle="Nothing is charged at this step." showBack />

        <Animated.View entering={FadeInDown.duration(360)} style={{ gap: space[4] }}>
          <Card padding={4}>
            <Text variant="bodyMedium">{name}</Text>
            <Text variant="caption" tone="faint" style={{ marginTop: 2 }}>
              {share.isin} · your cost {rupee2(share.partner_base ?? 0)} / share
            </Text>
          </Card>

          {/* Client */}
          <View style={{ gap: space[3] }}>
            <Text variant="overline" tone="faint" caps>
              Client
            </Text>

            {clientsQ.loading && clients.length === 0 ? (
              <SkeletonScreen rows={2} />
            ) : clients.length === 0 ? (
              <EmptyState
                icon={UserRound}
                title="No clients mapped to you yet"
                message="Once your relationship manager maps clients to you, they appear here and you can order on their behalf."
              />
            ) : (
              <>
                <Input
                  icon={Search}
                  placeholder="Search your clients"
                  value={query}
                  onChangeText={setQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />

                <Card padding={0} style={{ overflow: 'hidden' }}>
                  {shown.length === 0 ? (
                    <Text variant="small" tone="muted" center style={{ padding: space[5] }}>
                      No client matches “{query.trim()}”.
                    </Text>
                  ) : (
                    shown.slice(0, 40).map((c, i) => {
                      const on = c.client_id === clientId;
                      return (
                        <Pressable
                          key={c.client_id}
                          onPress={() => {
                            void Haptics.selectionAsync();
                            setClientId(c.client_id);
                          }}
                          style={{
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: space[3],
                            paddingHorizontal: space[4],
                            paddingVertical: space[3],
                            backgroundColor: on ? p.bg.selected : 'transparent',
                            borderBottomWidth: i === Math.min(shown.length, 40) - 1 ? 0 : 1,
                            borderBottomColor: p.border.subtle,
                          }}
                        >
                          <View style={{ flex: 1 }}>
                            <Text variant="smallMedium" tone={on ? 'accent' : 'primary'} numberOfLines={1}>
                              {c.full_name}
                            </Text>
                            <Text variant="caption" tone="faint" numberOfLines={1} style={{ marginTop: 1 }}>
                              {c.client_code}
                              {c.city ? ` · ${c.city}` : ''}
                            </Text>
                          </View>
                          <View
                            style={{
                              width: 20,
                              height: 20,
                              borderRadius: radius.full,
                              borderWidth: on ? 6 : 1,
                              borderColor: on ? p.accent.DEFAULT : p.border.DEFAULT,
                            }}
                          />
                        </Pressable>
                      );
                    })
                  )}
                </Card>

                {shown.length > 40 ? (
                  <Text variant="caption" tone="faint">
                    Showing the first 40 of {shown.length}. Search to narrow it down.
                  </Text>
                ) : null}
              </>
            )}
          </View>

          {/* Margin + quantity */}
          <View style={{ flexDirection: 'row', gap: space[3] }}>
            <View style={{ flex: 1, gap: space[2] }}>
              <Text variant="overline" tone="faint" caps>
                Your margin
              </Text>
              <Input
                icon={Percent}
                placeholder="0"
                value={marginValue}
                onChangeText={setMargin}
                keyboardType="decimal-pad"
                returnKeyType="done"
              />
              <Text variant="caption" tone="faint">
                Max {MAX_PARTNER_SHARE_MARGIN}%
              </Text>
            </View>

            <View style={{ flex: 1, gap: space[2] }}>
              <Text variant="overline" tone="faint" caps>
                Quantity
              </Text>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: p.border.DEFAULT,
                  backgroundColor: p.bg.surface,
                  padding: 4,
                  height: 48,
                }}
              >
                <StepButton
                  icon={Minus}
                  label="Decrease quantity"
                  disabled={qty <= min}
                  onPress={() => setQtyState(Math.max(min, qty - step))}
                />
                <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: p.text.primary }}>
                  {qty}
                </Text>
                <StepButton icon={Plus} label="Increase quantity" onPress={() => setQtyState(qty + step)} />
              </View>
              <Text variant="caption" tone="faint">
                Min {min}
                {step > 1 ? ` · steps of ${step}` : ''}
              </Text>
            </View>
          </View>

          {qtyProblem ? (
            <Text variant="caption" style={{ color: p.state.dangerSoft }}>
              {qtyProblem}
            </Text>
          ) : null}

          {/* Breakdown */}
          <Card padding={4} style={{ gap: space[2] }}>
            <Row label="Price / share (incl. your margin)" value={rupee2(bd.pricePerShare)} />
            <View
              style={{
                marginTop: space[1],
                borderRadius: radius.md,
                backgroundColor: p.bg.surface,
                paddingHorizontal: space[3],
                paddingVertical: space[3],
              }}
            >
              <Row label="Amount payable (indicative)" value={rupee2(bd.amount)} strong />
            </View>
            <Row
              label={`Your margin at ${pctLabel(bd.margin)}`}
              value={rupee2(bd.yourMargin)}
              tone="success"
            />
          </Card>

          {placeError ? (
            <View
              style={{
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: `${p.state.dangerSoft}33`,
                backgroundColor: `${p.state.dangerSoft}14`,
                padding: space[3],
              }}
            >
              <Text variant="small" style={{ color: p.state.dangerSoft }}>
                {placeError}
              </Text>
            </View>
          ) : null}

          <View style={{ flexDirection: 'row', gap: space[2] }}>
            <ShieldCheck size={13} color={p.state.successSoft} style={{ marginTop: 1 }} />
            <Text variant="caption" tone="faint" style={{ flex: 1 }}>
              Routed to the client's relationship manager, who confirms availability and the deal.
              No payment is taken now, and the price is re-derived on our side before the order is
              recorded.
            </Text>
          </View>
        </Animated.View>
      </ScrollView>

      {/* Pinned action */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: p.border.DEFAULT,
          backgroundColor: p.bg.elevated,
          paddingTop: space[4],
          paddingBottom: space[2],
          gap: space[2],
          marginHorizontal: -space[5],
          paddingHorizontal: space[5],
        }}
      >
        <Button
          label={`Place order · ${rupee2(bd.amount)}`}
          fullWidth
          disabled={!canPlace}
          loading={placing}
          onPress={() => void place()}
        />
        {!clientId ? (
          <Text variant="caption" tone="muted" center>
            Choose a client to continue.
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */

function Row({
  label,
  value,
  strong,
  tone,
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'success';
}) {
  const p = usePalette();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[3],
        paddingVertical: 2,
      }}
    >
      <Text variant="small" tone="secondary" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text
        variant={strong ? 'moneySmall' : 'smallMedium'}
        style={{
          textAlign: 'right',
          color: tone === 'success' ? p.state.successSoft : p.text.primary,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function StepButton({
  icon: Icon,
  label,
  onPress,
  disabled,
}: {
  icon: typeof Minus;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const p = usePalette();
  return (
    <Card
      weight="surface"
      padding={0}
      radiusToken="sm"
      onPress={() => {
        void Haptics.selectionAsync();
        onPress();
      }}
      disabled={disabled}
      accessibilityLabel={label}
      style={{
        width: 32,
        height: 32,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: p.bg.elevated,
      }}
    >
      <Icon size={15} color={p.text.primary} strokeWidth={2.4} />
    </Card>
  );
}
