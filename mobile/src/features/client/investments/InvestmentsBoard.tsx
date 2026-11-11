/**
 * The investments board — the multi-asset portfolio view the website shows in
 * the client and partner portals, laid out for a phone.
 *
 * Summary (current / invested / 1D / total returns / XIRR), asset tabs, a
 * sortable list of holdings whose second line adapts to the asset, the
 * allocation ring, and the selected holding's detail.
 *
 * Pure presentation over `InvestmentRow` — the arithmetic is `summarise` in
 * `shared/portal/investments/model.ts`, the same function the website calls,
 * so the totals agree by construction.
 *
 * ## Unknown is not zero
 *
 * A registrar-fed mutual fund has a value and units but no purchase cost. Its
 * `invested`, `gain` and `gainPct` are null, and every place they would print
 * shows an em dash and says why. Nothing here substitutes 0.
 *
 * ## Phone deviations from the web design, deliberate
 *
 * The table's sortable column headers become one row of sort chips, and the
 * side detail pane becomes an expansion under the tapped card: a sheet over a
 * scrolling list loses the client's place, an expansion does not.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { ChevronDown, ChevronUp, Eye, EyeOff, Info, Wallet } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { fmt } from '@shared/crm/utils';
import {
  ASSET_META,
  summarise,
  type AssetKey,
  type InvestmentRow,
  type InvestmentSummary,
} from '@shared/portal/investments/model';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { DonutChart } from '@/ui/DonutChart';
import { EmptyState } from '@/ui/kit';
import { inr, price, shortDay, signOf, signedInr, signedPct, units } from './format';

type Tab = 'all' | AssetKey;
type SortKey = 'value' | 'returns' | 'day' | 'name';

const SORTS: { key: SortKey; label: string }[] = [
  { key: 'value', label: 'Value' },
  { key: 'returns', label: 'Returns' },
  { key: 'day', label: '1D change' },
  { key: 'name', label: 'Name' },
];

export interface InvestmentsBoardProps {
  rows: InvestmentRow[];
  /** Mutual-fund enrichment still in flight. */
  enriching?: boolean;
  title?: string;
  /** Portfolio XIRR across ALL holdings; shown on the All tab only. */
  xirrPercent?: number | null;
  /** Share of the portfolio the XIRR covers (0–100). */
  xirrCoveragePct?: number | null;
  /** 'under_1y': XIRR not annualised yet. */
  xirrNote?: 'under_1y' | null;
  /** Hides the allocation ring — for drill-downs where it is noise. */
  compact?: boolean;
  /** Narrows the list by name / folio / ISIN; the summary stays whole. */
  query?: string;
  /** Extra action under a holding's detail. */
  detailAction?: (row: InvestmentRow) => ReactNode;
  emptyState?: ReactNode;
}

