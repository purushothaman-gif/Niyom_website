/**
 * Market Watch — indices, gold and silver, the rupee, and 1-day fund movers.
 *
 * One screen for the client and the partner app; each route passes its own
 * database handle. Every figure carries its own "as of" stamp, because the
 * three sources run on different clocks: intraday index quotes, a daily metals
 * price and a daily AMFI NAV. Showing one page-level time would make a
 * yesterday's gold price look as fresh as a two-minute-old Nifty.
 *
 * Phone deviation from the website: the cards sit two across (the website goes
 * up to five), and pull-to-refresh replaces the Refresh button.
 */
import { useState, type ReactNode } from 'react';
import { View } from 'react-native';
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Coins,
  Star,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react-native';
import {
  fmtAsOfDate,
  fmtAsOfTime,
  fmtLevel,
  fmtSigned,
  fmtSignedPct,
  toneOfChange,
  type CommodityQuote,
  type FundMove,
  type MarketQuote,
  type Tone,
} from '@shared/market/marketWatch';
import { font, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { ErrorState, Segmented, SkeletonScreen } from '@/ui/kit';
import { useMarketWatch } from './useMarketWatch';

type Db = Parameters<typeof useMarketWatch>[0];

function useToneColor() {
  const p = usePalette();
  return (tone: Tone) =>
    tone === 'up' ? p.state.successSoft : tone === 'down' ? p.state.dangerSoft : p.text.secondary;
}

function Change({ change, pct, dp = 2 }: { change: number | null; pct: number | null; dp?: number }) {
  const color = useToneColor();
  const tone = toneOfChange(pct ?? change);
  const Icon = tone === 'down' ? ArrowDownRight : ArrowUpRight;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
      {tone !== 'flat' ? <Icon size={14} color={color(tone)} /> : null}
      <Text variant="caption" style={{ color: color(tone), fontFamily: font.bodySemi }}>
        {change !== null ? `${fmtSigned(change, dp)} ` : ''}({fmtSignedPct(pct)})
      </Text>
    </View>
  );
}

function Tile({
  label,
  unit,
  value,
  children,
  asOf,
}: {
  label: string;
  unit?: string;
  value: string;
  children: ReactNode;
  asOf: string;
}) {
  return (
    <Card padding={4} style={{ width: '48.4%' }}>
      <Text variant="overline" tone="secondary" caps numberOfLines={1}>
        {label}
        {unit ? ` / ${unit}` : ''}
      </Text>
      <Text
        numberOfLines={1}
        adjustsFontSizeToFit
        style={{ fontFamily: font.displayBold, fontSize: 19, marginTop: space[2] }}
      >
        {value}
      </Text>
      {children}
      <Text variant="caption" tone="faint" numberOfLines={1} style={{ marginTop: space[2] }}>
        As of {asOf}
      </Text>
    </Card>
  );
}

function QuoteTile({ q }: { q: MarketQuote }) {
  const currency = q.kind === 'currency';
  const dp = currency ? 3 : 2;
  return (
    <Tile
      label={q.label}
      value={`${currency && q.price !== null ? '₹' : ''}${fmtLevel(q.price, dp)}`}
      asOf={fmtAsOfTime(q.asOf)}
    >
      {q.price === null ? (
        <Text variant="caption" tone="muted" style={{ marginTop: 4 }}>
          Not available yet
        </Text>
      ) : (
        <Change change={q.change} pct={q.changePct} dp={dp} />
      )}
    </Tile>
  );
}

function CommodityTile({ c }: { c: CommodityQuote }) {
  return (
    <Tile label={c.label} unit={c.unit} value={`₹${fmtLevel(c.price, 0)}`} asOf={fmtAsOfDate(c.asOfDate)}>
      <Change change={c.change} pct={c.changePct} dp={0} />
    </Tile>
  );
}

function Grid({ children }: { children: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: space[3] }}>
      {children}
    </View>
  );
}

function Section({
  title,
  icon: Icon,
  note,
  children,
}: {
  title: string;
  icon: LucideIcon;
  note?: string;
  children: ReactNode;
}) {
  const p = usePalette();
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
        <Icon size={18} color={p.accent.DEFAULT} />
        <Text variant="h2">{title}</Text>
      </View>
      {note ? (
        <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
          {note}
        </Text>
      ) : null}
      <View style={{ marginTop: space[3] }}>{children}</View>
    </View>
  );
}

