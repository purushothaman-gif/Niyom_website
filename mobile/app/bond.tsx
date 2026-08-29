/**
 * One bond — the facts, and the quantity.
 *
 * ## Why the amount lives in a fixed bar
 *
 * The website puts "Select units" in a sticky sidebar that never leaves the
 * viewport while the client reads down the terms. A phone has no sidebar, and
 * putting the stepper inline means the amount payable scrolls away exactly when
 * someone is reading the maturity date to decide on it. So the stepper and the
 * running total are pinned to the bottom and the terms scroll behind them —
 * which is also what every ordering app on a phone does, for the same reason.
 *
 * ## Why the route carries an id and not the bond
 *
 * A route param is a URL. The bond is resolved from the marketplace's React
 * Query cache (see `features/client/bonds/queries.ts`), which is already
 * populated by the list the client just tapped, so this opens instantly — and
 * still works from a cold deep link, where the single-row RPC answers instead.
 *
 * Every figure here is the client's approved marked-up price or is derived from
 * it by `shared/portal/bonds/bondMath.ts`. Nothing is recomputed locally that
 * the website computes differently.
 */
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ArrowRight, Landmark, Minus, Plus, ShieldCheck } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { fmt, fmtDate, fmtFull } from '@shared/crm/utils';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import { onboardingIncomplete } from '@shared/portal/onboarding/onboardingSteps';
import { breakdown, minUnits, stepUnits, tenureLabel } from '@shared/portal/bonds/bondMath';
import { font, radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { useBond } from '@/features/client/bonds/queries';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, Segmented, SkeletonScreen, StatusPill } from '@/ui/kit';