export function InvestmentsBoard({
  rows,
  enriching = false,
  title = 'Holdings',
  xirrPercent,
  xirrCoveragePct = null,
  xirrNote = null,
  compact = false,
  query = '',
  detailAction,
  emptyState,
}: InvestmentsBoardProps) {
  const p = usePalette();
  const [tab, setTab] = useState<Tab>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'value', dir: 'desc' });
  const [openId, setOpenId] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);

  const allSummary = useMemo(() => summarise(rows), [rows]);
  // A tab can empty out when the rows change under it (a scope switch).
  const activeTab: Tab = tab !== 'all' && !allSummary.slices.some((s) => s.asset === tab) ? 'all' : tab;
  const tabRows = useMemo(
    () => (activeTab === 'all' ? rows : rows.filter((r) => r.asset === activeTab)),
    [rows, activeTab],
  );
  const summary = useMemo(
    () => (activeTab === 'all' ? allSummary : summarise(tabRows)),
    [activeTab, allSummary, tabRows],
  );

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? tabRows.filter((r) =>
          [r.name, r.sub, r.amc, r.folio, r.isin, r.category]
            .filter(Boolean)
            .some((s) => String(s).toLowerCase().includes(needle)),
        )
      : [...tabRows];
    const val = (r: InvestmentRow): number | string =>
      sort.key === 'name'
        ? r.name.toLowerCase()
        : sort.key === 'returns'
          ? (r.gainPct ?? -Infinity)
          : sort.key === 'day'
            ? (r.dayChangePct ?? -Infinity)
            : r.value;
    list.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      const cmp = typeof va === 'string' ? va.localeCompare(String(vb)) : va - (vb as number);
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [tabRows, query, sort]);

  const mask = (s: string) => (hidden ? '₹ • • • •' : s);

  if (!rows.length) {
    return (
      <>
        {emptyState ?? (
          <EmptyState
            icon={Wallet}
            title="No investments yet"
            message="Holdings appear here as soon as they settle."
          />
        )}
      </>
    );
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: rows.length },
    ...allSummary.slices.map((s) => ({ key: s.asset as Tab, label: s.label, count: s.count })),
  ];

  const onSort = (key: SortKey) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    );

  return (
    <View style={{ gap: space[4] }}>
      {/* ------------------------------ heading --------------------------- */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
        <View style={{ flex: 1 }}>
          <Text variant="h3">
            {title} <Text variant="h3" tone="faint">({summary.count})</Text>
          </Text>
          {enriching ? (
            <Text variant="caption" tone="faint" style={{ marginTop: 2 }}>
              Updating prices…
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => setHidden((h) => !h)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={hidden ? 'Show amounts' : 'Hide amounts'}
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: p.border.DEFAULT,
            backgroundColor: p.bg.surface,
          }}
        >
          {hidden ? <EyeOff size={16} color={p.text.secondary} /> : <Eye size={16} color={p.text.secondary} />}
        </Pressable>
      </View>

      <SummaryCard
        summary={summary}
        xirr={activeTab === 'all' ? xirrPercent : undefined}
        xirrCoverage={xirrCoveragePct}
        xirrNote={xirrNote}
        mask={mask}
      />

      {/* ------------------------------ asset tabs ------------------------ */}
      {tabs.length > 2 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2] }}>
          {tabs.map((t) => (
            <Chip
              key={t.key}
              label={`${t.label} ${t.count}`}
              active={t.key === activeTab}
              onPress={() => {
                setTab(t.key);
                setOpenId(null);
              }}
            />
          ))}
        </ScrollView>
      ) : null}

      {/* ------------------------------ sort ------------------------------ */}
      {tabRows.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space[2], alignItems: 'center' }}>
          <Text variant="caption" tone="muted">
            Sort
          </Text>
          {SORTS.map((s) => {
            const on = sort.key === s.key;
            return (
              <Chip
                key={s.key}
                small
                label={s.label}
                active={on}
                icon={on ? (sort.dir === 'desc' ? ChevronDown : ChevronUp) : undefined}
                onPress={() => onSort(s.key)}
              />
            );
          })}
        </ScrollView>
      ) : null}

      {/* ------------------------------ holdings -------------------------- */}
      {visible.length === 0 ? (
        <Card padding={5}>
          <Text variant="smallMedium" center>
            No matches
          </Text>
          <Text variant="caption" tone="muted" center style={{ marginTop: 4 }}>
            Nothing here matches that search.
          </Text>
        </Card>
      ) : (
        visible.map((r, i) => (
          <HoldingRowCard
            key={r.id}
            row={r}
            index={i}
            total={summary.current}
            showAsset={activeTab === 'all'}
            hidden={hidden}
            open={openId === r.id}
            onToggle={() => setOpenId(openId === r.id ? null : r.id)}
            action={detailAction?.(r)}
          />
        ))
      )}

      <Text variant="caption" tone="faint">
        Showing {visible.length} of {tabRows.length}
      </Text>

      {summary.unknownCostCount > 0 ? (
        <View
          style={{
            flexDirection: 'row',
            gap: space[2],
            padding: space[3],
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: p.border.subtle,
            backgroundColor: p.bg.surface,
          }}
        >
          <Info size={14} color={p.text.faint} style={{ marginTop: 2 }} />
          <Text variant="caption" tone="secondary" style={{ flex: 1 }}>
            {summary.unknownCostCount} registrar-fed fund{summary.unknownCostCount > 1 ? 's' : ''} show value and
            daily movement but not returns — the registrar reports holdings without purchase cost.
            {summary.costCoveragePct > 0
              ? ` Invested and returns above cover ${summary.costCoveragePct.toFixed(0)}% of the portfolio by value.`
              : ''}
          </Text>
        </View>
      ) : null}

      {!compact && allSummary.slices.length > 0 ? <AllocationCard summary={allSummary} hidden={hidden} /> : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*  Summary                                                                   */
/* -------------------------------------------------------------------------- */

export function SummaryCard({
  summary,
  xirr,
  xirrCoverage = null,
  xirrNote = null,
  mask = (s) => s,
  label = 'Current value',
  onPress,
}: {
  summary: InvestmentSummary;
  /** `undefined` swaps the XIRR cell for a holdings count. */
  xirr?: number | null;
  xirrCoverage?: number | null;
  xirrNote?: 'under_1y' | null;
  mask?: (s: string) => string;
  label?: string;
  onPress?: () => void;
}) {
  const p = usePalette();
  const returnsKnown = summary.returnsPct != null;
  const showXirr = xirr !== undefined;

  return (
    <Animated.View entering={FadeInDown.duration(400)}>
      <Card padding={5} onPress={onPress}>
        <Text variant="overline" tone="muted" caps>
          {label}
        </Text>
        <Text variant="money" style={{ marginTop: space[2] }} numberOfLines={1} adjustsFontSizeToFit>
          {mask(inr(summary.current))}
        </Text>

        <View
          style={{
            marginTop: space[4],
            paddingTop: space[4],
            borderTopWidth: 1,
            borderTopColor: p.border.subtle,
            gap: space[4],
          }}
        >
          <View style={{ flexDirection: 'row', gap: space[4] }}>
            <Stat label="Invested value" value={returnsKnown ? mask(inr(summary.invested)) : '—'} />
            <Stat
              label="1D returns"
              value={summary.dayChange == null ? '—' : mask(signedInr(summary.dayChange))}
              sub={summary.dayChange == null ? undefined : signedPct(summary.dayChangePct)}
              tone={summary.dayChange}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: space[4] }}>
            <Stat
              label="Total returns"
              value={returnsKnown ? mask(signedInr(summary.returns)) : '—'}
              sub={returnsKnown ? signedPct(summary.returnsPct) : 'Awaiting cost data'}
              tone={returnsKnown ? summary.returns : null}
            />
            {showXirr ? (
              <Stat
                label="XIRR"
                value={xirr == null ? '—' : signedPct(xirr)}
                tone={xirr}
                sub={
                  xirr == null
                    ? xirrNote === 'under_1y'
                      ? 'Shown after 1 year'
                      : 'Needs more history'
                    : xirrCoverage != null && xirrCoverage < 99.5
                      ? `Covers ${Math.round(xirrCoverage)}% of value`
                      : 'Annualised'
                }
                subNeutral
              />
            ) : (
              <Stat
                label="Holdings"
                value={String(summary.count)}
                sub={summary.slices.length > 1 ? `${summary.slices.length} asset classes` : undefined}
              />
            )}
          </View>
        </View>
      </Card>
    </Animated.View>
  );
}

