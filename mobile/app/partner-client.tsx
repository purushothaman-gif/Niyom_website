/**
 * One sourced client's portfolio and deal history, for the partner who
 * introduced them.
 *
 * ## What a partner may and may not see
 *
 * The complete portfolio — holdings and transactions — view-only. Never the
 * client's PII: no PAN, date of birth, email, address or bank details. And
 * never the firm's margin: `dsa_price` and `client_price` come back from the
 * RPC because they are the partner's OWN deal economics, but nothing here
 * reaches for `landing_cost`, `trail_*` or `nw_transactions.snapshot`.
 *
 * That boundary is enforced server-side by `nw_partner_client_portfolio` and
 * `nw_partner_client_transactions`, which project columns explicitly — RLS
 * grants rows, not columns, so a table read would leak all of it.
 */
import { useCallback } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ArrowDownLeft, ArrowUpRight, Wallet } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { fmt, fmtFull, fmtDate } from '@shared/crm/utils';
import { PartnerService } from '@shared/partner/services/PartnerService';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { usePartnerQuery } from '@/features/partner/usePartnerData';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Money, Delta } from '@/ui/Money';
import { EmptyState, ErrorState, KpiStat, SkeletonScreen } from '@/ui/kit';

export default function PartnerClientDetail() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const p = usePalette();
  const clientId = id ?? '';

  const load = useCallback(
    () =>
      Promise.all([
        PartnerService.getClientPortfolio(clientId),
        PartnerService.getClientTransactions(clientId),
      ]),
    [clientId],
  );
  const { data, loading, error, refresh } = usePartnerQuery(load, [clientId]);
  const [holdings, txns] = data ?? [null, null];

  const invested = (holdings ?? []).reduce((s, h) => s + (h.invested_amount || 0), 0);
  const current = (holdings ?? []).reduce((s, h) => s + (h.current_value || 0), 0);
  const gain = current - invested;

  return (
    <Screen onRefresh={refresh} refreshing={loading && !!data}>
      <ScreenHeader
        title="Client portfolio"
        subtitle="Holdings and deal history for a client you sourced."
        showBack
      />

      {loading && !data ? (
        <SkeletonScreen rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : (
        <View style={{ gap: space[5] }}>
          <Card padding={5}>
            <Text variant="overline" tone="muted" caps>
              Current value
            </Text>
            <Money value={current} variant="money" animate style={{ marginTop: space[2] }} />
            {invested > 0 ? (
              <View style={{ marginTop: space[2] }}>
                <Delta amount={gain} percent={(gain / invested) * 100} variant="bodyMedium" />
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', gap: space[3], marginTop: space[4] }}>
              <KpiStat label="Invested" value={fmt(invested)} />
              <KpiStat label="Holdings" value={String((holdings ?? []).length)} />
            </View>
          </Card>

          {/* ------------------------------ holdings ---------------------- */}
          <View style={{ gap: space[3] }}>
            <Text variant="overline" tone="muted" caps>
              Holdings
            </Text>
            {(holdings ?? []).length === 0 ? (
              <EmptyState
                icon={Wallet}
                title="No holdings yet"
                message="This client has not invested through Niyom yet."
              />
            ) : (
              (holdings ?? []).map((h, i) => (
                <Animated.View
                  key={h.holding_id}
                  entering={FadeInDown.duration(340).delay(Math.min(i, 10) * 40)}
                >
                  <Card padding={4}>
                    <View style={{ flexDirection: 'row', gap: space[3] }}>
                      <View style={{ flex: 1 }}>
                        <Text variant="bodyMedium" numberOfLines={2}>
                          {h.product_name}
                        </Text>
                        <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                          {humanise(h.product_type)}
                          {h.quantity
                            ? ` · ${h.quantity.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units`
                            : ''}
                        </Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text variant="moneySmall">{fmt(h.current_value)}</Text>
                        {h.invested_amount > 0 ? (
                          <View style={{ marginTop: 2 }}>
                            <Delta
                              amount={h.gain_loss}
                              percent={(h.gain_loss / h.invested_amount) * 100}
                              variant="caption"
                              showAmount={false}
                            />
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </Card>
                </Animated.View>
              ))
            )}
          </View>

          {/* ---------------------------- transactions -------------------- */}
          {(txns ?? []).length > 0 ? (
            <View style={{ gap: space[3] }}>
              <Text variant="overline" tone="muted" caps>
                Deal history
              </Text>
              <Card padding={4}>
                {(txns ?? []).map((t, i, arr) => {
                  const isBuy = t.txn_type.toLowerCase().includes('buy');
                  const Icon = isBuy ? ArrowDownLeft : ArrowUpRight;
                  const tone = isBuy ? p.state.successSoft : p.state.warningSoft;
                  return (
                    <View
                      key={t.txn_id}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space[3],
                        paddingVertical: space[3],
                        borderBottomWidth: i === arr.length - 1 ? 0 : 1,
                        borderBottomColor: p.border.subtle,
                      }}
                    >
                      <View
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: radius.full,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: `${tone}1F`,
                        }}
                      >
                        <Icon size={15} color={tone} strokeWidth={2.3} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text variant="smallMedium" numberOfLines={1}>
                          {t.product_name}
                        </Text>
                        <Text variant="caption" tone="muted" style={{ marginTop: 1 }}>
                          {fmtDate(t.txn_date)} · {humanise(t.txn_type)}
                        </Text>
                      </View>
                      <Text variant="smallMedium">{fmtFull(t.amount)}</Text>
                    </View>
                  );
                })}
              </Card>
            </View>
          ) : null}

          <Text variant="caption" tone="faint" center>
            Portfolio only. Client contact and KYC details are not shared with partners.
          </Text>
        </View>
      )}
    </Screen>
  );
}

function humanise(value: string): string {
  return value.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
