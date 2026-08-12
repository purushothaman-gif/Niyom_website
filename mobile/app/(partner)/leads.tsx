/**
 * My Leads — prospects this partner submitted, and where each one stands.
 *
 * The status shown is `nw_partner_leads`' MAPPED value, not the CRM's. The
 * workflow behind it has around eighteen states including 'Not Interested' and
 * 'Wrong Number'; showing those verbatim to the person who made the
 * introduction is poor practice, so the RPC collapses them into four. Nothing
 * here should try to recover the underlying value.
 */
import { useCallback } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { ClipboardList, UserPlus } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { PartnerService } from '@shared/partner/services/PartnerService';
import type { PartnerLead } from '@shared/partner/types';
import { space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { usePartnerQuery } from '@/features/partner/usePartnerData';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, KpiStat, SkeletonScreen, StatusPill, type PillTone } from '@/ui/kit';

const TONE: Record<PartnerLead['status'], PillTone> = {
  Submitted: 'info',
  'In Progress': 'warning',
  Converted: 'success',
  Closed: 'neutral',
};

export default function PartnerLeads() {
  const p = usePalette();
  const load = useCallback(() => PartnerService.getLeads(), []);
  const { data, loading, error, refresh } = usePartnerQuery(load);

  const leads = data ?? [];
  const converted = leads.filter((l) => l.status === 'Converted').length;
  const live = leads.filter((l) => l.status === 'Submitted' || l.status === 'In Progress').length;

  return (
    <Screen onRefresh={refresh} refreshing={loading && !!data} tabBarInset>
      <ScreenHeader
        title="My Leads"
        subtitle="Prospects you have submitted, and where each one stands."
        action={
          <Button
            label="New"
            size="sm"
            icon={UserPlus}
            onPress={() => router.push('/partner-submit-lead')}
          />
        }
      />

      {loading && !data ? (
        <SkeletonScreen rows={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : leads.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No leads yet"
          message="Pass us a prospect and you can follow their progress here."
          action={
            <Button
              label="Submit a lead"
              icon={UserPlus}
              onPress={() => router.push('/partner-submit-lead')}
            />
          }
        />
      ) : (
        <View style={{ gap: space[5] }}>
          <View style={{ flexDirection: 'row', gap: space[3] }}>
            <KpiStat label="In progress" value={String(live)} />
            <KpiStat label="Converted" value={String(converted)} tone="success" />
          </View>

          <View style={{ gap: space[3] }}>
            {leads.map((lead, i) => (
              <Animated.View
                key={lead.lead_id}
                entering={FadeInDown.duration(340).delay(Math.min(i, 10) * 40)}
              >
                <Card padding={4}>
                  <View style={{ flexDirection: 'row', gap: space[3] }}>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyMedium" numberOfLines={1}>
                        {lead.lead_name}
                      </Text>
                      <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                        {[lead.mobile, lead.city].filter(Boolean).join(' · ')}
                      </Text>
                    </View>
                    <StatusPill dot tone={TONE[lead.status]} label={lead.status} />
                  </View>

                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      marginTop: space[3],
                      paddingTop: space[3],
                      borderTopWidth: 1,
                      borderTopColor: p.border.subtle,
                    }}
                  >
                    <Text variant="caption" tone="faint" style={{ flex: 1 }}>
                      Submitted {formatDate(lead.created_at)}
                    </Text>
                    {lead.converted_client_code ? (
                      <Text variant="caption" tone="success">
                        {lead.converted_client_code}
                      </Text>
                    ) : null}
                  </View>
                </Card>
              </Animated.View>
            ))}
          </View>
        </View>
      )}
    </Screen>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
