/**
 * My Clients — the people this partner sourced.
 *
 * Read through `nw_partner_clients`, which projects columns explicitly. What
 * comes back is deliberately partial: portfolio figures and a masked mobile,
 * never PAN, date of birth, email, address or bank details. That is a decision
 * about what a partner is entitled to see about someone else's money, not a
 * limitation of this screen — so nothing here tries to fetch more.
 */
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Search, Users } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { fmt } from '@shared/crm/utils';
import { PartnerService } from '@shared/partner/services/PartnerService';
import { space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { usePartnerQuery } from '@/features/partner/usePartnerData';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Delta } from '@/ui/Money';
import { Input } from '@/ui/Input';
import { EmptyState, ErrorState, KpiStat, SkeletonScreen, StatusPill } from '@/ui/kit';

export default function PartnerClients() {
  const p = usePalette();
  const load = useCallback(() => PartnerService.getClients(), []);
  const { data, loading, error, refresh } = usePartnerQuery(load);

  const [query, setQuery] = useState('');

  const clients = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (data ?? [])
      .filter(
        (c) =>
          !needle ||
          c.full_name.toLowerCase().includes(needle) ||
          c.client_code.toLowerCase().includes(needle) ||
          (c.city ?? '').toLowerCase().includes(needle),
      )
      .sort((a, b) => b.current_value - a.current_value);
  }, [data, query]);

  const invested = (data ?? []).reduce((s, c) => s + (c.invested_amount || 0), 0);
  const current = (data ?? []).reduce((s, c) => s + (c.current_value || 0), 0);

  return (
    <Screen onRefresh={refresh} refreshing={loading && !!data} tabBarInset>
      <ScreenHeader
        title="My Clients"
        subtitle="The clients you have sourced, and how their portfolios are doing."
      />

      {loading && !data ? (
        <SkeletonScreen rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : (data ?? []).length === 0 ? (
        <EmptyState
          icon={Users}
          title="No clients yet"
          message="Clients you introduce to Niyom will appear here once they are onboarded."
        />
      ) : (
        <View style={{ gap: space[5] }}>
          <View style={{ flexDirection: 'row', gap: space[3] }}>
            <KpiStat label="Total invested" value={fmt(invested)} />
            <KpiStat
              label="Current value"
              value={fmt(current)}
              sub={
                invested > 0
                  ? `${current >= invested ? '+' : ''}${(((current - invested) / invested) * 100).toFixed(1)}%`
                  : undefined
              }
              tone={current >= invested ? 'success' : 'danger'}
            />
          </View>

          <Input
            icon={Search}
            placeholder="Search a client or code"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />

          {clients.length === 0 ? (
            <EmptyState icon={Search} title="No matches" message="Nothing matches that search." />
          ) : (
            <View style={{ gap: space[3] }}>
              {clients.map((c, i) => {
                const gain = c.current_value - c.invested_amount;
                const active = c.onboarding_status === 'active';
                return (
                  <Animated.View
                    key={c.client_id}
                    entering={FadeInDown.duration(340).delay(Math.min(i, 10) * 40)}
                  >
                    <Card
                      padding={4}
                      onPress={() =>
                        router.push({ pathname: '/partner-client', params: { id: c.client_id } })
                      }
                    >
                      <View style={{ flexDirection: 'row', gap: space[3] }}>
                        <View style={{ flex: 1 }}>
                          <Text variant="bodyMedium" numberOfLines={1}>
                            {c.full_name}
                          </Text>
                          <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                            {[c.client_code, c.city].filter(Boolean).join(' · ')}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text variant="moneySmall">{fmt(c.current_value)}</Text>
                          {c.invested_amount > 0 ? (
                            <View style={{ marginTop: 2 }}>
                              <Delta
                                amount={gain}
                                percent={(gain / c.invested_amount) * 100}
                                variant="caption"
                                showAmount={false}
                              />
                            </View>
                          ) : null}
                        </View>
                      </View>

                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: space[2],
                          marginTop: space[3],
                          paddingTop: space[3],
                          borderTopWidth: 1,
                          borderTopColor: p.border.subtle,
                        }}
                      >
                        <StatusPill
                          dot
                          tone={active ? 'success' : 'warning'}
                          label={active ? 'Active' : humanise(c.onboarding_status)}
                        />
                        <View style={{ flex: 1 }} />
                        <Text variant="caption" tone="faint">
                          {c.holdings_count} holding{c.holdings_count === 1 ? '' : 's'}
                        </Text>
                      </View>
                    </Card>
                  </Animated.View>
                );
              })}
            </View>
          )}
        </View>
      )}
    </Screen>
  );
}

/** "kyc_pending" → "KYC pending". The RPC returns raw workflow values. */
function humanise(status: string): string {
  const spaced = status.replace(/_/g, ' ');
  return spaced.replace(/^kyc/i, 'KYC').replace(/^./, (c) => c.toUpperCase());
}
