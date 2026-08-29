/**
 * Reviewing and placing a bond order.
 *
 * ## No money moves here
 *
 * This is a request to the client's relationship manager, not a market
 * purchase. The RM confirms the final terms and sends a deal confirmation to
 * accept; payment instructions follow that. Saying so plainly is the whole point
 * of the acknowledgement — a screen that ends in "Place order · ₹4,12,000" and
 * says nothing else reads like a checkout, and the client will expect a debit.
 *
 * ## Why the client's arithmetic is not the order's arithmetic
 *
 * The breakdown shown here is indicative, computed on the device from the
 * client's approved price. `place-bond-order` re-derives the price server-side,
 * re-checks the lot rule and returns the authoritative units and amount — so the
 * confirmation quotes what the SERVER decided, never what this screen displayed.
 * They should agree; if they ever do not, the server is right.
 */
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Check, CheckCircle2, ShieldCheck } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { fmtFull } from '@shared/crm/utils';
import { BondOrderService, type BondOrder } from '@shared/portal/services/BondOrderService';
import { breakdown, minUnits } from '@shared/portal/bonds/bondMath';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { useBond, useInvalidateBondOrders } from '@/features/client/bonds/queries';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { ErrorState, SkeletonScreen } from '@/ui/kit';

export default function BondOrderReview() {
  const p = usePalette();
  const clientId = useClientId();
  const { id, units: unitsParam } = useLocalSearchParams<{ id?: string; units?: string }>();
  const { bond, loading, error } = useBond(id);
  const invalidateOrders = useInvalidateBondOrders();

  const [agree, setAgree] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<BondOrder | null>(null);

  /*
   * A route param is a string from an untrusted surface (a deep link can carry
   * anything), so it is parsed rather than trusted — and floored to the lot
   * minimum, which is the same floor the server enforces.
   */
  const units = useMemo(() => {
    if (!bond) return 1;
    const n = Math.floor(Number(unitsParam));
    return Number.isFinite(n) && n > 0 ? Math.max(minUnits(bond), n) : minUnits(bond);
  }, [bond, unitsParam]);

  const bd = useMemo(() => (bond ? breakdown(bond, units) : null), [bond, units]);

  const place = async () => {
    if (!bond) return;
    setPlacing(true);
    setPlaceError(null);
    try {
      const order = await BondOrderService.placeOrder({ clientId, bondId: bond.id, units });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidateOrders();
      setPlaced(order);
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPlaceError(
        e instanceof Error ? e.message : 'Could not place your order. Please try again.',
      );
    } finally {
      setPlacing(false);
    }
  };

  if (loading || !bond || !bd) {
    return (
      <Screen>
        <ScreenHeader title="Review order" showBack />
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
            Your order{' '}
            <Text variant="smallMedium">{placed.ref}</Text> for {placed.units} unit
            {placed.units === 1 ? '' : 's'} of {placed.bond_name || placed.isin} has gone to your
            relationship manager. They will confirm the final terms and send you a deal confirmation
            to accept.
          </Text>

          <Card weight="surface" padding={4} style={{ gap: space[2] }}>
            <Row label="Quantity" value={`${placed.units} unit${placed.units === 1 ? '' : 's'}`} />
            <Row label="Indicative amount" value={fmtFull(placed.amount ?? bd.amountPayable)} strong />
          </Card>

          <View style={{ gap: space[3] }}>
            <Button
              label="View my orders"
              fullWidth
              onPress={() => router.replace('/bonds')}
            />
            <Button
              label="Back to my portfolio"
              variant="ghost"
              fullWidth
              onPress={() => router.replace('/(client)/dashboard')}
            />
          </View>
        </Animated.View>
      </Screen>
    );
  }

  /* ---- Review ---------------------------------------------------------- */
  return (
    <Screen>
      <ScreenHeader title="Review order" subtitle="Nothing is charged at this step." showBack />

      <Animated.View entering={FadeInDown.duration(360)} style={{ gap: space[4] }}>
        <Card padding={4}>
          <Text variant="bodyMedium">{bond.bond_name || bond.issuer_name || bond.isin}</Text>
          <Text variant="caption" tone="faint" style={{ marginTop: 2 }}>
            {bond.isin}
          </Text>
        </Card>

        <Card padding={4} style={{ gap: space[2] }}>
          <Text variant="h3" style={{ marginBottom: space[1] }}>
            Investment overview
          </Text>
          <Row
            label={`Investment amount (${units} × ${fmtFull(bd.pricePerUnit)})`}
            value={fmtFull(bd.investment)}
          />
          <Row label="Accrued interest" value={fmtFull(bd.accrued)} />
          <Row label="Stamp duty" value="Finalised at confirmation" muted />

          <View
            style={{
              marginTop: space[2],
              borderRadius: radius.md,
              backgroundColor: p.bg.surface,
              paddingHorizontal: space[3],
              paddingVertical: space[3],
            }}
          >
            <Row label="Amount payable (indicative)" value={fmtFull(bd.amountPayable)} strong />
          </View>

          {bd.estMaturityValue != null ? (
            <View style={{ paddingTop: space[2] }}>
              <Row label="Expected returns" value={fmtFull(bd.estMaturityValue)} />
            </View>
          ) : null}
        </Card>

        {/* Acknowledgement */}
        <Pressable
          onPress={() => {
            void Haptics.selectionAsync();
            setAgree((a) => !a);
          }}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agree }}
          style={{
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: space[3],
            padding: space[3],
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: agree ? p.accent.tint(0.4) : p.border.DEFAULT,
            backgroundColor: agree ? p.bg.selected : p.bg.surface,
          }}
        >
          <View
            style={{
              width: 20,
              height: 20,
              borderRadius: radius.sm,
              marginTop: 1,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: agree ? p.accent.DEFAULT : p.border.DEFAULT,
              backgroundColor: agree ? p.accent.DEFAULT : 'transparent',
            }}
          >
            {agree ? <Check size={13} color={p.text.onAccent} strokeWidth={3} /> : null}
          </View>
          <Text variant="small" tone="secondary" style={{ flex: 1 }}>
            I understand this is a request to my relationship manager, not a live-market purchase.
            Prices are indicative; the final amount, stamp duty and settlement are confirmed on the
            deal confirmation I'll receive and accept.
          </Text>
        </Pressable>

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

        <Button
          label={placing ? 'Placing order…' : `Place order · ${fmtFull(bd.amountPayable)}`}
          disabled={!agree}
          loading={placing}
          fullWidth
          onPress={() => void place()}
        />

        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <ShieldCheck size={13} color={p.state.successSoft} style={{ marginTop: 1 }} />
          <Text variant="caption" tone="faint" style={{ flex: 1 }}>
            No payment is taken now. Your RM confirms the deal and shares payment and settlement
            instructions once you accept.
          </Text>
        </View>
      </Animated.View>
    </Screen>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
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
        tone={muted ? 'faint' : 'primary'}
        style={{ textAlign: 'right' }}
      >
        {value}
      </Text>
    </View>
  );
}