function useTone() {
  const p = usePalette();
  return (v: number | null | undefined, fallback: string = p.text.primary): string => {
    const s = signOf(v);
    return s > 0 ? p.state.successSoft : s < 0 ? p.state.dangerSoft : fallback;
  };
}

function Stat({
  label,
  value,
  sub,
  tone,
  subNeutral,
}: {
  label: string;
  value: string;
  sub?: string;
  /** A signed figure colours the value; `undefined`/null leaves it neutral. */
  tone?: number | null;
  subNeutral?: boolean;
}) {
  const p = usePalette();
  const toneOf = useTone();
  return (
    <View style={{ flex: 1 }}>
      <Text variant="caption" tone="muted" numberOfLines={1}>
        {label}
      </Text>
      <Text variant="moneySmall" numberOfLines={1} style={{ marginTop: 3, color: toneOf(tone) }}>
        {value}
      </Text>
      {sub ? (
        <Text
          variant="caption"
          numberOfLines={1}
          style={{ marginTop: 1, color: subNeutral || tone == null ? p.text.faint : toneOf(tone, p.text.faint) }}
        >
          {sub}
        </Text>
      ) : null}
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*  Chips                                                                     */
/* -------------------------------------------------------------------------- */

function Chip({
  label,
  active,
  onPress,
  small,
  icon: Icon,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  small?: boolean;
  icon?: typeof ChevronDown;
}) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
        paddingHorizontal: small ? space[3] : space[4],
        paddingVertical: small ? 6 : 8,
        borderRadius: radius.full,
        borderWidth: 1,
        borderColor: active ? p.accent.DEFAULT : p.border.DEFAULT,
        backgroundColor: active ? `${p.accent.DEFAULT}1F` : p.bg.surface,
      }}
    >
      <Text variant={small ? 'caption' : 'smallMedium'} style={{ color: active ? p.accent.DEFAULT : p.text.secondary }}>
        {label}
      </Text>
      {Icon ? <Icon size={12} color={p.accent.DEFAULT} /> : null}
    </Pressable>
  );
}

