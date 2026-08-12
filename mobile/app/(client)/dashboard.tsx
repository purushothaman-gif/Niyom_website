/**
 * The Wealth Dashboard.
 *
 * Every figure here comes from `buildDashboardData` in `shared/`, the same
 * function that fills the website's dashboard — so net worth, gain, XIRR and
 * the fund rollup match niyomwealth.com to the rupee by construction rather
 * than by two implementations agreeing.
 *
 * ## What it does NOT invent
 *
 * The shared model deliberately dropped placeholder daily-change, goals and
 * market-update blocks: this screen shows someone their own money, and a
 * plausible invented number is worse than an absent one. Where a value is
 * genuinely unavailable — XIRR without enough history, a day change without a
 * NAV feed — the card says so instead of showing a zero.
 */
import { useMemo } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { ArrowLeftRight, Bell, PieChart, Receipt, TrendingUp, Upload, Wallet } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { fmt, fmtFull, PRODUCT_LABELS } from '@shared/crm/utils';
import { buildDashboardData } from '@shared/portal/services/dashboardModel';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import { radius, space } from '@/design/tokens';
import { usePalette, useTheme } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Money, Delta } from '@/ui/Money';
import { DonutChart, DonutLegend } from '@/ui/DonutChart';
import { ErrorState, KpiStat, ListRow, SectionHeader, SkeletonScreen, StatusPill } from '@/ui/kit';
import { GreetingHeader } from '@/features/client/GreetingHeader';