type Section = 'summary' | 'details';

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Number(v).toFixed(2)}%`);

/** "secured" -> "Secured"; "sdi" -> "SDI". Short tokens are acronyms. */
function cap(s: string | null | undefined): string {
  if (!s) return '—';
  return s.length <= 4 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export default function BondDetail() {
  const p = usePalette();
  const clientId = useClientId();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { bond, loading, error } = useBond(id);
  const { snapshot } = useClientSnapshot(clientId);

  const client = snapshot.client;
  const canInvest = !!client && !onboardingIncomplete(client);

  const min = bond ? minUnits(bond) : 1;
  const step = bond ? stepUnits(bond) : 1;
  const [units, setUnits] = useState<number | null>(null);
  const qty = units ?? min;

  const bd = useMemo(() => (bond ? breakdown(bond, qty) : null), [bond, qty]);

  if (loading) {
    return (
      <Screen>
        <ScreenHeader title="Bond" showBack />
        <SkeletonScreen rows={4} />
      </Screen>
    );
  }

  if (error || !bond) {
    return (
      <Screen>
        <ScreenHeader title="Bond" showBack />
        {error ? (
          <ErrorState message={error} />
        ) : (
          <EmptyState
            icon={Landmark}
            title="This bond isn't available"
            message="It may have been withdrawn, or it isn't part of your approved list. Your relationship manager can tell you what else is on offer."
          />
        )}
      </Screen>
    );
  }

  const summaryRows: Array<[string, string]> = [
    ['Coupon rate', pct(bond.coupon_rate)],
    ['Coupon type', cap(bond.coupon_type)],
    ['Interest payment', cap(bond.coupon_frequency)],
    ['Face value', fmtFull(Number(bond.face_value) || 0)],
    ['Maturity date', fmtDate(bond.maturity_date)],
    ['Next coupon', fmtDate(bond.next_coupon_date)],
    ['Yield to maturity', pct(bond.analytics?.ytm)],
    ['Tenure', tenureLabel(bond)],
  ];
  const detailRows: Array<[string, string]> = [
    ['ISIN', bond.isin || '—'],
    ['Issuer', bond.issuer_name || '—'],
    ['Security type', cap(bond.security_type)],
    ['Principal repayment', cap(bond.principal_repayment_structure)],
    ['Day-count convention', bond.day_count_convention || '—'],
    ['Rating', bond.rating ? `${bond.rating}${bond.rating_agency ? ` · ${bond.rating_agency}` : ''}` : '—'],
    ['Tax status', cap(bond.tax_status)],
    ['Trustee', bond.trustee || '—'],
    ['Issue date', fmtDate(bond.issue_date)],
  ];

  return (
    <Screen scroll={false}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: space[6] }}
      >
        <ScreenHeader title="Bond" showBack />

        <Animated.View entering={FadeIn.duration(300)} style={{ gap: space[4] }}>
          {/* Hero */}
          <Card padding={5} style={{ gap: space[4] }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: radius.lg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: p.accent.tint(0.12),
                }}
              >
                <Landmark size={21} color={p.accent.DEFAULT} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="h3">{bond.bond_name || bond.issuer_name || bond.isin}</Text>
                <Text variant="caption" tone="faint" style={{ marginTop: 3 }}>
                  {bond.issuer_name ? `${bond.issuer_name} · ` : ''}
                  {bond.isin}
                </Text>
              </View>
              {bond.rating ? <StatusPill label={bond.rating} tone="accent" /> : null}
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[4] }}>
              <HeroFigure
                label={bond.analytics?.ytm != null ? 'Yield (YTM)' : 'Coupon'}
                value={pct(bond.analytics?.ytm ?? bond.coupon_rate)}
                tone="positive"
              />
              <HeroFigure label="Coupon" value={pct(bond.coupon_rate)} />
              <HeroFigure label="Tenure" value={tenureLabel(bond)} />
              <HeroFigure
                label="Min. Investment"
                value={fmt(Number(bond.min_investment) || Number(bond.face_value) || 0)}
              />
            </View>
          </Card>

          {/* Terms */}
          <SectionRows
            summaryRows={summaryRows}
            detailRows={detailRows}
          />

          <View style={{ flexDirection: 'row', gap: space[2] }}>
            <ShieldCheck size={13} color={p.state.successSoft} style={{ marginTop: 1 }} />
            <Text variant="caption" tone="faint" style={{ flex: 1 }}>
              Figures are indicative and reflect your approved pricing. Your relationship manager
              confirms the final terms — including stamp duty and settlement — on the deal
              confirmation.
            </Text>
          </View>
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
              Units
            </Text>
            <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
              {fmtFull(Number(bond.face_value) || 0)} face each · min {min}
            </Text>
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[3],
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: p.border.DEFAULT,
              backgroundColor: p.bg.surface,
              padding: 4,
            }}
          >
            <StepButton
              icon={Minus}
              label="Decrease units"
              disabled={qty <= min}
              onPress={() => setUnits(Math.max(min, qty - step))}
            />
            <Text style={{ fontFamily: font.displayBold, fontSize: 18, minWidth: 34, textAlign: 'center', color: p.text.primary }}>
              {qty}
            </Text>
            <StepButton icon={Plus} label="Increase units" onPress={() => setUnits(qty + step)} />
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: space[3] }}>
          <View style={{ flex: 1 }}>
            <Text variant="overline" tone="faint" caps>
              Amount payable
            </Text>
            <Text variant="moneySmall" style={{ marginTop: 2 }}>
              {fmtFull(bd?.amountPayable ?? 0)}
            </Text>
            {bd && bd.accrued > 0 ? (
              <Text variant="caption" tone="muted" style={{ marginTop: 1 }}>
                incl. {fmtFull(bd.accrued)} accrued interest
              </Text>
            ) : null}
          </View>

          <View style={{ flex: 1 }}>
            <Button
              label="Review order"
              icon={ArrowRight}
              iconRight
              disabled={!canInvest}
              fullWidth
              onPress={() => {
                void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push(`/bond-order?id=${bond.id}&units=${qty}`);
              }}
            />
          </View>
        </View>

        {!canInvest ? (
          <Text variant="caption" tone="muted" center>
            Complete your onboarding to place an order.
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */

function HeroFigure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'positive';
}) {
  const p = usePalette();
  return (
    <View style={{ minWidth: 78, flexGrow: 1, flexBasis: '40%' }}>
      <Text variant="caption" tone="faint" numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={{
          fontFamily: font.displayBold,
          fontSize: 19,
          marginTop: 3,
          color: tone === 'positive' ? p.state.successSoft : p.text.primary,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function SectionRows({
  summaryRows,
  detailRows,
}: {
  summaryRows: Array<[string, string]>;
  detailRows: Array<[string, string]>;
}) {
  const p = usePalette();
  const [section, setSection] = useState<Section>('summary');
  const rows = section === 'summary' ? summaryRows : detailRows;

  return (
    <View style={{ gap: space[3] }}>
      <Segmented<Section>
        options={[
          { value: 'summary', label: 'Summary' },
          { value: 'details', label: 'Other details' },
        ]}
        value={section}
        onChange={setSection}
      />

      <Card padding={4}>
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
