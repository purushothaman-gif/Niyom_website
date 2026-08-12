/**
 * Reports — downloadable statements.
 *
 * Built from data already on the device, by the same `exporters.ts` the website
 * uses, so the columns and the rounding are identical. Nothing is generated
 * server-side and nothing is emailed; the sheet is written to the app's cache
 * and handed straight to the share sheet, so the client picks where it goes.
 *
 * Amounts are written as raw numbers rather than formatted strings — the point
 * of a spreadsheet is that it can be summed.
 */
import { useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import { FileSpreadsheet, FileText, Receipt, Share2 } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { fmt } from '@shared/crm/utils';
import { PortfolioService } from '@shared/portal/services/PortfolioService';
import { exportHoldingsXlsx, exportTransactionsXlsx } from '@shared/portal/services/exporters';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import { useTransactions } from '@shared/portal/hooks/useTransactions';
import { space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { ErrorState, ListRow, SkeletonScreen } from '@/ui/kit';

type Job = 'holdings' | 'transactions' | null;

export default function Reports() {
  const clientId = useClientId();
  const p = usePalette();
  const { snapshot, loading, error, refreshedAt, refresh } = useClientSnapshot(clientId);
  const { rows: txns, loading: txnLoading } = useTransactions(clientId);

  const [busy, setBusy] = useState<Job>(null);

  const hasData = !!refreshedAt;
  const holdings = useMemo(
    () => (hasData ? PortfolioService.buildPortfolioData(snapshot.holdings).rows : []),
    [hasData, snapshot.holdings],
  );

  const run = async (job: Exclude<Job, null>) => {
    setBusy(job);
    try {
      if (job === 'holdings') {
        await exportHoldingsXlsx(holdings, snapshot.client);
      } else {
        await exportTransactionsXlsx(txns, snapshot.client);
      }
    } catch (err) {
      Alert.alert(
        'Could not build that report',
        err instanceof Error ? err.message : 'Please try again.',
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen onRefresh={refresh} refreshing={loading && hasData}>
      <ScreenHeader
        title="Reports"
        subtitle="Download your transaction and holdings statements."
        showBack
      />

      {!hasData && loading ? (
        <SkeletonScreen rows={3} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : (
        <View style={{ gap: space[5] }}>
          <Animated.View entering={FadeInDown.duration(400)}>
            <Card padding={5}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
                <FileSpreadsheet size={20} color={p.accent.DEFAULT} strokeWidth={1.9} />
                <Text variant="h3" style={{ flex: 1 }}>
                  Holdings statement
                </Text>
              </View>
              <Text variant="small" tone="muted" style={{ marginTop: space[2] }}>
                Every holding with its units, cost, current value and gain — {holdings.length}{' '}
                row{holdings.length === 1 ? '' : 's'}, valued at {fmt(snapshot.holdings.reduce(
                  (s, h) => s + (Number(h.current_value) || 0),
                  0,
                ))}.
              </Text>
              <View style={{ marginTop: space[4] }}>
                <Button
                  label="Export as spreadsheet"
                  icon={Share2}
                  onPress={() => void run('holdings')}
                  loading={busy === 'holdings'}
                  disabled={holdings.length === 0 || busy !== null}
                  fullWidth
                />
              </View>
            </Card>
          </Animated.View>

          <Animated.View entering={FadeInDown.duration(400).delay(70)}>
            <Card padding={5}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
                <FileText size={20} color={p.accent.DEFAULT} strokeWidth={1.9} />
                <Text variant="h3" style={{ flex: 1 }}>
                  Transaction statement
                </Text>
              </View>
              <Text variant="small" tone="muted" style={{ marginTop: space[2] }}>
                Every purchase, redemption and switch with date, units, price and amount —{' '}
                {txnLoading ? 'loading…' : `${txns.length} row${txns.length === 1 ? '' : 's'}`}.
              </Text>
              <View style={{ marginTop: space[4] }}>
                <Button
                  label="Export as spreadsheet"
                  icon={Share2}
                  onPress={() => void run('transactions')}
                  loading={busy === 'transactions'}
                  disabled={txns.length === 0 || busy !== null}
                  fullWidth
                />
              </View>
            </Card>
          </Animated.View>

          <View>
            <Text variant="overline" tone="muted" caps style={{ marginBottom: space[3] }}>
              Also available
            </Text>
            <Card padding={4}>
              <ListRow
                icon={Receipt}
                title="Capital gains"
                subtitle="Realised gains by financial year, with an export per year"
                showChevron
                onPress={() => router.push('/capital-gains')}
                last
              />
            </Card>
          </View>

          <Text variant="caption" tone="faint" center>
            Reports are built on your phone from data already loaded — nothing is emailed and
            nothing leaves the app unless you share it.
          </Text>
        </View>
      )}
    </Screen>
  );
}
