/**
 * Payouts & Statements.
 *
 * Every figure is a read-only mirror of `dsa_debit_notes`. The payout formula
 * itself is NOT reimplemented here and must never be — it lives in exactly one
 * place, the CRM's `DSAPayout.tsx`, and a second copy is how two screens start
 * telling a partner different things about what they are owed.
 *
 * Opening a statement mints a short-lived signed URL. The storage policy
 * independently restricts objects to those referenced by one of this partner's
 * own notes, so a guessed path fails even with a valid partner session.
 */
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { FileText, Receipt } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { fmt } from '@shared/crm/utils';
import { PartnerService } from '@shared/partner/services/PartnerService';
import type { PartnerDebitNote } from '@shared/partner/types';
import { space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { usePartnerQuery } from '@/features/partner/usePartnerData';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Money } from '@/ui/Money';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, KpiStat, SkeletonScreen, StatusPill } from '@/ui/kit';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function PartnerPayouts() {
  const p = usePalette();
  const load = useCallback(
    () => Promise.all([PartnerService.getPayoutSummary(), PartnerService.getDebitNotes()]),
    [],
  );
  const { data, loading, error, refresh } = usePartnerQuery(load);
  const [opening, setOpening] = useState<string | null>(null);

  const [summary, notes] = data ?? [null, null];

  const openStatement = async (note: PartnerDebitNote) => {
    const path = note.signed_pdf_url ?? note.pdf_url;
    if (!path) {
      Alert.alert('Not available yet', 'This statement has not been issued as a PDF yet.');
      return;
    }
    setOpening(note.id);
    const url = await PartnerService.getStatementUrl(path);
    setOpening(null);
    if (!url) {
      Alert.alert(
        'Could not open the statement',
        'Please try again, or ask your relationship manager to resend it.',
      );
      return;
    }
    await WebBrowser.openBrowserAsync(url);
  };

  return (
    <Screen onRefresh={refresh} refreshing={loading && !!data} tabBarInset>
      <ScreenHeader
        title="Payouts & Statements"
        subtitle="What you have earned, what is paid, and what is still due."
      />

      {loading && !data ? (
        <SkeletonScreen rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : (
        <View style={{ gap: space[5] }}>
          {summary ? (
            <Animated.View entering={FadeInDown.duration(400)}>
              <Card padding={5}>
                <Text variant="overline" tone="muted" caps>
                  Raised in {summary.fy_label}
                </Text>
                <Money value={summary.fy_net} variant="money" animate style={{ marginTop: space[2] }} />
                <Text variant="small" tone="muted" style={{ marginTop: 2 }}>
                  Gross {fmt(summary.fy_gross)} · TDS {fmt(summary.fy_tds)}
                </Text>

                <View style={{ flexDirection: 'row', gap: space[3], marginTop: space[4] }}>
                  <KpiStat label="Paid to date" value={fmt(summary.paid_net)} sub="Net of TDS" />
                  <KpiStat
                    label="Awaiting payment"
                    value={fmt(summary.awaiting_payment_net)}
                    tone="accent"
                  />
                </View>
                <View style={{ marginTop: space[3] }}>
                  <KpiStat
                    label="Lifetime earnings"
                    value={fmt(summary.lifetime_net)}
                    sub="Net of TDS, all years"
                  />
                </View>
              </Card>
            </Animated.View>
          ) : null}

          <View style={{ gap: space[3] }}>
            <Text variant="overline" tone="muted" caps>
              Statements
            </Text>

            {(notes ?? []).length === 0 ? (
              <EmptyState
                icon={Receipt}
                title="No statements yet"
                message="Your debit notes appear here once your first payout is raised."
              />
            ) : (
              (notes ?? []).map((note, i) => {
                const signed = note.signature_status === 'signed';
                const paid = !!note.paid_at;
                return (
                  <Animated.View
                    key={note.id}
                    entering={FadeInDown.duration(340).delay(Math.min(i, 10) * 40)}
                  >
                    <Card padding={4}>
                      <View style={{ flexDirection: 'row', gap: space[3] }}>
                        <View style={{ flex: 1 }}>
                          <Text variant="bodyMedium">{note.debit_note_number}</Text>
                          <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                            {MONTHS[note.month - 1] ?? ''} {note.year}
                          </Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text variant="moneySmall">{fmt(note.net_payable_amount)}</Text>
                          <Text variant="caption" tone="faint" style={{ marginTop: 1 }}>
                            TDS {fmt(note.tds_amount)}
                          </Text>
                        </View>
                      </View>

                      <View
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: space[2],
                          marginTop: space[3],
                          paddingTop: space[3],
                          borderTopWidth: 1,
                          borderTopColor: p.border.subtle,
                        }}
                      >
                        <StatusPill
                          dot
                          tone={paid ? 'success' : signed ? 'info' : 'warning'}
                          label={paid ? 'Paid' : signed ? 'Signed · awaiting payment' : 'Awaiting your signature'}
                        />
                        <View style={{ flex: 1 }} />
                        <Button
                          label="Open"
                          size="sm"
                          variant="secondary"
                          icon={FileText}
                          loading={opening === note.id}
                          onPress={() => void openStatement(note)}
                        />
                      </View>

                      {!signed ? (
                        <Text variant="caption" tone="faint" style={{ marginTop: space[3] }}>
                          Your relationship manager emails a secure signing link for each statement.
                        </Text>
                      ) : null}
                    </Card>
                  </Animated.View>
                );
              })
            )}
          </View>
        </View>
      )}
    </Screen>
  );
}
