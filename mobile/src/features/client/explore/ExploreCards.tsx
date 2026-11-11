/**
 * Explore's tiles and rails. Presentation only: what earns a place on a rail is
 * decided in `shared/market/explorePicks.ts`.
 */
import type { ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { fmtFull } from '@shared/crm/utils';
import { bondYield } from '@shared/market/explorePicks';
import { ratingGrade } from '@shared/portal/bonds/bondFilters';
import type { ClientBond } from '@shared/portal/services/BondOrderService';
import type { ClientShare } from '@shared/portal/services/ShareOrderService';
import { font, radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Skeleton } from '@/ui/kit';

export const TILE_WIDTH = 168;

/** A titled section with an optional "see more" link under it. */
export function Rail({
  title,
  icon: Icon,
  more,
  onMore,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  more?: string;
  onMore?: () => void;
  children: ReactNode;
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
        {Icon ? <Icon size={18} color={p.accent.DEFAULT} /> : null}
        <Text variant="h2" style={{ flex: 1 }}>
          {title}
        </Text>
        {more && onMore ? (
          <Pressable
            onPress={onMore}
            hitSlop={8}
            accessibilityRole="button"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}
          >
            <Text variant="smallMedium" tone="accent">
              {more}
            </Text>
            <ChevronRight size={15} color={p.accent.DEFAULT} />
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** A sideways-scrolling row of tiles that bleeds to the screen edge. */
export function TileRow({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: space[5], gap: space[3] }}
    >
      {children}
    </ScrollView>
  );
}

export function RailSkeleton() {
  return (
    <View style={{ flexDirection: 'row', gap: space[3], paddingHorizontal: space[5] }}>
      <Skeleton width={TILE_WIDTH} height={150} rounded="lg" />
      <Skeleton width={TILE_WIDTH} height={150} rounded="lg" />
    </View>
  );
}

export function EmptyRail({ text }: { text: string }) {
  const p = usePalette();
  return (
    <View
      style={{
        marginHorizontal: space[5],
        paddingVertical: space[6],
        paddingHorizontal: space[5],
        borderRadius: radius.lg,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: p.border.DEFAULT,
      }}
    >
      <Text variant="small" tone="secondary" center>
        {text}
      </Text>
    </View>
  );
}

/** Two-letter mark from a name, for issuers and companies with no logo here. */
function Monogram({ name }: { name: string }) {
  const p = usePalette();
  const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').trim().split(/\s+/).filter(Boolean);
  const letters = ((words[0]?.[0] ?? '?') + (words[1]?.[0] ?? words[0]?.[1] ?? '')).toUpperCase();
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: radius.sm + 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: p.accent.tint(0.14),
      }}
    >
      <Text style={{ fontFamily: font.displayBold, fontSize: 14, color: p.accent.DEFAULT }}>
        {letters}
      </Text>
    </View>
  );
}

function maturityYear(ymd: string | null): string | null {
  const y = ymd ? Number(ymd.slice(0, 4)) : NaN;
  return Number.isFinite(y) && y > 1900 ? String(y) : null;
}

export function BondTile({ bond, onPress }: { bond: ClientBond; onPress: () => void }) {
  const p = usePalette();
  const name = bond.issuer_name?.trim() || bond.bond_name || bond.isin;
  const y = bondYield(bond);
  const grade = ratingGrade(bond.rating);
  const matures = maturityYear(bond.maturity_date);
  return (
    <Card weight="surface" padding={4} onPress={onPress} style={{ width: TILE_WIDTH }}>
      <Monogram name={name} />
      <Text variant="smallMedium" numberOfLines={2} style={{ marginTop: space[3], minHeight: 36 }}>
        {name}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space[2], marginTop: space[3] }}>
        <Text style={{ fontFamily: font.displayBold, fontSize: 19, color: p.state.successSoft }}>
          {y == null ? '—' : `${y.toFixed(2)}%`}
        </Text>
        <Text variant="caption" tone="faint">
          {bond.analytics?.ytm != null ? 'yield' : 'coupon'}
        </Text>
      </View>
      <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
        {[grade, matures ? `matures ${matures}` : null].filter(Boolean).join(' · ') || ' '}
      </Text>
    </Card>
  );
}

export function ShareTile({ share, onPress }: { share: ClientShare; onPress: () => void }) {
  const name = share.short_name?.trim() || share.company_name;
  return (
    <Card weight="surface" padding={4} onPress={onPress} style={{ width: TILE_WIDTH }}>
      <Monogram name={name} />
      <Text variant="smallMedium" numberOfLines={2} style={{ marginTop: space[3], minHeight: 36 }}>
        {name}
      </Text>
      <Text style={{ fontFamily: font.displayBold, fontSize: 19, marginTop: space[3] }}>
        {share.client_price != null ? fmtFull(Number(share.client_price)) : '—'}
      </Text>
      <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
        {share.sector ? `per share · ${share.sector}` : 'per share'}
      </Text>
    </Card>
  );
}
