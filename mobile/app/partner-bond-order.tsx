/**
 * A partner raises a bond order for one of their clients.
 *
 * Four decisions: which client, what margin, how many units, and confirm. The
 * web modal fits them in one dialog; here they are one scrolling screen with the
 * running total pinned, which is the same reasoning as the client's own bond
 * detail — the amount must not scroll away while the inputs are being set.
 *
 * ## The client list is a search field, not a dropdown
 *
 * A `<select>` of every client is fine with a mouse and miserable on a phone
 * once a partner has more than a dozen. Typing two letters of a name is faster
 * than scrolling a picker wheel, and the same field handles a partner with three
 * clients and one with three hundred.
 *
 * ## Nothing here is trusted
 *
 * The margin, the units and the price are all re-derived by
 * `place-partner-bond-order` from `partner_base` and the DSA's approved rate.
 * The figures below are indicative and say so; if this screen and the server
 * ever disagree, the server is right and the confirmation quotes ITS numbers.
 */
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  CheckCircle2,
  Minus,
  Plus,
  Search,
  ShieldCheck,
  UserRound,
} from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { fmtFull } from '@shared/crm/utils';
import {
  PartnerService,
  type PartnerBondOrder,
} from '@shared/partner/services/PartnerService';
import {
  MAX_PARTNER_MARGIN,
  clampMargin,
  isMarginValid,
  partnerBreakdown,
} from '@shared/partner/bonds/partnerBondMath';
import { minUnits, stepUnits } from '@shared/portal/bonds/bondMath';
import { font, radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { usePartnerBond, usePartnerClients } from '@/features/partner/bonds/queries';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Input } from '@/ui/Input';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, SkeletonScreen } from '@/ui/kit';

const pct = (v: number) => `${v.toFixed(2)}%`;
const rupee2 = (v: number | null | undefined) => (v == null ? '—' : `₹${Number(v).toFixed(2)}`);

export default function PartnerBondOrder() {
  const p = usePalette();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data: bond, loading, error } = usePartnerBond(id);
  const clientsQ = usePartnerClients();

  const [clientId, setClientId] = useState('');
  const [query, setQuery] = useState('');
  const [margin, setMargin] = useState<string | null>(null);
  const [units, setUnits] = useState<number | null>(null);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<PartnerBondOrder | null>(null);

  /* `?? []` inline would be a fresh array every render, re-running the search below. */
  const clients = useMemo(() => clientsQ.data ?? [], [clientsQ.data]);
  /* Defaults come from the bond, which is not loaded on first render. */
  const marginValue = margin ?? String(bond?.self_markup_percent ?? 0);
  const min = bond ? minUnits(bond) : 1;
  const step = bond ? stepUnits(bond) : 1;
  const qty = units ?? min;

  const bd = useMemo(
    () => (bond ? partnerBreakdown(bond, qty, marginValue) : null),
    [bond, qty, marginValue],
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
  const canPlace = !!clientId && isMarginValid(marginValue) && qty >= min && !placing;

  const place = async () => {
    if (!bond) return;
    setPlacing(true);
    setPlaceError(null);
    try {
      const order = await PartnerService.placeBondOrder({
        clientId,
        bondId: bond.id,
        units: qty,
        margin: clampMargin(marginValue),
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

  if (loading || !bond || !bd) {
    return (
      <Screen>
        <ScreenHeader title="Order for a client" showBack />
        {error ? <ErrorState message={error} /> : <SkeletonScreen rows={3} />}
      </Screen>
    );
  }

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
            Order <Text variant="smallMedium">{placed.ref}</Text> for {placed.units} unit
            {placed.units === 1 ? '' : 's'}
            {selected ? ` on behalf of ${selected.full_name}` : ''} has gone to the client's
            relationship manager, who will confirm the deal.
          </Text>

          <Card weight="surface" padding={4} style={{ gap: space[2] }}>
            <Row label="Quantity" value={`${placed.units} unit${placed.units === 1 ? '' : 's'}`} />
            <Row label="Price / ₹100" value={rupee2(placed.price_per_100)} />
            <Row label="Indicative amount" value={fmtFull(placed.amount ?? bd.amount)} strong />
          </Card>

          <View style={{ gap: space[3] }}>
            <Button label="View my orders" fullWidth onPress={() => router.replace('/partner-bonds')} />
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
            <Text variant="bodyMedium">{bond.bond_name || bond.issuer_name || bond.isin}</Text>
            <Text variant="caption" tone="faint" style={{ marginTop: 2 }}>
              {bond.isin} · your cost {rupee2(bond.partner_base)}/₹100
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
                              alignItems: 'center',
                              justifyContent: 'center',
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

          {/* Margin + units */}
          <View style={{ flexDirection: 'row', gap: space[3] }}>
            <View style={{ flex: 1, gap: space[2] }}>
              <Text variant="overline" tone="faint" caps>
                Your margin
              </Text>
              <Input
                placeholder="0"
                value={marginValue}
                onChangeText={setMargin}
                keyboardType="decimal-pad"
                returnKeyType="done"
              />
              <Text variant="caption" tone="faint">
                Max {MAX_PARTNER_MARGIN}%
              </Text>
            </View>

            <View style={{ flex: 1, gap: space[2] }}>
              <Text variant="overline" tone="faint" caps>
                Units
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
                  label="Decrease units"
                  disabled={qty <= min}
                  onPress={() => setUnits(Math.max(min, qty - step))}
                />
                <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: p.text.primary }}>
                  {qty}
                </Text>
                <StepButton icon={Plus} label="Increase units" onPress={() => setUnits(qty + step)} />
              </View>
              <Text variant="caption" tone="faint">
                Min {min}
              </Text>
            </View>
          </View>

          {/* Breakdown */}
          <Card padding={4} style={{ gap: space[2] }}>
            <Row label="Price / ₹100 (incl. your margin)" value={rupee2(bd.pricePer100)} />
            <Row label="Investment amount" value={fmtFull(bd.investment)} />
            {bd.accrued > 0 ? <Row label="Accrued interest" value={fmtFull(bd.accrued)} /> : null}
            <View
              style={{
                marginTop: space[1],
                borderRadius: radius.md,
                backgroundColor: p.bg.surface,
                paddingHorizontal: space[3],
                paddingVertical: space[3],
              }}
            >
              <Row label="Amount payable (indicative)" value={fmtFull(bd.amount)} strong />
            </View>
            <Row
              label={`Your margin at ${pct(bd.margin)}`}
              value={fmtFull(bd.yourMargin)}
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
              Routed to the client's relationship manager, who confirms the deal. No payment is
              taken now, and the price is re-derived on our side before the order is recorded.
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
          label={`Place order · ${fmtFull(bd.amount)}`}
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