function FundRows({ funds }: { funds: FundMove[] }) {
  const p = usePalette();
  const color = useToneColor();
  return (
    <View>
      {funds.map((f, i) => (
        <View
          key={f.schemeCode}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[3],
            paddingVertical: space[3],
            borderTopWidth: i === 0 ? 0 : 1,
            borderTopColor: p.border.subtle,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text variant="smallMedium" numberOfLines={2}>
              {f.name}
            </Text>
            <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 2 }}>
              {f.fundHouse ?? '—'} · NAV as of {fmtAsOfDate(f.navDate)}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="smallMedium">₹{fmtLevel(f.nav, 2)}</Text>
            <Text
              variant="caption"
              style={{ color: color(toneOfChange(f.changePct)), fontFamily: font.bodySemi, marginTop: 2 }}
            >
              {fmtSignedPct(f.changePct)}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export interface MarketWatchScreenProps {
  /** The viewer's own database handle; resolved when a read runs, not at import. */
  getDb: Db;
  /** AMFI scheme codes on the viewer's watchlist; omit where there is none. */
  watchlistFundCodes?: string[];
  onError?: (message: string) => void;
}

export function MarketWatchScreen({ getDb, watchlistFundCodes, onError }: MarketWatchScreenProps) {
  const { snapshot, watched, loading, error, checkedAt, reload } = useMarketWatch(
    getDb,
    watchlistFundCodes,
    onError,
  );
  const [tab, setTab] = useState<'gainers' | 'losers'>('gainers');

  const indices = snapshot?.quotes.filter((q) => q.kind === 'index') ?? [];
  const currencies = snapshot?.quotes.filter((q) => q.kind === 'currency') ?? [];
  const movers = tab === 'gainers' ? (snapshot?.gainers ?? []) : (snapshot?.losers ?? []);
  const moversDate = (snapshot?.gainers[0] ?? snapshot?.losers[0])?.navDate;

  return (
    <Screen onRefresh={reload} refreshing={loading && !!snapshot}>
      <ScreenHeader
        title="Market Watch"
        subtitle="Indices, gold, the rupee and today's fund movers."
        showBack
      />

      {!snapshot && error ? <ErrorState message={error} onRetry={reload} /> : null}
      {!snapshot && !error ? <SkeletonScreen rows={4} /> : null}

      {snapshot ? (
        <View style={{ gap: space[7] }}>
          {error ? (
            <Text variant="small" tone="danger">
              Could not refresh just now. Showing the last figures loaded.
            </Text>
          ) : null}

          <Section title="Indices" icon={Activity} note="Indicative · refreshes every minute">
            <Grid>
              {indices.map((q) => (
                <QuoteTile key={q.symbol} q={q} />
              ))}
            </Grid>
          </Section>

          <Section title="Commodities & currency" icon={Coins} note="Gold & silver: India retail, daily">
            <Grid>
              {snapshot.commodities.map((c) => (
                <CommodityTile key={c.commodity} c={c} />
              ))}
              {currencies.map((q) => (
                <QuoteTile key={q.symbol} q={q} />
              ))}
            </Grid>
          </Section>

          {watchlistFundCodes && watchlistFundCodes.length > 0 ? (
            <Section title="Your watchlist funds" icon={Star} note="1-day NAV change">
              <Card padding={4}>
                {watched.length ? (
                  <FundRows funds={watched} />
                ) : (
                  <Text variant="small" tone="muted">
                    No fresh NAV change for your saved funds yet.
                  </Text>
                )}
              </Card>
            </Section>
          ) : null}

          <Section
            title="Mutual fund movers"
            icon={TrendingUp}
            note={
              moversDate
                ? `Regular plans · 1-day NAV change to ${fmtAsOfDate(moversDate)}`
                : 'Regular plans'
            }
          >
            <Card padding={4}>
              <Segmented
                options={[
                  { value: 'gainers', label: 'Top gainers' },
                  { value: 'losers', label: 'Top losers' },
                ]}
                value={tab}
                onChange={setTab}
                style={{ marginBottom: space[2] }}
              />
              {movers.length ? (
                <FundRows funds={movers} />
              ) : (
                <Text variant="small" tone="muted" style={{ paddingVertical: space[2] }}>
                  No fund NAVs published for the latest day yet.
                </Text>
              )}
            </Card>
          </Section>

          <View style={{ gap: space[2] }}>
            {checkedAt ? (
              <Text variant="caption" tone="faint">
                Checked {fmtAsOfTime(checkedAt)}
              </Text>
            ) : null}
            <Text variant="caption" tone="faint">
              Index and currency levels are indicative, taken from a public market-data feed and may
              lag the exchange. Gold and silver are indicative Indian retail rates (incl. duty and
              GST). Fund NAVs are as published by AMFI. For information only — not investment advice.
              Past performance is not indicative of future returns.
            </Text>
          </View>
        </View>
      ) : null}
    </Screen>
  );
}
