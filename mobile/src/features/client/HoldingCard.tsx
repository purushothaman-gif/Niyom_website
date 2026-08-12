/**
 * One holding.
 *
 * A card rather than a table row: the website can afford eight columns, a phone
 * cannot, and squeezing them in produces something nobody reads. So the two
 * numbers that matter — what it is worth and what it has made — get the space,
 * and units, cost and category sit underneath in a size that says "detail".
 *
 * The product colour bar down the left is `PRODUCT_CHART_COLORS` from
 * `shared/`, the same vivid theme-constant hex the website's charts use, so a
 * bond is the same colour in a donut and in this list.
 */
import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { fmt, fmtFull } from '@shared/crm/utils';
import type { HoldingRow } from '@shared/portal/types';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Delta } from '@/ui/Money';

export function HoldingCard({ row, index }: { row: HoldingRow; index: number }) {
  const p = usePalette();

  return (
    /* Entrance is capped at ~10 rows' worth of delay: staggering a 60-holding
       portfolio all the way down would take three seconds to finish drawing. */
    <Animated.View entering={FadeInDown.duration(360).delay(Math.min(index, 10) * 40)}>
      <Card padding={0} style={{ overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row' }}>
          <View style={{ width: 3, backgroundColor: row.productColor }} />

          <View style={{ flex: 1, padding: space[4] }}>
            <View style={{ flexDirection: 'row', gap: space[3] }}>
              <View style={{ flex: 1 }}>
                <Text variant="bodyMedium" numberOfLines={2}>
                  {row.name}
                </Text>
                {row.amc || row.meta ? (
                  <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
                    {[row.amc, row.meta].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
              </View>

              <View style={{ alignItems: 'flex-end' }}>
                <Text variant="moneySmall">{fmt(row.value)}</Text>
                <View style={{ marginTop: 2 }}>
                  <Delta
                    amount={row.gain}
                    percent={row.gainPercent}
                    variant="caption"
                    showAmount={false}
                  />
                </View>
              </View>
            </View>

            <View
              style={{
                flexDirection: 'row',
                gap: space[4],
                marginTop: space[3],
                paddingTop: space[3],
                borderTopWidth: 1,
                borderTopColor: p.border.subtle,
              }}
            >
              <Detail label="Invested" value={fmtFull(row.invested)} />
              <Detail
                label="Gain"
                value={`${row.gain >= 0 ? '+' : '−'}${fmtFull(Math.abs(row.gain))}`}
                color={row.gain >= 0 ? p.state.successSoft : p.state.dangerSoft}
              />
              {row.units != null ? (
                <Detail
                  label="Units"
                  /* Funds are quoted to three decimals; trailing zeros are noise. */
                  value={row.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })}
                />
              ) : null}
            </View>

            {row.category ? (
              <View
                style={{
                  alignSelf: 'flex-start',
                  marginTop: space[3],
                  paddingHorizontal: space[2] + 2,
                  paddingVertical: 3,
                  borderRadius: radius.full,
                  backgroundColor: `${row.productColor}1A`,
                }}
              >
                <Text variant="caption" style={{ color: row.productColor }}>
                  {row.category}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Card>
    </Animated.View>
  );
}

function Detail({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text variant="caption" tone="faint" caps numberOfLines={1}>
        {label}
      </Text>
      <Text variant="smallMedium" style={color ? { color } : undefined} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}