export function AssetChip({ asset }: { asset: AssetKey }) {
  const m = ASSET_META[asset];
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, backgroundColor: `${m.color}1F` }}>
      <Text variant="caption" style={{ color: m.color, fontSize: 10, letterSpacing: 0.4 }}>
        {m.short.toUpperCase()}
      </Text>
    </View>
  );
}

function Tag({ label }: { label: string }) {
  const p = usePalette();
  return (
    <View
      style={{
        paddingHorizontal: 6,
        paddingVertical: 1,
        borderRadius: 4,
        borderWidth: 1,
        borderColor: p.border.DEFAULT,
      }}
    >
      <Text variant="caption" tone="secondary" style={{ fontSize: 10 }}>
        {label}
      </Text>
    </View>
  );
}

/* -------------------------------------------------------------------------- */
/*  One holding                                                               */
/* -------------------------------------------------------------------------- */

function secondaryLine(r: InvestmentRow): string {
  if (r.asset === 'bond' && r.coupon != null) {
    return `${r.coupon}%${r.maturity ? ` · matures ${shortDay(r.maturity)}` : ''}`;
  }
  if (r.asset === 'mutual_fund' && r.fundReturn3y != null) return `Fund 3Y ${signedPct(r.fundReturn3y, 1)}`;
  if (r.units != null) return `${units(r.units)} units`;
  return '';
}

