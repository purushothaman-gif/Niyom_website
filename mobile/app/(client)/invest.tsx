/**
 * Mutual Funds — explore the universe and start investing.
 *
 * The catalog is `mf_scheme_cache`, the whole AMFI universe, ordered by
 * three-year return. That is ~9,600 rows, so it is a FlatList with a memoised
 * row: mapping it into a ScrollView would build every card up front and drop
 * frames on the first scroll.
 *
 * ## Investing needs an account first
 *
 * A client cannot place an order until KYC is active and a BSE UCC exists.
 * Rather than let someone browse, choose a fund, tap Invest and only then be
 * told, that state is checked up front and said plainly at the top.
 */
import { useMemo, useState } from 'react';
import { FlatList, View } from 'react-native';
import { router } from 'expo-router';
import { memo } from 'react';
import { Search, ShieldCheck, Sparkles, TrendingUp } from 'lucide-react-native';
import { fmt } from '@shared/crm/utils';
import { useMfCatalog } from '@shared/portal/hooks/useMfCatalog';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import { onboardingIncomplete } from '@shared/portal/onboarding/onboardingSteps';
import { isBseMock } from '@shared/portal/services/bse/gateway';
import type { CatalogFund } from '@shared/portal/types/funds';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen, TAB_BAR_HEIGHT } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { EmptyState, ErrorState, Segmented, SkeletonScreen, StatusPill } from '@/ui/kit';

type Sort = '3Y' | '1Y' | '5Y';

export default function Invest() {
  const clientId = useClientId();
  const p = usePalette();
  const { funds, recommendations, loading, error, reload } = useMfCatalog();
  const { snapshot } = useClientSnapshot(clientId);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>('3Y');

  const client = snapshot.client;
  const kycPending = !!client && onboardingIncomplete(client);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? funds.filter(
          (f) => f.name.toLowerCase().includes(needle) || f.amc.toLowerCase().includes(needle),
        )
      : funds;

    // Nulls last, always — a fund with no history is not a fund with 0% return.
    return [...filtered].sort((a, b) => {
      const av = a.returns[sort];
      const bv = b.returns[sort];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return bv - av;
    });
  }, [funds, query, sort]);

  return (
    <Screen scroll={false} tabBarInset>
      <ScreenHeader
        title="Mutual Funds"
        subtitle="Research funds, start a SIP or invest a lump sum."
      />

      {loading && funds.length === 0 ? (
        <SkeletonScreen rows={5} />
      ) : error ? (
        <ErrorState message={error} onRetry={reload} />
      ) : (
        <>
          {kycPending ? (
            <Card
              padding={4}
              onPress={() => router.push('/onboarding')}
              style={{ marginBottom: space[4], borderColor: p.accent.tint(0.4) }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
                <ShieldCheck size={19} color={p.accent.DEFAULT} />
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium">Finish your KYC to invest</Text>
                  <Text variant="small" tone="muted" style={{ marginTop: 2 }}>
                    You can browse everything below — placing an order needs an active account.
                  </Text>
                </View>
              </View>
            </Card>
          ) : null}

          <View style={{ gap: space[3], marginBottom: space[4] }}>
            <Input
              icon={Search}
              placeholder="Search a fund or fund house"
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            <Segmented<Sort>
              value={sort}
              onChange={setSort}
              options={[
                { value: '1Y', label: '1Y return' },
                { value: '3Y', label: '3Y return' },
                { value: '5Y', label: '5Y return' },
              ]}
            />
          </View>

          <FlatList
            data={rows}
            keyExtractor={(item) => item.amfiCode}
            showsVerticalScrollIndicator={false}
            onRefresh={reload}
            refreshing={loading}
            // Sized so the list can skip measuring 9,600 rows on mount.
            initialNumToRender={8}
            windowSize={7}
            removeClippedSubviews
            ItemSeparatorComponent={() => <View style={{ height: space[3] }} />}
            contentContainerStyle={{ paddingBottom: TAB_BAR_HEIGHT + space[8] }}
            ListHeaderComponent={
              recommendations.length > 0 && !query ? (
                <View style={{ marginBottom: space[5] }}>
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: space[2],
                      marginBottom: space[3],
                    }}
                  >
                    <Sparkles size={14} color={p.accent.DEFAULT} />
                    <Text variant="overline" tone="accent" caps>
                      Recommended by Niyom
                    </Text>
                  </View>
                  <View style={{ gap: space[3] }}>
                    {recommendations.slice(0, 3).map((rec) => (
                      <Card
                        key={rec.amfiCode}
                        weight="surface"
                        padding={4}
                        onPress={() =>
                          router.push({ pathname: '/fund', params: { code: rec.amfiCode } })
                        }
                      >
                        <Text variant="bodyMedium" numberOfLines={2}>
                          {rec.fundName}
                        </Text>
                        {rec.headline ? (
                          <Text variant="small" tone="muted" style={{ marginTop: space[1] }}>
                            {rec.headline}
                          </Text>
                        ) : null}
                      </Card>
                    ))}
                  </View>
                </View>
              ) : null
            }
            ListEmptyComponent={
              <EmptyState
                icon={Search}
                title="No funds match that"
                message="Try a different name, or search by fund house."
              />
            }
            renderItem={({ item }) => <FundRow fund={item} sort={sort} />}
          />

          {isBseMock() ? (
            <Text variant="caption" tone="faint" center style={{ paddingVertical: space[2] }}>
              Illustrative catalog — the live exchange connection is not enabled.
            </Text>
          ) : null}
        </>
      )}
    </Screen>
  );
}

/**
 * Memoised: without it, typing in the search box re-renders every mounted row
 * on each keystroke, which is what makes a long list feel laggy.
 */
const FundRow = memo(function FundRow({ fund, sort }: { fund: CatalogFund; sort: Sort }) {
  const p = usePalette();
  const value = fund.returns[sort];

  return (
    <Card
      padding={4}
      onPress={() => router.push({ pathname: '/fund', params: { code: fund.amfiCode } })}
    >
      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <View style={{ flex: 1 }}>
          <Text variant="bodyMedium" numberOfLines={2}>
            {fund.name}
          </Text>
          <Text variant="caption" tone="muted" style={{ marginTop: 2 }} numberOfLines={1}>
            {[fund.amc, fund.subCategory].filter(Boolean).join(' · ')}
          </Text>
        </View>

        <View style={{ alignItems: 'flex-end' }}>
          <Text
            variant="moneySmall"
            style={{
              color:
                value == null
                  ? p.text.faint
                  : value >= 0
                    ? p.state.successSoft
                    : p.state.dangerSoft,
            }}
          >
            {value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`}
          </Text>
          <Text variant="caption" tone="faint" style={{ marginTop: 1 }}>
            {sort} return
          </Text>
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
        {fund.risk ? <StatusPill label={`${fund.risk} risk`} tone="neutral" /> : null}
        <View style={{ flex: 1 }} />
        {fund.nav != null ? (
          <Text variant="caption" tone="muted">
            NAV {fund.nav.toFixed(2)}
          </Text>
        ) : null}
      </View>
    </Card>
  );
});
