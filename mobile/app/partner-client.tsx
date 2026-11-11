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
import { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { ArrowDownLeft, ArrowUpRight, Wallet } from 'lucide-react-native';
import { fmtFull, fmtDate } from '@shared/crm/utils';
import { PartnerService } from '@shared/partner/services/PartnerService';
import { fromPartnerHoldings } from '@shared/portal/investments/model';
import { mfSsoEnabled } from '@shared/platform/env';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { usePartnerQuery } from '@/features/partner/usePartnerData';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { InvestmentsBoard } from '@/features/client/investments/InvestmentsBoard';
import { useInvestmentRows } from '@/features/client/investments/useInvestmentRows';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { EmptyState, ErrorState, SkeletonScreen } from '@/ui/kit';

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

  /*
   * The same board the website's partner portal shows for a client. Once
   * mutual funds run on the MF platform their rows come from the registrar
   * feed, which carries no purchase cost — `fromPartnerHoldings` then leaves
   * invested and returns unknown rather than reading them as 0%.
   */
  const base = useMemo(
    () => fromPartnerHoldings(holdings ?? [], { registrarMf: mfSsoEnabled() }),
    [holdings],
  );
  const { rows, enriching } = useInvestmentRows('partner', base);

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
          <InvestmentsBoard
            rows={rows}
            enriching={enriching}
            title="Holdings"
            compact
            emptyState={
              <EmptyState
                icon={Wallet}
                title="No holdings yet"
                message="This client has not invested through Niyom yet."
              />
            }
          />

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
