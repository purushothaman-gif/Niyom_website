/**
 * Explore — the shop window for the fund universe.
 *
 * Structured the way Indian investing apps have converged on, because the
 * structure is doing real work: a browsing screen over ~9,600 funds is useless
 * as a flat list, so it opens with a handful of curated entry points and only
 * then offers the whole catalog.
 *
 * The shelves are built from `mf_scheme_cache` — the same catalog every other
 * screen uses. Nothing here is hand-maintained, so it cannot go stale.
 */
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import {
  ArrowUpRight,
  BarChart3,
  Building2,
  CalendarClock,
  Coins,
  Gem,
  Landmark,
  ListFilter,
  Sparkles,
  TrendingUp,
  Upload,
  type LucideIcon,
} from 'lucide-react-native';
import { Pressable } from 'react-native';
import type { CatalogFund, FundRecommendation } from '@shared/portal/types/funds';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { FundTile, FundRow } from './FundCards';

const TILE_WIDTH = 168;

export interface Collection {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Which funds belong — evaluated against the live catalog. */
  match: (f: CatalogFund) => boolean;
}

/**
 * Category names in AMFI data are inconsistent ("Equity Scheme - Large Cap
 * Fund", "Large Cap Fund"), so these match on a substring rather than equality.
 */
export const COLLECTIONS: Collection[] = [
  {
    key: 'high-return',
    label: 'High return',
    icon: ArrowUpRight,
    match: (f) => (f.returns['3Y'] ?? 0) >= 20,
  },
  { key: 'large-cap', label: 'Large cap', icon: Building2, match: (f) => /large\s*cap/i.test(f.subCategory) },
  { key: 'mid-cap', label: 'Mid cap', icon: BarChart3, match: (f) => /mid\s*cap/i.test(f.subCategory) },
  { key: 'small-cap', label: 'Small cap', icon: TrendingUp, match: (f) => /small\s*cap/i.test(f.subCategory) },
  {
    key: 'gold-silver',
    label: 'Gold & silver',
    icon: Coins,
    match: (f) => /gold|silver/i.test(`${f.name} ${f.subCategory}`),
  },
  { key: 'elss', label: 'Tax saver', icon: Landmark, match: (f) => /elss|tax\s*saver/i.test(`${f.name} ${f.subCategory}`) },
];

