/**
 * One fund — the NAV chart, the returns, and the way in.
 *
 * The chart is a plain SVG path over the NAV history the catalog returns. No
 * charting library: the data is a list of {date, nav} and the only interaction
 * worth having is the one below, which reads a value as the finger moves.
 *
 * ## What the returns line does and does not claim
 *
 * These are the AMFI-published point-to-point returns for the scheme, not the
 * client's own return on it. Someone who invested through a SIP will have a
 * different number, which is what XIRR on the dashboard is for — so the section
 * is labelled "Scheme returns" rather than "Returns".
 */
import { useMemo } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CalendarClock, TrendingUp } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { fmtDate } from '@shared/crm/utils';
import { useFundCatalog, useFundDetail } from '@/features/client/mf/queries';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import { onboardingIncomplete } from '@shared/portal/onboarding/onboardingSteps';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { NavChart } from '@/ui/NavChart';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { ErrorState, Skeleton, SkeletonScreen, StatusPill } from '@/ui/kit';

const PERIODS = ['6M', '1Y', '3Y', '5Y', 'SI'] as const;

export default function Fund() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const clientId = useClientId();
  const p = usePalette();

  const { funds } = useFundCatalog();
  const { snapshot } = useClientSnapshot(clientId);
  const { detail, loading, error } = useFundDetail(code);

  const fund = useMemo(() => funds.find((f) => f.amfiCode === code) ?? null, [funds, code]);
  const kycPending = !!snapshot.client && onboardingIncomplete(snapshot.client);


  if (!fund && loading) {
    return (
      <Screen>
        <ScreenHeader title="Fund" showBack />
        <SkeletonScreen rows={3} />
      </Screen>
    );
  }

  if (!fund) {
    return (
      <Screen>
        <ScreenHeader title="Fund" showBack />
        <ErrorState message={error ?? 'That fund is no longer in the catalog.'} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader title={fund.name} subtitle={fund.amc} showBack />

      <View style={{ gap: space[5] }}>
        <Animated.View entering={FadeInDown.duration(400)}>
          <Card padding={5}>
            <Text variant="overline" tone="muted" caps>
              NAV{fund.navDate ? ` · ${fmtDate(fund.navDate)}` : ''}
            </Text>
            <Text variant="money" style={{ marginTop: space[2] }}>
              {fund.nav != null ? `₹${fund.nav.toFixed(4)}` : '—'}
            </Text>

            {detail?.navHistory && detail.navHistory.length > 1 ? (
              <View style={{ marginTop: space[5] }}>
                <NavChart points={detail.navHistory} />
              </View>
            ) : loading ? (
              // Shaped like the chart it replaces, so nothing jumps when the
              // real one arrives.
              <View style={{ marginTop: space[5], gap: space[2] }}>
                <Skeleton height={14} width="55%" />
                <Skeleton height={150} rounded="md" />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Skeleton height={12} width={64} />
                  <Skeleton height={12} width={64} />
                </View>
              </View>
            ) : error ? (
              <Text variant="small" tone="muted" style={{ marginTop: space[5] }}>
                The NAV history could not be loaded just now. Everything else on this page is
                current.
              </Text>
            ) : null}

            {detail?.high52w != null && detail?.low52w != null ? (
              <View
                style={{
                  flexDirection: 'row',
                  gap: space[5],
                  marginTop: space[4],
                  paddingTop: space[4],
                  borderTopWidth: 1,
                  borderTopColor: p.border.subtle,
                }}
              >
                <Mini label="52-week low" value={`₹${detail.low52w.toFixed(2)}`} />
                <Mini label="52-week high" value={`₹${detail.high52w.toFixed(2)}`} />
              </View>
            ) : null}
          </Card>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(60)}>
          <Text variant="overline" tone="muted" caps style={{ marginBottom: space[3] }}>
            Scheme returns
          </Text>
          <Card padding={4}>
            {PERIODS.map((period, i) => {
              const value = fund.returns[period];
              return (
                <View
                  key={period}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: space[3],
                    borderBottomWidth: i === PERIODS.length - 1 ? 0 : 1,
                    borderBottomColor: p.border.subtle,
                  }}
                >
                  <Text variant="small" tone="secondary" style={{ flex: 1 }}>
                    {period === 'SI' ? 'Since launch' : period}
                  </Text>
                  <Text
                    variant="smallMedium"
                    style={{
                      color:
                        value == null
                          ? p.text.faint
                          : value >= 0
                            ? p.state.successSoft
                            : p.state.dangerSoft,
                    }}
                  >
                    {value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`}
                  </Text>
                </View>
              );
            })}
          </Card>
          <Text variant="caption" tone="faint" style={{ marginTop: space[2] }}>
            Point-to-point returns published for the scheme — not your own return on it.
          </Text>
        </Animated.View>

        <Animated.View entering={FadeInDown.duration(400).delay(120)}>
          <Card padding={4}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
              {fund.risk ? <StatusPill label={`${fund.risk} risk`} /> : null}
              {fund.subCategory ? <StatusPill label={fund.subCategory} /> : null}
              {fund.minInvestment ? (
                <StatusPill label={`Min ₹${fund.minInvestment.toLocaleString('en-IN')}`} />
              ) : null}
              {fund.launchDate ? <StatusPill label={`Since ${fmtDate(fund.launchDate)}`} /> : null}
            </View>
          </Card>
        </Animated.View>

        {/* ------------------------------ the way in --------------------- */}
        {kycPending ? (
          <Card padding={4} onPress={() => router.push('/onboarding')}>
            <Text variant="bodyMedium">Finish your KYC to invest</Text>
            <Text variant="small" tone="muted" style={{ marginTop: space[1] }}>
              Your account needs to be active before an order can be placed.
            </Text>
          </Card>
        ) : (
          <View style={{ gap: space[3] }}>
            <Button
              label="Start a SIP"
              icon={CalendarClock}
              onPress={() =>
                router.push({ pathname: '/invest-order', params: { code: fund.amfiCode, mode: 'sip' } })
              }
              fullWidth
              size="lg"
            />
            <Button
              label="Invest a lump sum"
              icon={TrendingUp}
              variant="secondary"
              onPress={() =>
                router.push({ pathname: '/invest-order', params: { code: fund.amfiCode, mode: 'lumpsum' } })
              }
              fullWidth
              size="lg"
            />
          </View>
        )}

        <Text variant="caption" tone="faint" center>
          Mutual fund investments are subject to market risk. Read all scheme-related documents
          carefully.
        </Text>
      </View>
    </Screen>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text variant="caption" tone="muted" caps numberOfLines={1}>
        {label}
      </Text>
      <Text variant="smallMedium" style={{ marginTop: 2 }}>
        {value}
      </Text>
    </View>
  );
}