function HoldingRowCard({
  row: r,
  index,
  total,
  showAsset,
  hidden,
  open,
  onToggle,
  action,
}: {
  row: InvestmentRow;
  index: number;
  total: number;
  showAsset: boolean;
  hidden: boolean;
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
}) {
  const p = usePalette();
  const toneOf = useTone();
  const weight = total > 0 ? (r.value / total) * 100 : 0;
  const line = [r.sub, secondaryLine(r)].filter(Boolean).join(' · ');
  const veil = hidden ? { opacity: 0 } : null;

  return (
    <Animated.View entering={FadeInDown.duration(340).delay(Math.min(index, 10) * 35)}>
      <Card padding={0} style={{ overflow: 'hidden', borderColor: open ? p.accent.DEFAULT : undefined }}>
        <Pressable onPress={onToggle} accessibilityRole="button" accessibilityState={{ expanded: open }}>
          <View style={{ flexDirection: 'row' }}>
            <View style={{ width: 3, backgroundColor: ASSET_META[r.asset].color }} />
            <View style={{ flex: 1, padding: space[4] }}>
              <View style={{ flexDirection: 'row', gap: space[3] }}>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyMedium" numberOfLines={2}>
                    {r.name}
                  </Text>
                  <View
                    style={{
                      flexDirection: 'row',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 6,
                      marginTop: 4,
                    }}
                  >
                    {showAsset ? <AssetChip asset={r.asset} /> : null}
                    {r.distributor === 'other' ? <Tag label="Other ARN" /> : null}
                    {r.source === 'registrar' ? <Tag label="Registrar" /> : null}
                  </View>
                  {line ? (
                    <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 4 }}>
                      {line}
                    </Text>
                  ) : null}
                </View>
                <View style={[{ alignItems: 'flex-end' }, veil]}>
                  <Text variant="moneySmall">{inr(r.value)}</Text>
                  <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                    {r.invested == null ? 'Cost unknown' : inr(r.invested)}
                  </Text>
                </View>
              </View>

              <View
                style={[
                  {
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    gap: space[3],
                    marginTop: space[3],
                    paddingTop: space[3],
                    borderTopWidth: 1,
                    borderTopColor: p.border.subtle,
                  },
                  veil,
                ]}
              >
                <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  1D{' '}
                  <Text variant="caption" style={{ color: toneOf(r.dayChange, p.text.secondary) }}>
                    {r.dayChange == null ? '—' : `${signedInr(r.dayChange)} (${signedPct(r.dayChangePct)})`}
                  </Text>
                </Text>
                <Text variant="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                  Returns{' '}
                  <Text variant="caption" style={{ color: toneOf(r.gain, p.text.secondary) }}>
                    {r.gain == null ? '—' : `${signedInr(r.gain)} (${signedPct(r.gainPct)})`}
                  </Text>
                </Text>
              </View>
            </View>
          </View>
        </Pressable>

        {open ? <HoldingDetail row={r} weight={weight} action={action} /> : null}
      </Card>
    </Animated.View>
  );
}

