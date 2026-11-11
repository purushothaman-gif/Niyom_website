/**
 * One unlisted share — the facts we hold, and the quantity.
 *
 * Follows `bond.tsx`: the quantity picker and the running total are pinned to
 * the bottom (the website's sticky sidebar, on a phone) while the company
 * details scroll behind them, and the route carries only an `id`, resolved out
 * of the marketplace's React Query cache.
 *
 * The quantity can be typed as well as stepped — share lots run to hundreds or
 * thousands, where a +/- alone is unusable. The rule that decides whether a
 * typed quantity is acceptable is `shared/portal/shares/shareMath.ts`, the same
 * one the website and `place-share-order` apply.
 */
import { useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ArrowRight, ExternalLink, Gem, Minus, Plus, ShieldCheck } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { fmtFull } from '@shared/crm/utils';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import { onboardingIncomplete } from '@shared/portal/onboarding/onboardingSteps';
import { minQty, qtyError, shareBreakdown, stepQty } from '@shared/portal/shares/shareMath';
import { font, radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { ShareLogo, shareTitle, sharesLabel } from '@/features/client/shares/ShareCard';
import { useShare } from '@/features/client/shares/queries';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, SkeletonScreen, StatusPill } from '@/ui/kit';

export default function ShareDetail() {
  const p = usePalette();
  const clientId = useClientId();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { share, loading, error } = useShare(id);
  const { snapshot } = useClientSnapshot(clientId);

  const client = snapshot.client;
  const canInvest = !!client && !onboardingIncomplete(client);

  const min = share ? minQty(share) : 1;
  const step = share ? stepQty(share) : 1;
  /** Raw text so the field can be empty mid-edit; null = untouched = the minimum. */
  const [typed, setTyped] = useState<string | null>(null);
  const qty = typed == null ? min : Number(typed || 0);

  const bd = useMemo(() => shareBreakdown(share?.client_price ?? null, qty), [share, qty]);
  const problem = share ? qtyError(share, qty) : null;

  if (loading) {
    return (
      <Screen>
        <ScreenHeader title="Unlisted share" showBack />
        <SkeletonScreen rows={4} />
      </Screen>
    );
  }

  if (error || !share) {
    return (
      <Screen>
        <ScreenHeader title="Unlisted share" showBack />
        {error ? (
          <ErrorState message={error} />
        ) : (
          <EmptyState
            icon={Gem}
            title="This share isn't available"
            message="It may have been withdrawn, or it isn't part of your approved list. Your relationship manager can tell you what else is on offer."
          />
        )}
      </Screen>
    );
  }

  const title = shareTitle(share);
  const price = Number(share.client_price) || 0;
  const website = safeUrl(share.website);

  const rows: Array<[string, string]> = [
    ['ISIN', share.isin || '—'],
    ['Company', share.company_name || '—'],
    ['Sector', share.sector || '—'],
    ['Face value', share.face_value != null ? fmtFull(Number(share.face_value)) : '—'],
    ['Minimum quantity', sharesLabel(min)],
    ['Lot size', sharesLabel(step)],
  ];

  const setQty = (n: number) => setTyped(String(Math.max(min, n)));

  return (
    <Screen scroll={false}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: space[6] }}
      >
        <ScreenHeader title="Unlisted share" showBack />

        <Animated.View entering={FadeIn.duration(300)} style={{ gap: space[4] }}>
          {/* Hero */}
          <Card padding={5} style={{ gap: space[4] }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
              <ShareLogo name={title} url={share.logo_url} size={48} />
              <View style={{ flex: 1 }}>
                <Text variant="h3">{title}</Text>
                <Text variant="caption" tone="faint" style={{ marginTop: 3 }}>
                  {share.company_name} · {share.isin}
                </Text>
              </View>
            </View>
            {share.sector ? <StatusPill label={share.sector} tone="accent" /> : null}

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[4] }}>
              <HeroFigure label="Price / share" value={fmtFull(price)} />
              <HeroFigure label="Min. quantity" value={String(min)} />
              <HeroFigure label="Min. investment" value={fmtFull(shareBreakdown(price, min).amount)} />
            </View>
          </Card>

          {share.about ? (
            <Card padding={4} style={{ gap: space[2] }}>
              <Text variant="h3">About the company</Text>
              <Text variant="small" tone="secondary">
                {share.about}
              </Text>
              {website ? (
                <Pressable
                  onPress={() => void Linking.openURL(website)}
                  hitSlop={8}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] + 2, marginTop: space[1] }}
                >
                  <Text variant="smallMedium" tone="accent">
                    Visit website
                  </Text>
                  <ExternalLink size={12} color={p.accent.DEFAULT} />
                </Pressable>
              ) : null}
            </Card>
          ) : null}

          <Card padding={4}>
            <Text variant="h3" style={{ marginBottom: space[1] }}>
              Security details
            </Text>
            {rows.map(([k, v], i) => (
              <View
                key={k}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: space[3],
                  paddingVertical: space[3],
                  borderBottomWidth: i === rows.length - 1 ? 0 : 1,
                  borderBottomColor: p.border.subtle,
                }}
              >
                <Text variant="small" tone="secondary" style={{ flex: 1 }}>
                  {k}
                </Text>
                <Text variant="smallMedium" style={{ flex: 1, textAlign: 'right' }}>
                  {v}
                </Text>
              </View>
            ))}
          </Card>

          <Text variant="caption" tone="faint">
            Unlisted shares are not traded on an exchange. Prices are indicative, availability is
            confirmed by your relationship manager at the time of dealing, and settlement happens
            off-market into your demat account. These instruments carry liquidity and valuation
            risk, and there is no assurance of a listing.
          </Text>
        </Animated.View>
      </ScrollView>

      {/* Pinned: quantity + running total + the action */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: p.border.DEFAULT,
          backgroundColor: p.bg.elevated,
          paddingTop: space[4],
          paddingBottom: space[2],
          gap: space[3],
          marginHorizontal: -space[5],
          paddingHorizontal: space[5],
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
          <View style={{ flex: 1 }}>
            <Text variant="overline" tone="faint" caps>
              Quantity
            </Text>
            <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
              Min {min}
              {step > 1 ? ` · steps of ${step}` : ''}
            </Text>
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[2],
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: problem ? p.state.dangerSoft : p.border.DEFAULT,
              backgroundColor: p.bg.surface,
              padding: 4,
            }}
          >
            <StepButton
              icon={Minus}
              label="Decrease quantity"
              disabled={qty <= min}
              onPress={() => setQty(qty - step)}
            />
            <TextInput
              value={typed ?? String(min)}
              onChangeText={(t) => setTyped(t.replace(/[^0-9]/g, '').slice(0, 9))}
              keyboardType="number-pad"
              returnKeyType="done"
              selectTextOnFocus
              accessibilityLabel="Quantity"
              style={{
                fontFamily: font.displayBold,
                fontSize: 18,
                minWidth: 64,
                paddingVertical: 4,
                textAlign: 'center',
                color: p.text.primary,
              }}
            />
            <StepButton icon={Plus} label="Increase quantity" onPress={() => setQty(Math.max(min, qty) + step)} />
          </View>
        </View>

        {problem ? (
          <Text variant="caption" style={{ color: p.state.dangerSoft }}>
            {problem}
          </Text>
        ) : null}

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space[3] }}>
          <View style={{ flex: 1 }}>
            <Text variant="overline" tone="faint" caps>
              Indicative amount
            </Text>
            <Text variant="moneySmall" style={{ marginTop: 2 }}>
              {fmtFull(bd.amount)}
            </Text>
            <Text variant="caption" tone="muted" style={{ marginTop: 1 }}>
              Stamp duty finalised at confirmation
            </Text>
          </View>

          <View style={{ flex: 1 }}>
            <Button
              label="Review order"
              icon={ArrowRight}
              iconRight
              disabled={!canInvest || !!problem}
              fullWidth
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push(`/share-order?id=${share.id}&qty=${qty}`);
              }}
            />
          </View>
        </View>

        {!canInvest ? (
          <Text variant="caption" tone="muted" center>
            Complete your KYC to place an order. You can keep browsing in the meantime.
          </Text>
        ) : (
          <View style={{ flexDirection: 'row', gap: space[2] }}>
            <ShieldCheck size={13} color={p.state.successSoft} style={{ marginTop: 1 }} />
            <Text variant="caption" tone="faint" style={{ flex: 1 }}>
              No payment is taken now — your RM confirms availability and the final terms.
            </Text>
          </View>
        )}
      </View>
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */

/** Only http(s) links are opened — the field is free text typed into the CRM. */
function safeUrl(raw: string | null): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return v;
  return /^[a-z][a-z0-9+.-]*:/i.test(v) ? null : `https://${v}`;
}

function HeroFigure({ label, value }: { label: string; value: string }) {
  const p = usePalette();
  return (
    <View style={{ minWidth: 78, flexGrow: 1, flexBasis: '28%' }}>
      <Text variant="caption" tone="faint" numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={{ fontFamily: font.displayBold, fontSize: 17, marginTop: 3, color: p.text.primary }}
        numberOfLines={1}
        adjustsFontSizeToFit
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
        width: 34,
        height: 34,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: p.bg.elevated,
      }}
    >
      <Icon size={16} color={p.text.primary} strokeWidth={2.4} />
    </Card>
  );
}
