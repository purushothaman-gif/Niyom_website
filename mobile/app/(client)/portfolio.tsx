/**
 * My Portfolio — every holding, valued at the latest published NAV.
 *
 * The rows come from `PortfolioService.buildPortfolioData` in `shared/`, which
 * is also what fills the website's portfolio table, so the value and gain on a
 * holding here are the same numbers by construction.
 *
 * ## Why the source note is not decoration
 *
 * For mutual funds the app shows EITHER the client's imported statement or the
 * funds Niyom recorded — never both merged, because a fund bought through us
 * appears in each and summing them would double it. Which one is in play
 * changes what "complete" means, so `CasStatusNote` says so plainly rather than
 * leaving someone to wonder why a fund they hold elsewhere is missing.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { Search, Upload, Wallet } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { fmt, PRODUCT_LABELS } from '@shared/crm/utils';
import { PortfolioService } from '@shared/portal/services/PortfolioService';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import type { HoldingRow } from '@shared/portal/types';
import { space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { CasStatusNote } from '@/features/client/CasStatusNote';
import { HoldingCard } from '@/features/client/HoldingCard';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Money, Delta } from '@/ui/Money';
import { Input } from '@/ui/Input';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, Segmented, SkeletonScreen } from '@/ui/kit';

type Filter = 'all' | 'gainers' | 'losers';

export default function Portfolio() {
  const clientId = useClientId();
  const p = usePalette();
  const { snapshot, loading, error, refreshedAt, refresh } = useClientSnapshot(clientId);

  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const hasData = !!refreshedAt;
  const data = useMemo(
    () => (hasData ? PortfolioService.buildPortfolioData(snapshot.holdings) : null),
    [hasData, snapshot.holdings],
  );

  const rows = useMemo(() => {
    if (!data) return [];
    const needle = query.trim().toLowerCase();
    return data.rows
      .filter((r) => (filter === 'gainers' ? r.gain > 0 : filter === 'losers' ? r.gain < 0 : true))
      .filter(
        (r) =>
          !needle ||
          r.name.toLowerCase().includes(needle) ||
          (r.amc ?? '').toLowerCase().includes(needle) ||
          (r.meta ?? '').toLowerCase().includes(needle),
      );
  }, [data, query, filter]);

  /** Rows grouped under their product, so bonds do not sit among funds. */
  const groups = useMemo(() => {
    const byProduct = new Map<string, HoldingRow[]>();
    for (const row of rows) {
      const list = byProduct.get(row.productType) ?? [];
      list.push(row);
      byProduct.set(row.productType, list);
    }
    return [...byProduct.entries()].sort(
      (a, b) =>
        b[1].reduce((s, r) => s + r.value, 0) - a[1].reduce((s, r) => s + r.value, 0),
    );
  }, [rows]);

  return (
    <Screen onRefresh={refresh} refreshing={loading && hasData} tabBarInset>
      <ScreenHeader
        title="My Portfolio"
        subtitle="Every holding you have with us, valued at the latest published NAV."
      />

      {!hasData && loading ? (
        <SkeletonScreen rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : data ? (
        <View style={{ gap: space[5] }}>
          <Animated.View entering={FadeInDown.duration(400)}>
            <Card padding={5}>
              <Text variant="overline" tone="muted" caps>
                Current value
              </Text>
              <Money value={data.summary.netWorth} variant="money" animate style={{ marginTop: space[2] }} />
              <View style={{ marginTop: space[2] }}>
                <Delta amount={data.summary.gain} percent={data.summary.gainPercent} variant="bodyMedium" />
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  marginTop: space[4],
                  paddingTop: space[4],
                  borderTopWidth: 1,
                  borderTopColor: p.border.subtle,
                  gap: space[5],
                }}
              >
                <Mini label="Invested" value={fmt(data.summary.invested)} />
                <Mini label="Holdings" value={String(data.summary.holdingsCount)} />
                <Mini label="Products" value={String(data.summary.productCount)} />
              </View>
            </Card>
          </Animated.View>

          <CasStatusNote
            freshness={snapshot.casFreshness}
            hasImportedStatement={snapshot.mfSource === 'cas'}
            valuedOn={snapshot.valuedOn}
            onImport={() => router.push('/import-portfolio')}
          />

          {data.rows.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="Nothing here yet"
              message="Once you invest through Niyom — or import your statement — your holdings appear here."
              action={
                <Button
                  label="Import my statement"
                  icon={Upload}
                  onPress={() => router.push('/import-portfolio')}
                />
              }
            />
          ) : (
            <>
              <View style={{ gap: space[3] }}>
                <Input
                  icon={Search}
                  placeholder="Search a fund, bond or folio"
                  value={query}
                  onChangeText={setQuery}
                  autoCapitalize="none"
                  autoCorrect={false}
                  returnKeyType="search"
                />
                <Segmented<Filter>
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'gainers', label: 'Gainers' },
                    { value: 'losers', label: 'Losers' },
                  ]}
                />
              </View>

              {rows.length === 0 ? (
                <EmptyState
                  icon={Search}
                  title="No matches"
                  message="Nothing in your portfolio matches that. Try a different search or filter."
                />
              ) : (
                groups.map(([productType, list]) => (
                  <View key={productType} style={{ gap: space[3] }}>
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'baseline',
                        justifyContent: 'space-between',
                      }}
                    >
                      <Text variant="overline" tone="muted" caps>
                        {PRODUCT_LABELS[productType as keyof typeof PRODUCT_LABELS] ?? productType}
                      </Text>
                      <Text variant="smallMedium" tone="secondary">
                        {fmt(list.reduce((s, r) => s + r.value, 0))}
                      </Text>
                    </View>
                    {list.map((row, i) => (
                      <HoldingCard key={row.id} row={row} index={i} />
                    ))}
                  </View>
                ))
              )}
            </>
          )}
        </View>
      ) : null}
    </Screen>
  );
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text variant="caption" tone="muted" caps numberOfLines={1}>
        {label}
      </Text>
      <Text variant="moneySmall" style={{ marginTop: 3 }}>
        {value}
      </Text>
    </View>
  );
}
