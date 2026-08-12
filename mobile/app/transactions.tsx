/**
 * Transactions — every purchase, redemption, switch and payout.
 *
 * A FlatList, not a mapped ScrollView. A client who has imported a detailed CAS
 * can easily have a few thousand rows here, and rendering them all is the
 * difference between a list that scrolls and one that stutters.
 *
 * Rows are grouped by month with sticky headers, because the question people
 * bring to this screen is nearly always "what happened around then".
 */
import { useMemo, useState } from 'react';
import { SectionList, View } from 'react-native';
import { ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Search } from 'lucide-react-native';
import { fmtFull } from '@shared/crm/utils';
import { useTransactions } from '@shared/portal/hooks/useTransactions';
import type { TransactionRow, TxnTypeFilter } from '@shared/portal/types/activity';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Input } from '@/ui/Input';
import { EmptyState, ErrorState, Segmented, SkeletonScreen } from '@/ui/kit';

export default function Transactions() {
  const clientId = useClientId();
  const p = usePalette();
  const { rows, loading, error, refresh } = useTransactions(clientId);

  const [query, setQuery] = useState('');
  const [type, setType] = useState<TxnTypeFilter>('all');

  const sections = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = rows
      .filter((r) => (type === 'all' ? true : r.txnType === type))
      .filter((r) => !needle || r.name.toLowerCase().includes(needle));

    // Newest first, then bucketed by the month they fall in.
    const byMonth = new Map<string, TransactionRow[]>();
    for (const row of [...filtered].sort((a, b) => b.date.localeCompare(a.date))) {
      const key = monthLabel(row.date);
      const list = byMonth.get(key) ?? [];
      list.push(row);
      byMonth.set(key, list);
    }
    return [...byMonth.entries()].map(([title, data]) => ({ title, data }));
  }, [rows, query, type]);

  return (
    <Screen scroll={false}>
      <ScreenHeader
        title="Transactions"
        subtitle="Every purchase, redemption, switch and payout on your account."
        showBack
      />

      {loading && rows.length === 0 ? (
        <SkeletonScreen rows={5} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ArrowLeftRight}
          title="No transactions yet"
          message="Everything you buy, sell or switch through Niyom will be listed here."
        />
      ) : (
        <>
          <View style={{ gap: space[3], marginBottom: space[4] }}>
            <Input
              icon={Search}
              placeholder="Search a fund or bond"
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            <Segmented<TxnTypeFilter>
              value={type}
              onChange={setType}
              options={[
                { value: 'all', label: 'All' },
                { value: 'buy', label: 'Purchases' },
                { value: 'sell', label: 'Redemptions' },
              ]}
            />
          </View>

          {sections.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No matches"
              message="Nothing matches that search or filter."
            />
          ) : (
            <SectionList
              sections={sections}
              keyExtractor={(item) => item.id}
              stickySectionHeadersEnabled
              showsVerticalScrollIndicator={false}
              onRefresh={refresh}
              refreshing={loading}
              contentContainerStyle={{ paddingBottom: space[10] }}
              renderSectionHeader={({ section }) => (
                <View
                  style={{
                    // Opaque: sticky headers scroll OVER the rows beneath them.
                    backgroundColor: p.bg.base,
                    paddingVertical: space[2],
                  }}
                >
                  <Text variant="overline" tone="muted" caps>
                    {section.title}
                  </Text>
                </View>
              )}
              renderItem={({ item }) => <TxnRow row={item} />}
            />
          )}
        </>
      )}
    </Screen>
  );
}

function TxnRow({ row }: { row: TransactionRow }) {
  const p = usePalette();
  const isBuy = row.txnType === 'buy';
  const Icon = isBuy ? ArrowDownLeft : ArrowUpRight;
  const tone = isBuy ? p.state.successSoft : p.state.warningSoft;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingVertical: space[3] + 2,
        borderBottomWidth: 1,
        borderBottomColor: p.border.subtle,
      }}
    >
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: radius.full,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: `${tone}1F`,
        }}
      >
        <Icon size={16} color={tone} strokeWidth={2.3} />
      </View>

      <View style={{ flex: 1 }}>
        <Text variant="bodyMedium" numberOfLines={1}>
          {row.name}
        </Text>
        <Text variant="caption" tone="muted" numberOfLines={1} style={{ marginTop: 1 }}>
          {row.productLabel} · {formatDate(row.date)}
          {row.units != null
            ? ` · ${row.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units`
            : ''}
        </Text>
      </View>

      <View style={{ alignItems: 'flex-end' }}>
        <Text variant="moneySmall" style={{ color: isBuy ? p.text.primary : tone }}>
          {isBuy ? '' : '− '}
          {fmtFull(row.amount)}
        </Text>
        {row.price != null ? (
          <Text variant="caption" tone="faint" style={{ marginTop: 1 }}>
            @ {row.price.toLocaleString('en-IN', { maximumFractionDigits: 4 })}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** "2026-07-14" → "July 2026". Dates arrive as ISO date strings. */
function monthLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Undated';
  return d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
}

/** "2026-07-14" → "14 Jul". The year is already on the section header. */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}