function HoldingDetail({ row, weight, action }: { row: InvestmentRow; weight: number; action?: ReactNode }) {
  const p = usePalette();
  const toneOf = useTone();
  const returnsUnknown = row.invested == null;
  const lines: [string, string, string?][] = [];
  const add = (label: string, value: string | null | undefined, color?: string) => {
    if (value != null && value !== '' && value !== '—') lines.push([label, value, color]);
  };

  add('Portfolio weight', `${weight.toFixed(1)}%`);
  if (row.asset === 'mutual_fund') {
    add('Units', units(row.units));
    add(row.navDate ? `NAV · ${shortDay(row.navDate)}` : 'NAV', price(row.price));
    if (row.avgPrice != null) add('Avg. NAV', price(row.avgPrice));
    if (row.fundReturn1y != null) add('Fund return · 1Y', signedPct(row.fundReturn1y, 1), toneOf(row.fundReturn1y));
    if (row.fundReturn3y != null)
      add('Fund return · 3Y (p.a.)', signedPct(row.fundReturn3y, 1), toneOf(row.fundReturn3y));
    add('Category', row.category);
    add('Folio', row.folio);
    add('AMC', row.amc);
  } else if (row.asset === 'bond') {
    if (row.coupon != null) add('Coupon', `${row.coupon}% p.a.`);
    add('Interest payout', row.payoutFrequency);
    if (row.nextPayout) add('Next payout', shortDay(row.nextPayout));
    if (row.maturity) add('Maturity', shortDay(row.maturity));
    add('Units', units(row.units));
    if (row.avgPrice != null) add('Avg. price', price(row.avgPrice));
    if (row.faceValue != null && row.faceValue > 0) add('Face value', price(row.faceValue));
    add('ISIN', row.isin);
  } else if (row.asset === 'unlisted_share' || row.asset === 'stock') {
    add('Quantity', units(row.units));
    if (row.avgPrice != null) add('Avg. buy price', price(row.avgPrice));
    add('Current price', price(row.price));
    add('ISIN', row.isin);
  } else {
    if (row.units != null) add('Units', units(row.units));
    add('Issuer', row.issuer);
    if (row.maturity) add('Maturity', shortDay(row.maturity));
  }

  return (
    <Animated.View
      entering={FadeIn.duration(220)}
      style={{
        paddingHorizontal: space[4],
        paddingBottom: space[4],
        borderTopWidth: 1,
        borderTopColor: p.border.subtle,
        backgroundColor: p.bg.surface,
      }}
    >
      <View style={{ flexDirection: 'row', gap: space[4], paddingTop: space[4] }}>
        <View style={{ flex: 1 }}>
          <Text variant="caption" tone="muted">
            Invested
          </Text>
          <Text variant="smallMedium" style={{ marginTop: 2 }}>
            {returnsUnknown ? '—' : inr(row.invested)}
          </Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="caption" tone="muted">
            Total returns
          </Text>
          <Text variant="smallMedium" style={{ marginTop: 2, color: toneOf(row.gain) }}>
            {returnsUnknown ? '—' : `${signedInr(row.gain)} (${signedPct(row.gainPct)})`}
          </Text>
        </View>
      </View>

      <View style={{ marginTop: space[3] }}>
        {lines.map(([label, value, color], i) => (
          <View
            key={label}
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              gap: space[3],
              paddingVertical: 7,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: p.border.subtle,
            }}
          >
            <Text variant="caption" tone="muted">
              {label}
            </Text>
            <Text variant="caption" style={{ flexShrink: 1, textAlign: 'right', color: color ?? p.text.primary }}>
              {value}
            </Text>
          </View>
        ))}
      </View>

      {returnsUnknown ? (
        <Text variant="caption" tone="secondary" style={{ marginTop: space[3] }}>
          Value and units come straight from the registrar (CAMS/KFintech), updated daily. The registrar does not
          report purchase cost, so returns will appear once your purchase history is on file.
        </Text>
      ) : null}

      {action ? <View style={{ marginTop: space[4] }}>{action}</View> : null}
    </Animated.View>
  );
}

/* -------------------------------------------------------------------------- */
/*  Allocation                                                                */
/* -------------------------------------------------------------------------- */

function AllocationCard({ summary, hidden }: { summary: InvestmentSummary; hidden: boolean }) {
  const p = usePalette();
  return (
    <Card padding={5}>
      <Text variant="h3">Asset allocation</Text>
      <View style={{ alignItems: 'center', marginTop: space[4] }}>
        <DonutChart
          size={160}
          thickness={20}
          slices={summary.slices.map((s) => ({ label: s.label, value: s.value, color: s.color }))}
          centerLabel="Total"
          centerValue={hidden ? '••••' : fmt(summary.current)}
        />
      </View>
      <View style={{ marginTop: space[5], gap: space[3] }}>
        {summary.slices.map((s) => (
          <View key={s.asset}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: s.color }} />
              <Text variant="small" style={{ flex: 1 }} numberOfLines={1}>
                {s.label}{' '}
                <Text variant="caption" tone="faint">
                  {s.count}
                </Text>
              </Text>
              <Text variant="smallMedium">{s.percent.toFixed(1)}%</Text>
            </View>
            <View
              style={{
                height: 6,
                borderRadius: radius.full,
                backgroundColor: p.bg.surface,
                overflow: 'hidden',
                marginTop: 6,
              }}
            >
              <View
                style={{
                  width: `${Math.min(100, s.percent)}%`,
                  height: '100%',
                  borderRadius: radius.full,
                  backgroundColor: s.color,
                }}
              />
            </View>
            <Text variant="caption" tone="muted" style={{ marginTop: 4, textAlign: 'right' }}>
              {hidden ? '••••' : inr(s.value)}
            </Text>
          </View>
        ))}
      </View>
    </Card>
  );
}
