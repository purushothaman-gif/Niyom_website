/**
 * Asset Allocation — how the money is spread.
 *
 * Four cuts of the same portfolio, from `PortfolioService.buildPortfolioData`'s
 * `breakdowns`: by product, by asset class, by category and by fund house. They
 * are a segmented control rather than four stacked charts, because the question
 * "am I too concentrated?" is asked one dimension at a time.
 *
 * The bars under the donut are what actually answers it. A donut shows shape;
 * a sorted bar list shows that 41% sits in one AMC, which is the thing worth
 * knowing.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { PieChart } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { fmt } from '@shared/crm/utils';
import { PortfolioService } from '@shared/portal/services/PortfolioService';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import type { AllocationDimension } from '@shared/portal/types';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { DonutChart } from '@/ui/DonutChart';
import { EmptyState, ErrorState, Segmented, SkeletonScreen } from '@/ui/kit';

type DimensionId = AllocationDimension['id'];

const DIMENSIONS: { value: DimensionId; label: string }[] = [
  { value: 'product', label: 'Product' },
  { value: 'assetClass', label: 'Asset' },
  { value: 'category', label: 'Category' },
  { value: 'amc', label: 'AMC' },
];

export default function Allocation() {
  const clientId = useClientId();
  const p = usePalette();
  const { snapshot, loading, error, refreshedAt, refresh } = useClientSnapshot(clientId);

  const [dimension, setDimension] = useState<DimensionId>('product');

  const hasData = !!refreshedAt;
  const data = useMemo(
    () => (hasData ? PortfolioService.buildPortfolioData(snapshot.holdings) : null),
    [hasData, snapshot.holdings],
  );

  const active = data?.breakdowns[dimension];
  const buckets = useMemo(
    () => [...(active?.buckets ?? [])].sort((a, b) => b.value - a.value),
    [active],
  );

  return (
    <Screen onRefresh={refresh} refreshing={loading && hasData}>
      <ScreenHeader
        title="Asset Allocation"
        subtitle="How your money is spread across asset classes, products and fund houses."
        showBack
      />

      {!hasData && loading ? (
        <SkeletonScreen rows={2} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : !data || data.summary.netWorth <= 0 ? (
        <EmptyState
          icon={PieChart}
          title="Nothing to spread yet"
          message="Your allocation appears once you hold something."
        />
      ) : (
        <View style={{ gap: space[5] }}>
          <Segmented<DimensionId>
            value={dimension}
            onChange={setDimension}
            options={DIMENSIONS}
          />

          <Animated.View
            /* Keyed on the dimension so switching cuts re-runs the donut's
               draw-on animation rather than silently swapping the arcs. */
            key={dimension}
            entering={FadeIn.duration(260)}
          >
            <Card padding={5} style={{ alignItems: 'center' }}>
              <DonutChart
                size={200}
                thickness={26}
                slices={buckets.map((b) => ({ label: b.label, value: b.value }))}
                centerLabel={active?.title}
                centerValue={fmt(active?.total ?? 0)}
              />
            </Card>
          </Animated.View>

          <View style={{ gap: space[3] }}>
            {buckets.map((bucket, i) => {
              const share = active && active.total > 0 ? (bucket.value / active.total) * 100 : 0;
              const color = p.category[i % p.category.length];
              return (
                <View key={bucket.label} style={{ gap: space[2] }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
                    <View
                      style={{ width: 9, height: 9, borderRadius: radius.full, backgroundColor: color }}
                    />
                    <Text variant="smallMedium" numberOfLines={1} style={{ flex: 1 }}>
                      {bucket.label}
                    </Text>
                    <Text variant="smallMedium" tone="secondary">
                      {fmt(bucket.value)}
                    </Text>
                    <Text variant="smallMedium" style={{ color, width: 52, textAlign: 'right' }}>
                      {share.toFixed(1)}%
                    </Text>
                  </View>
                  {/* The bar carries the comparison the percentages only imply. */}
                  <View
                    style={{
                      height: 5,
                      borderRadius: radius.full,
                      backgroundColor: p.bg.raised,
                      overflow: 'hidden',
                    }}
                  >
                    <View
                      style={{
                        width: `${Math.max(share, 1)}%`,
                        height: '100%',
                        borderRadius: radius.full,
                        backgroundColor: color,
                      }}
                    />
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      )}
    </Screen>
  );
}