export default function Dashboard() {
  const clientId = useClientId();
  const p = usePalette();
  const { theme } = useTheme();
  const { snapshot, loading, error, refreshedAt, refresh } = useClientSnapshot(clientId);

  const hasData = !!refreshedAt;
  const data = useMemo(() => (hasData ? buildDashboardData(snapshot) : null), [hasData, snapshot]);
  const client = snapshot.client;

  return (
    <Screen onRefresh={refresh} refreshing={loading && hasData} tabBarInset>
      <GreetingHeader
        name={client?.full_name ?? ''}
        refreshedAt={refreshedAt}
        onNotifications={() => router.push('/notifications')}
      />

      {!hasData && loading ? (
        <SkeletonScreen rows={3} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : data ? (
        <View style={{ gap: space[6] }}>
          {/* ---------------------------- Net worth --------------------------- */}
          <Animated.View entering={FadeInDown.duration(420)}>
            <Card padding={5}>
              <Text variant="overline" tone="muted" caps>
                Total net worth
              </Text>
              <Money
                value={data.summary.netWorth}
                variant="moneyLarge"
                animate
                style={{ marginTop: space[2] }}
              />
              <View style={{ marginTop: space[2] }}>
                <Delta amount={data.summary.gain} percent={data.summary.gainPercent} variant="bodyMedium" />
              </View>

              <View
                style={{
                  flexDirection: 'row',
                  gap: space[5],
                  marginTop: space[5],
                  paddingTop: space[4],
                  borderTopWidth: 1,
                  borderTopColor: p.border.subtle,
                }}
              >
                <Stat label="Invested" value={fmt(data.summary.invested)} />
                <Stat
                  label="Returns (XIRR)"
                  /*
                   * Null is meaningful here — it means "not enough history",
                   * which is a different statement from a return of zero.
                   */
                  value={
                    data.xirrPercent == null ? '—' : `${data.xirrPercent >= 0 ? '+' : ''}${data.xirrPercent.toFixed(2)}%`
                  }
                  tone={data.xirrPercent == null ? undefined : data.xirrPercent >= 0 ? 'success' : 'danger'}
                />
                <Stat label="Holdings" value={String(data.summary.holdingsCount)} />
              </View>
            </Card>
          </Animated.View>

          {/* --------------------------- Quick actions ------------------------ */}
          <Animated.View entering={FadeInDown.duration(420).delay(60)}>
            <View style={{ flexDirection: 'row', gap: space[3] }}>
              <QuickAction icon={TrendingUp} label="Invest" onPress={() => router.push('/(client)/invest')} />
              <QuickAction icon={Upload} label="Import CAS" onPress={() => router.push('/import-portfolio')} />
              <QuickAction icon={Receipt} label="Gains" onPress={() => router.push('/capital-gains')} />
              <QuickAction icon={ArrowLeftRight} label="Activity" onPress={() => router.push('/transactions')} />
            </View>
          </Animated.View>

          {/* ---------------------------- Allocation -------------------------- */}
          {data.summary.allocation.length > 0 ? (
            <Animated.View entering={FadeInDown.duration(420).delay(120)}>
              <SectionHeader
                title="Asset allocation"
                action={{ label: 'Details', onPress: () => router.push('/allocation') }}
              />
              <Card padding={5}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[5] }}>
                  <DonutChart
                    size={148}
                    thickness={20}
                    slices={data.summary.allocation.map((a) => ({
                      label: PRODUCT_LABELS[a.productType] ?? a.productType,
                      value: a.value,
                    }))}
                    centerLabel="Total"
                    centerValue={fmt(data.summary.netWorth)}
                  />
                  <DonutLegend
                    slices={data.summary.allocation.map((a) => ({
                      label: PRODUCT_LABELS[a.productType] ?? a.productType,
                      value: a.value,
                    }))}
                  />
                </View>
              </Card>
            </Animated.View>
          ) : null}

          {/* --------------------------- Mutual funds ------------------------- */}
          {data.mutualFunds.folioCount > 0 ? (
            <Animated.View entering={FadeInDown.duration(420).delay(180)}>
              <SectionHeader
                title="Mutual funds"
                subtitle={`${data.mutualFunds.folioCount} folio${data.mutualFunds.folioCount === 1 ? '' : 's'}`}
                action={{ label: 'All holdings', onPress: () => router.push('/(client)/portfolio') }}
              />
              <Card padding={5}>
                <View style={{ flexDirection: 'row', gap: space[3] }}>
                  <KpiStat label="Value" value={fmt(data.mutualFunds.value)} />
                  <KpiStat
                    label="Gain"
                    value={fmt(data.mutualFunds.gain)}
                    sub={`${data.mutualFunds.gainPercent >= 0 ? '+' : ''}${data.mutualFunds.gainPercent.toFixed(2)}%`}
                    tone={data.mutualFunds.gain >= 0 ? 'success' : 'danger'}
                  />
                </View>

                {data.mutualFunds.topFunds.length > 0 ? (
                  <View style={{ marginTop: space[4] }}>
                    {data.mutualFunds.topFunds.slice(0, 4).map((f, i, arr) => (
                      <ListRow
                        key={`${f.name}-${f.folioNumber ?? i}`}
                        title={f.name}
                        subtitle={f.fundHouse}
                        value={fmt(f.value)}
                        valueSub={`${f.gainPercent >= 0 ? '+' : ''}${f.gainPercent.toFixed(1)}%`}
                        valueTone={f.gain >= 0 ? 'success' : 'danger'}
                        last={i === Math.min(arr.length, 4) - 1}
                      />
                    ))}
                  </View>
                ) : null}
              </Card>
            </Animated.View>
          ) : null}

          {/* ------------------------ Recent transactions --------------------- */}
          {data.recentTransactions.length > 0 ? (
            <Animated.View entering={FadeInDown.duration(420).delay(240)}>
              <SectionHeader
                title="Recent activity"
                action={{ label: 'See all', onPress: () => router.push('/transactions') }}
              />
              <Card padding={4}>
                {data.recentTransactions.slice(0, 5).map((t, i, arr) => (
                  <ListRow
                    key={t.id}
                    icon={t.txnType === 'buy' ? Wallet : PieChart}
                    iconColor={t.txnType === 'buy' ? theme.state.successSoft : theme.state.warningSoft}
                    title={t.productName}
                    subtitle={`${t.txnType === 'buy' ? 'Purchase' : 'Redemption'} · ${t.date}`}
                    value={fmtFull(t.amount)}
                    last={i === Math.min(arr.length, 5) - 1}
                  />
                ))}
              </Card>
            </Animated.View>
          ) : null}

          {/* --------------------------- Data provenance ---------------------- */}
          <View style={{ alignItems: 'center', gap: space[2] }}>
            <StatusPill
              dot
              tone={snapshot.mfSource === 'cas' ? 'success' : 'neutral'}
              label={
                snapshot.mfSource === 'cas'
                  ? `Funds from your statement${snapshot.valuedOn ? ` · valued ${snapshot.valuedOn}` : ''}`
                  : 'Funds recorded by Niyom only'
              }
            />
            {snapshot.mfSource !== 'cas' ? (
              <Text variant="caption" tone="faint" center style={{ maxWidth: 300 }}>
                Import your CAS to include funds bought elsewhere.
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'success' | 'danger';
}) {
  const p = usePalette();
  return (
    <View style={{ flex: 1 }}>
      <Text variant="caption" tone="muted" caps numberOfLines={1}>
        {label}
      </Text>
      <Text
        variant="moneySmall"
        style={{
          marginTop: 3,
          color:
            tone === 'success' ? p.state.successSoft : tone === 'danger' ? p.state.dangerSoft : p.text.primary,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

function QuickAction({
  icon: Icon,
  label,
  onPress,
}: {
  icon: typeof TrendingUp;
  label: string;
  onPress: () => void;
}) {
  const p = usePalette();
  return (
    <Card weight="surface" padding={3} onPress={onPress} style={{ flex: 1, alignItems: 'center', gap: space[2] }}>
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: p.accent.tint(0.14),
        }}
      >
        <Icon size={17} color={p.accent.DEFAULT} strokeWidth={2} />
      </View>
      <Text variant="caption" tone="secondary" numberOfLines={1}>
        {label}
      </Text>
    </Card>
  );
}
