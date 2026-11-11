/**
 * My Portfolio — the investments board.
 *
 * The same multi-asset board the website's portfolio page shows: every holding
 * the client has — bought through Niyom, reported by the registrar, or read
 * from an imported statement — as one list with one set of totals. The rows are
 * `fromClientHoldings(snapshot.holdings)` and the totals are `summarise`, both
 * from `shared/portal/investments`, so a figure here is the website's figure by
 * construction.
 *
 * ## Unknown cost is not a zero return
 *
 * Registrar-fed mutual funds arrive with units and value but no purchase cost.
 * The board shows their value and daily move, leaves invested and returns as an
 * em dash, and totals invested/returns only over holdings whose cost is known —
 * saying how much of the portfolio that covers.
 *
 * ## "All distributors" vs "Through Niyom"
 *
 * `snapshot.holdings` is already the complete book, held-away funds included.
 * The switch only filters that book (`applyMfScope`); it never re-reads or
 * re-prices, so a fund we service has identical figures in both views.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { PackagePlus, Search, Wallet } from 'lucide-react-native';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import { buildDashboardData } from '@shared/portal/services/dashboardModel';
import { fromClientHoldings } from '@shared/portal/investments/model';
import { applyMfScope, isHeldAwayMf, type MfScope } from '@shared/portal/investments/mfScope';
import { mfSsoEnabled } from '@shared/platform/env';
import { space } from '@/design/tokens';
import { useClientId } from '@/features/auth/AuthContext';
import { CasStatusNote } from '@/features/client/CasStatusNote';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { InvestmentsBoard } from '@/features/client/investments/InvestmentsBoard';
import { useInvestmentRows } from '@/features/client/investments/useInvestmentRows';
import { shortDay } from '@/features/client/investments/format';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Input } from '@/ui/Input';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, Segmented, SkeletonScreen } from '@/ui/kit';

export default function Portfolio() {
  const clientId = useClientId();
  const { snapshot, loading, error, refreshedAt, refresh } = useClientSnapshot(clientId);

  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<MfScope>('all');

  const hasData = !!refreshedAt;
  const holdings = snapshot.holdings;
  const heldAway = useMemo(() => holdings.filter(isHeldAwayMf), [holdings]);
  const scoped = useMemo(() => applyMfScope(holdings, scope), [holdings, scope]);
  const baseRows = useMemo(() => fromClientHoldings(scoped), [scoped]);
  const { rows, enriching } = useInvestmentRows('client', baseRows);
  // XIRR covers only holdings whose cash flows explain them; the board shows
  // the coverage alongside — see dashboardModel.xirrFor.
  const dash = useMemo(() => (hasData ? buildDashboardData(snapshot) : null), [hasData, snapshot]);

  // The newest statement any held-away fund came from — its units are as of then.
  const casStatementTo = useMemo(
    () =>
      heldAway
        .map((h) => h.cas?.statementTo ?? '')
        .filter(Boolean)
        .sort()
        .pop() ?? null,
    [heldAway],
  );
  // The import routes are retired in the app once funds run on the MF platform.
  const canImport = !mfSsoEnabled();
  const openImport = () => router.push('/import-portfolio');

  return (
    <Screen onRefresh={refresh} refreshing={loading && hasData} tabBarInset>
      <ScreenHeader
        title="My Portfolio"
        subtitle="Everything you hold — funds, bonds, shares — valued at the latest price."
      />

      {!hasData && loading ? (
        <SkeletonScreen rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : holdings.length === 0 ? (
        /*
         * An investor with nothing here has almost always invested elsewhere —
         * an empty portfolio is far more often "we cannot see it yet" than
         * "there is nothing". So the empty state offers the import.
         */
        <EmptyState
          icon={Wallet}
          title="Nothing here yet"
          message={
            canImport
              ? 'Holdings you buy through us appear here as they settle. Hold funds or shares elsewhere? Bring them in and see everything in one place.'
              : 'Holdings you buy through Niyom appear here as they settle.'
          }
          action={canImport ? <Button label="Import my portfolio" icon={PackagePlus} onPress={openImport} /> : undefined}
        />
      ) : (
        <View style={{ gap: space[5] }}>
          {canImport ? (
            <>
              <CasStatusNote
                freshness={snapshot.casFreshness}
                hasImportedStatement={snapshot.mfSource === 'cas'}
                valuedOn={snapshot.valuedOn}
                onImport={openImport}
              />
              {snapshot.mfSource === 'cas' ? (
                <Button
                  label="Import more — funds, shares or demat"
                  icon={PackagePlus}
                  variant="secondary"
                  size="sm"
                  onPress={openImport}
                />
              ) : null}
            </>
          ) : null}

          {/* Mutual fund scope: only meaningful once a statement shows held-away funds. */}
          {heldAway.length > 0 ? (
            <Card weight="surface" padding={4}>
              <Text variant="caption" tone="muted" caps>
                Mutual funds
              </Text>
              <Segmented<MfScope>
                style={{ marginTop: space[2] }}
                value={scope}
                onChange={setScope}
                options={[
                  { value: 'all', label: 'All distributors' },
                  { value: 'niyom', label: 'Through Niyom' },
                ]}
              />
              <Text variant="caption" tone="faint" style={{ marginTop: space[2] }}>
                {scope === 'all'
                  ? `Includes ${heldAway.length} fund${heldAway.length > 1 ? 's' : ''} held with other distributors, from your CAS${
                      casStatementTo ? ` (units as of ${shortDay(casStatementTo)})` : ''
                    }.`
                  : `Only funds held through Niyom · ${heldAway.length} fund${heldAway.length > 1 ? 's' : ''} with other distributors hidden.`}
              </Text>
            </Card>
          ) : null}

          <Input
            icon={Search}
            placeholder="Search a fund, bond, share or folio"
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
          />

          <InvestmentsBoard
            rows={rows}
            enriching={enriching}
            query={query}
            xirrPercent={dash?.xirrPercent ?? null}
            xirrCoveragePct={dash?.xirrCoveragePct ?? null}
            xirrNote={dash?.xirrNote ?? null}
          />
        </View>
      )}
    </Screen>
  );
}
