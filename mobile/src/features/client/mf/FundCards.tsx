/**
 * The two ways a fund is shown in the Mutual Funds section.
 *
 * `FundTile` is the half-width card used in horizontal shelves — a fund house
 * monogram, the name, and ONE number. `FundRow` is the full-width row used in
 * lists, which has room for the category and a bookmark.
 *
 * ## Why the return is the only number on a tile
 *
 * A tile has room for about four words and one figure. Putting NAV, AUM and
 * expense ratio on it as well produces something nobody reads at a glance,
 * which is the only thing a tile is for. The rest lives on the fund's page.
 */
import { View } from 'react-native';
import { Pressable } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Bookmark } from 'lucide-react-native';
import type { CatalogFund } from '@shared/portal/types/funds';
import { font, radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';

/** A stable colour per fund house, so the same AMC always looks the same. */
function houseColour(amc: string, palette: readonly string[]): string {
  let hash = 0;
  for (let i = 0; i < amc.length; i += 1) hash = (hash * 31 + amc.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length];
}

/** "SBI Funds Management" -> "SB". A stand-in for a logo we do not license. */
function monogram(amc: string): string {
  const words = amc.trim().split(/\s+/).filter(Boolean);
  const letters = words.length >= 2 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

export function HouseMark({ amc, size = 40 }: { amc: string; size?: number }) {
  const p = usePalette();
  const colour = houseColour(amc || '?', p.category);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.sm + 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: `${colour}26`,
      }}
    >
      <Text style={{ fontFamily: font.displayBold, fontSize: size * 0.36, color: colour }}>
        {monogram(amc || '?')}
      </Text>
    </View>
  );
}

function ReturnFigure({ value, period }: { value: number | null; period: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space[2] }}>
      <Text
        style={{
          fontFamily: font.displayBold,
          fontSize: 19,
          color:
            value == null ? p.text.faint : value >= 0 ? p.state.successSoft : p.state.dangerSoft,
        }}
      >
        {value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`}
      </Text>
      <Text variant="caption" tone="faint">
        {period}
      </Text>
    </View>
  );
}

/** Half-width tile for horizontal shelves and two-column grids. */
export function FundTile({
  fund,
  period = '3Y',
  width,
}: {
  fund: CatalogFund;
  period?: keyof CatalogFund['returns'];
  width?: number;
}) {
  return (
    <Card
      weight="surface"
      padding={4}
      onPress={() => router.push({ pathname: '/fund', params: { code: fund.amfiCode } })}
      style={width ? { width } : { flex: 1 }}
    >
      <HouseMark amc={fund.amc} />
      <Text variant="smallMedium" numberOfLines={2} style={{ marginTop: space[3], minHeight: 36 }}>
        {fund.name}
      </Text>
      <View style={{ marginTop: space[3] }}>
        <ReturnFigure value={fund.returns[period]} period={period} />
      </View>
    </Card>
  );
}

/** Full-width row for the long lists. */
export function FundRow({
  fund,
  period = '3Y',
  bookmarked,
  onToggleBookmark,
}: {
  fund: CatalogFund;
  period?: keyof CatalogFund['returns'];
  bookmarked?: boolean;
  onToggleBookmark?: () => void;
}) {
  const p = usePalette();

  return (
    <Pressable
      onPress={() => router.push({ pathname: '/fund', params: { code: fund.amfiCode } })}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingVertical: space[3] + 2,
        opacity: pressed ? 0.65 : 1,
        borderBottomWidth: 1,
        borderBottomColor: p.border.subtle,
      })}
    >
      <HouseMark amc={fund.amc} size={38} />

      <View style={{ flex: 1 }}>
        <Text variant="smallMedium" numberOfLines={2}>
          {fund.name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
          {[fund.subCategory, fund.risk ? `${fund.risk} risk` : null].filter(Boolean).join(' · ')}
        </Text>
      </View>

      <View style={{ alignItems: 'flex-end' }}>
        <ReturnFigure value={fund.returns[period]} period={period} />
      </View>

      {onToggleBookmark ? (
        <Pressable
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={bookmarked ? 'Remove from watchlist' : 'Add to watchlist'}
          onPress={() => {
            void Haptics.selectionAsync();
            onToggleBookmark();
          }}
        >
          <Bookmark
            size={18}
            color={bookmarked ? p.accent.DEFAULT : p.text.faint}
            fill={bookmarked ? p.accent.DEFAULT : 'transparent'}
          />
        </Pressable>
      ) : null}
    </Pressable>
  );
}
