/**
 * Reviewing and placing an unlisted-share order.
 *
 * As with bonds (`bond-order.tsx`), no money moves here: this is a request to
 * the client's relationship manager, who confirms availability and sends a deal
 * confirmation to accept. The acknowledgement says so plainly.
 *
 * The amount shown is indicative, computed on the device. `place-share-order`
 * re-derives the price server-side and re-checks the lot rule, so the
 * confirmation quotes what the SERVER decided.
 */
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Check, CheckCircle2, ShieldCheck } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { fmtFull } from '@shared/crm/utils';
import { ShareOrderService, type ShareOrder } from '@shared/portal/services/ShareOrderService';
import { minQty, qtyError, shareBreakdown } from '@shared/portal/shares/shareMath';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { ShareLogo, shareTitle, sharesLabel } from '@/features/client/shares/ShareCard';
import { useInvalidateShareOrders, useShare } from '@/features/client/shares/queries';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { ErrorState, SkeletonScreen } from '@/ui/kit';

export default function ShareOrderReview() {
  const p = usePalette();
  const clientId = useClientId();
  const { id, qty: qtyParam } = useLocalSearchParams<{ id?: string; qty?: string }>();
  const { share, loading, error } = useShare(id);
  const invalidateOrders = useInvalidateShareOrders();

  const [agree, setAgree] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<ShareOrder | null>(null);

  /*
   * A route param is a string from an untrusted surface (a deep link can carry
   * anything), so it is parsed rather than trusted. An unusable value falls back
   * to the lot minimum; a usable-but-off-lot one is shown with the reason and
   * cannot be placed — the server would refuse it anyway.
   */
  const qty = useMemo(() => {
    if (!share) return 1;
    const n = Math.floor(Number(qtyParam));
    return Number.isFinite(n) && n > 0 ? n : minQty(share);
  }, [share, qtyParam]);

  const bd = useMemo(() => shareBreakdown(share?.client_price ?? null, qty), [share, qty]);
  const problem = share ? qtyError(share, qty) : null;

  const place = async () => {
    if (!share || !clientId) return;
    setPlacing(true);
    setPlaceError(null);
    try {
      const order = await ShareOrderService.placeOrder({ clientId, shareId: share.id, qty });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidateOrders();
      setPlaced(order);
    } catch (e) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setPlaceError(e instanceof Error ? e.message : 'Could not place your order. Please try again.');
    } finally {
      setPlacing(false);
    }
  };

  if (loading || !share) {
    return (
      <Screen>
        <ScreenHeader title="Review order" showBack />
        {error ? (
          <ErrorState message={error} />
        ) : loading ? (
          <SkeletonScreen rows={3} />
        ) : (
          <ErrorState message="This share isn't available any more." />
        )}
      </Screen>
    );
  }

  const title = shareTitle(share);

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
            Your order <Text variant="smallMedium">{placed.ref}</Text> for {sharesLabel(placed.qty)} of{' '}
            {placed.company_name || title} has gone to your relationship manager. They will confirm
            availability and the final terms, then send you a deal confirmation to accept.
          </Text>

          <Card weight="surface" padding={4} style={{ gap: space[2] }}>
            <Row label="Quantity" value={sharesLabel(placed.qty)} />
            <Row label="Indicative amount" value={fmtFull(placed.amount ?? bd.amount)} strong />
          </Card>

          <View style={{ gap: space[3] }}>
            <Button label="View my orders" fullWidth onPress={() => router.replace('/shares?tab=orders')} />
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <ShareLogo name={title} url={share.logo_url} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyMedium" numberOfLines={2}>
                {title}
              </Text>
              <Text variant="caption" tone="faint" style={{ marginTop: 2 }}>
                {share.isin}
              </Text>
            </View>
          </View>
        </Card>

        <Card padding={4} style={{ gap: space[2] }}>
          <Text variant="h3" style={{ marginBottom: space[1] }}>
            Order overview
          </Text>
          <Row label={`Quantity (${qty} × ${fmtFull(bd.pricePerShare)})`} value={fmtFull(bd.amount)} />
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
            <Row label="Amount payable (indicative)" value={fmtFull(bd.amount)} strong />
          </View>
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
            Unlisted shares are not exchange-traded; prices and availability are indicative, and the
            final amount, stamp duty and off-market settlement are confirmed on the deal
            confirmation I'll receive and accept.
          </Text>
        </Pressable>

        {problem || placeError ? (
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
              {problem ?? placeError}
            </Text>
          </View>
        ) : null}

        <Button
          label={placing ? 'Placing order…' : `Place order · ${fmtFull(bd.amount)}`}
          disabled={!agree || !!problem}
          loading={placing}
          fullWidth
          onPress={() => void place()}
        />

        <View style={{ flexDirection: 'row', gap: space[2] }}>
          <ShieldCheck size={13} color={p.state.successSoft} style={{ marginTop: 1 }} />
          <Text variant="caption" tone="faint" style={{ flex: 1 }}>
            No payment is taken now. Your RM confirms the deal and shares settlement instructions
            once you accept.
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
