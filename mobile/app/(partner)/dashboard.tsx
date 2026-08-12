/**
 * The Partner Dashboard.
 *
 * What a DSA opens the app to check: whether anything needs signing, what they
 * have earned this financial year and what is still owed, and how the clients
 * they sourced are doing.
 *
 * Every figure is a read-only mirror of `dsa_debit_notes`. The payout formula
 * itself is NOT reimplemented here — it lives in exactly one place, the CRM's
 * `DSAPayout.tsx`, and a second copy is how two screens start disagreeing about
 * what a partner is owed.
 */
import { useCallback } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { FileSignature, Users, Wallet } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { fmt } from '@shared/crm/utils';
import { PartnerService } from '@shared/partner/services/PartnerService';
import { space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { usePartnerQuery } from '@/features/partner/usePartnerData';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Money, Delta } from '@/ui/Money';
import { ErrorState, KpiStat, ListRow, SectionHeader, SkeletonScreen, StatusPill } from '@/ui/kit';

export default function PartnerDashboard() {
  const p = usePalette();

  const load = useCallback(
    () =>
      Promise.all([
        PartnerService.getProfile(),
        PartnerService.getPayoutSummary(),
        PartnerService.getClients(),
      ]),
    [],
  );
  const { data, loading, error, refresh } = usePartnerQuery(load);

  const [profile, payout, clients] = data ?? [null, null, null];

  const invested = (clients ?? []).reduce((sum, c) => sum + (c.invested_amount || 0), 0);
  const current = (clients ?? []).reduce((sum, c) => sum + (c.current_value || 0), 0);
  const activeCount = (clients ?? []).filter((c) => c.onboarding_status === 'active').length;

  return (
    <Screen onRefresh={refresh} refreshing={loading && !!data} tabBarInset>
      <View style={{ marginBottom: space[6] }}>
        <Text variant="small" tone="muted">
          Partner Portal
        </Text>
        <Text variant="h1" numberOfLines={2} style={{ marginTop: 2 }}>
          {profile?.full_name ?? 'Welcome'}
        </Text>
        {profile ? (
          <Text variant="caption" tone="faint" style={{ marginTop: 4 }}>
            {profile.dsa_code}
          </Text>
        ) : null}
      </View>

      {loading && !data ? (
        <SkeletonScreen rows={3} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : (
        <View style={{ gap: space[6] }}>
          {/* Anything awaiting a signature is the one thing that blocks payment,
              so it goes above the earnings rather than inside them. */}
          {payout && payout.awaiting_signature_count > 0 ? (
            <Animated.View entering={FadeInDown.duration(400)}>
              <Card
                weight="surface"
                padding={4}
                onPress={() => router.push('/(partner)/payouts')}
                style={{ borderColor: p.accent.tint(0.4) }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
                  <FileSignature size={20} color={p.accent.DEFAULT} />
                  <View style={{ flex: 1 }}>
                    <Text variant="bodyMedium">
                      {payout.awaiting_signature_count} statement
                      {payout.awaiting_signature_count === 1 ? '' : 's'} awaiting your signature
                    </Text>
                    <Text variant="small" tone="muted" style={{ marginTop: 2 }}>
                      Your RM emails a secure signing link for each statement.
                    </Text>
                  </View>
                </View>
              </Card>
            </Animated.View>
          ) : null}

          {payout ? (
            <Animated.View entering={FadeInDown.duration(400).delay(60)}>
              <SectionHeader title="Earnings" subtitle={payout.fy_label} />
              <Card padding={5}>
                <Text variant="overline" tone="muted" caps>
                  Raised this financial year
                </Text>
                <Money value={payout.fy_net} variant="money" animate style={{ marginTop: space[2] }} />
                <Text variant="small" tone="muted" style={{ marginTop: 2 }}>
                  Gross {fmt(payout.fy_gross)} · TDS {fmt(payout.fy_tds)}
                </Text>

                <View style={{ flexDirection: 'row', gap: space[3], marginTop: space[4] }}>
                  <KpiStat label="Paid to date" value={fmt(payout.paid_net)} sub="Net of TDS" />
                  <KpiStat
                    label="Awaiting payment"
                    value={fmt(payout.awaiting_payment_net)}
                    tone="accent"
                  />
                </View>
                <View style={{ flexDirection: 'row', gap: space[3], marginTop: space[3] }}>
                  <KpiStat
                    label="Lifetime earnings"
                    value={fmt(payout.lifetime_net)}
                    sub="Net of TDS, all years"
                  />
                </View>

                {payout.latest_note_number ? (
                  <Text variant="small" tone="muted" style={{ marginTop: space[4] }}>
                    Latest statement {payout.latest_note_number}
                    {payout.latest_note_period ? ` for ${payout.latest_note_period}` : ''} —{' '}
                    {fmt(payout.latest_note_net ?? 0)} net payable.
                  </Text>
                ) : null}
              </Card>
            </Animated.View>
          ) : null}

          <Animated.View entering={FadeInDown.duration(400).delay(120)}>
            <SectionHeader
              title="Your business"
              action={{ label: 'All clients', onPress: () => router.push('/(partner)/clients') }}
            />
            <View style={{ flexDirection: 'row', gap: space[3], flexWrap: 'wrap' }}>
              <KpiStat
                label="Clients sourced"
                value={String(clients?.length ?? 0)}
                sub={`${activeCount} active`}
                icon={Users}
              />
              <KpiStat label="Total invested" value={fmt(invested)} icon={Wallet} />
            </View>
            <View style={{ marginTop: space[3] }}>
              <Card weight="surface" padding={4}>
                <Text variant="overline" tone="muted" caps>
                  Current value
                </Text>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'flex-end',
                    justifyContent: 'space-between',
                    marginTop: space[2],
                  }}
                >
                  <Money value={current} variant="moneySmall" />
                  <Delta
                    amount={current - invested}
                    percent={invested > 0 ? ((current - invested) / invested) * 100 : null}
                    showAmount={false}
                  />
                </View>
              </Card>
            </View>
          </Animated.View>

          {clients && clients.length > 0 ? (
            <Animated.View entering={FadeInDown.duration(400).delay(180)}>
              <SectionHeader title="Recent clients" />
              <Card padding={4}>
                {clients.slice(0, 5).map((c, i, arr) => (
                  <ListRow
                    key={c.client_id}
                    title={c.full_name}
                    subtitle={c.client_code}
                    value={fmt(c.current_value)}
                    valueSub={c.onboarding_status === 'active' ? 'Active' : c.onboarding_status}
                    onPress={() =>
                      router.push({ pathname: '/partner-client', params: { id: c.client_id } })
                    }
                    showChevron
                    last={i === Math.min(arr.length, 5) - 1}
                  />
                ))}
              </Card>
            </Animated.View>
          ) : null}

          {profile ? (
            <View style={{ alignItems: 'center' }}>
              <StatusPill
                dot
                tone={profile.status === 'active' ? 'success' : 'warning'}
                label={`Partner status: ${profile.status}`}
              />
            </View>
          ) : null}
        </View>
      )}
    </Screen>
  );
}