export function ExploreTab({
  funds,
  recommendations,
  onOpenAll,
  onOpenCollection,
}: {
  funds: CatalogFund[];
  recommendations: FundRecommendation[];
  onOpenAll: () => void;
  onOpenCollection: (c: Collection) => void;
}) {
  const p = usePalette();

  const popular = useMemo(
    () =>
      [...funds]
        .filter((f) => f.returns['3Y'] != null)
        .sort((a, b) => (b.returns['3Y'] ?? 0) - (a.returns['3Y'] ?? 0))
        .slice(0, 6),
    [funds],
  );

  const picks = useMemo(() => {
    const byCode = new Map(funds.map((f) => [f.amfiCode, f]));
    return recommendations
      .map((r) => byCode.get(r.amfiCode))
      .filter((f): f is CatalogFund => !!f)
      .slice(0, 6);
  }, [funds, recommendations]);

  return (
    <View style={{ gap: space[7], paddingBottom: space[6] }}>
      {/* ------------------------------ SIP promo ------------------------- */}
      <Card padding={5} style={{ marginTop: space[5], borderColor: p.accent.tint(0.35) }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[4] }}>
          <View style={{ flex: 1 }}>
            <Text variant="h3">Invest every month, and let it compound</Text>
            <Text variant="small" tone="muted" style={{ marginTop: space[2] }}>
              A SIP puts a fixed amount in on the same day each month — from ₹500.
            </Text>
            <View style={{ marginTop: space[4], alignSelf: 'flex-start' }}>
              <Button label="Start a SIP" size="sm" icon={CalendarClock} onPress={onOpenAll} />
            </View>
          </View>
          <View
            style={{
              width: 56,
              height: 56,
              borderRadius: radius.lg,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: p.accent.tint(0.14),
            }}
          >
            <CalendarClock size={26} color={p.accent.DEFAULT} strokeWidth={1.8} />
          </View>
        </View>
      </Card>

      {/* --------------------------- Niyom's picks ------------------------ */}
      {picks.length > 0 ? (
        <Shelf
          title="Recommended by Niyom"
          icon={Sparkles}
          onSeeAll={onOpenAll}
          funds={picks}
        />
      ) : null}

      {/* ---------------------------- Top by 3Y --------------------------- */}
      {popular.length > 0 ? (
        <Shelf title="Popular funds" onSeeAll={onOpenAll} funds={popular} />
      ) : null}

      {/* ---------------------------- Collections ------------------------- */}
      <View>
        <Text variant="h2" style={{ paddingHorizontal: space[5], marginBottom: space[4] }}>
          Collections
        </Text>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            paddingHorizontal: space[5],
            rowGap: space[6],
          }}
        >
          {COLLECTIONS.map((c) => {
            const Icon = c.icon;
            const count = funds.filter(c.match).length;
            return (
              <Pressable
                key={c.key}
                onPress={() => onOpenCollection(c)}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  width: '33.33%',
                  alignItems: 'center',
                  gap: space[2],
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <View
                  style={{
                    width: 54,
                    height: 54,
                    borderRadius: radius.lg,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: p.bg.surface,
                    borderWidth: 1,
                    borderColor: p.border.subtle,
                  }}
                >
                  <Icon size={23} color={p.accent.DEFAULT} strokeWidth={1.8} />
                </View>
                <Text variant="caption" tone="secondary" center numberOfLines={2}>
                  {c.label}
                </Text>
                <Text variant="caption" tone="faint">
                  {count}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* -------------------------- Products & tools ---------------------- */}
      <View>
        <Text variant="h2" style={{ paddingHorizontal: space[5], marginBottom: space[4] }}>
          Products & tools
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: space[5], gap: space[3] }}
        >
          <Tool icon={Upload} label={'Import\nportfolio'} onPress={() => router.push('/import-portfolio')} />
          <Tool icon={ListFilter} label={'All\nfunds'} onPress={onOpenAll} />
          <Tool icon={Gem} label={'Capital\ngains'} onPress={() => router.push('/capital-gains')} />
          <Tool icon={CalendarClock} label={'My\nSIPs'} onPress={() => router.push('/(client)/sip')} />
        </ScrollView>
      </View>
    </View>
  );
}

function Shelf({
  title,
  icon: Icon,
  funds,
  onSeeAll,
}: {
  title: string;
  icon?: LucideIcon;
  funds: CatalogFund[];
  onSeeAll: () => void;
}) {
  const p = usePalette();
  return (
    <View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[2],
          paddingHorizontal: space[5],
          marginBottom: space[4],
        }}
      >
        {Icon ? <Icon size={16} color={p.accent.DEFAULT} /> : null}
        <Text variant="h2" style={{ flex: 1 }}>
          {title}
        </Text>
        <Pressable onPress={onSeeAll} hitSlop={8}>
          <Text variant="smallMedium" tone="accent">
            View all
          </Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space[5], gap: space[3] }}
      >
        {funds.map((f) => (
          <FundTile key={f.amfiCode} fund={f} width={TILE_WIDTH} />
        ))}
      </ScrollView>
    </View>
  );
}

function Tool({
  icon: Icon,
  label,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label.replace('\n', ' ')}
      style={({ pressed }) => ({ alignItems: 'center', width: 84, gap: space[2], opacity: pressed ? 0.6 : 1 })}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: radius.lg,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: p.bg.surface,
          borderWidth: 1,
          borderColor: p.border.subtle,
        }}
      >
        <Icon size={22} color={p.accent.DEFAULT} strokeWidth={1.8} />
      </View>
      <Text variant="caption" tone="secondary" center>
        {label}
      </Text>
    </Pressable>
  );
}
