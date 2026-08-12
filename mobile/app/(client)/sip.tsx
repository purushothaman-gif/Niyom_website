/**
 * Systematic plans — SIPs, STPs and SWPs registered with BSE.
 *
 * These come from BSE, not from `nw_holdings`: a plan is a standing instruction
 * the registrar holds, and it exists whether or not an instalment has been
 * collected yet. That is also why a plan can be present and NOT active.
 *
 * ## The not-active case is the point of this screen
 *
 * A registered plan whose mandate the client has not approved with their bank
 * collects nothing. It looks like a live SIP in every list, and the client
 * finds out months later that no money moved. So anything not active is lifted
 * to the top with the reason and what to do about it.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { AlertTriangle, CalendarClock, TrendingUp } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { fmt, fmtDate } from '@shared/crm/utils';
import { bseGateway, isBseMock } from '@shared/portal/services/bse/gateway';
import type { SystematicPlan } from '@shared/portal/services/bse/contract';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, KpiStat, SkeletonScreen, StatusPill } from '@/ui/kit';

export default function Sip() {
  const p = usePalette();

  const [plans, setPlans] = useState<SystematicPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPlans(await bseGateway().getSystematicPlans());
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not reach the exchange for your plans. Please try again.',
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const { active, pending } = useMemo(() => {
    const isActive = (plan: SystematicPlan) => plan.status.toLowerCase() === 'active';
    return {
      active: plans.filter(isActive),
      pending: plans.filter((plan) => !isActive(plan)),
    };
  }, [plans]);

  const monthly = active
    .filter((plan) => plan.frequency.toLowerCase().startsWith('month'))
    .reduce((sum, plan) => sum + plan.amount, 0);

  return (
    <Screen onRefresh={load} refreshing={loading && plans.length > 0} tabBarInset>
      <ScreenHeader
        title="Systematic Plans"
        subtitle="Your systematic plans — instalments, dates and amounts."
      />

      {loading && plans.length === 0 ? (
        <SkeletonScreen rows={3} />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : plans.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title="No systematic plans yet"
          message="A SIP invests a fixed amount on the same day each month. Start one from any fund."
          action={
            <Button
              label="Explore funds"
              icon={TrendingUp}
              onPress={() => router.push('/(client)/invest')}
            />
          }
        />
      ) : (
        <View style={{ gap: space[5] }}>
          <View style={{ flexDirection: 'row', gap: space[3] }}>
            <KpiStat label="Active plans" value={String(active.length)} />
            <KpiStat label="Monthly commitment" value={fmt(monthly)} tone="accent" />
          </View>

          {/* Anything not active goes first — see the header note. */}
          {pending.length > 0 ? (
            <View style={{ gap: space[3] }}>
              <View
                style={{
                  flexDirection: 'row',
                  gap: space[3],
                  borderRadius: radius.lg,
                  borderWidth: 1,
                  borderColor: `${p.state.warningSoft}55`,
                  backgroundColor: `${p.state.warningSoft}14`,
                  padding: space[4],
                }}
              >
                <AlertTriangle size={17} color={p.state.warningSoft} style={{ marginTop: 1 }} />
                <View style={{ flex: 1 }}>
                  <Text variant="smallMedium">
                    {pending.length} plan{pending.length === 1 ? '' : 's'} not collecting yet
                  </Text>
                  <Text variant="small" tone="secondary" style={{ marginTop: space[1] }}>
                    BSE emailed you a link to approve the mandate with your bank. Until that is
                    done, no instalment can be taken.
                  </Text>
                </View>
              </View>

              {pending.map((plan, i) => (
                <PlanCard key={plan.regNum} plan={plan} index={i} />
              ))}
            </View>
          ) : null}

          {active.length > 0 ? (
            <View style={{ gap: space[3] }}>
              <Text variant="overline" tone="muted" caps>
                Active
              </Text>
              {active.map((plan, i) => (
                <PlanCard key={plan.regNum} plan={plan} index={i} />
              ))}
            </View>
          ) : null}

          {isBseMock() ? (
            <Text variant="caption" tone="faint" center>
              Showing illustrative plans — the live exchange connection is not enabled.
            </Text>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

function PlanCard({ plan, index }: { plan: SystematicPlan; index: number }) {
  const p = usePalette();
  const active = plan.status.toLowerCase() === 'active';

  return (
    <Animated.View entering={FadeInDown.duration(340).delay(Math.min(index, 10) * 40)}>
      <Card padding={4}>
        <View style={{ flexDirection: 'row', gap: space[3] }}>
          <View style={{ flex: 1 }}>
            <Text variant="bodyMedium" numberOfLines={2}>
              {plan.schemeName}
            </Text>
            <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
              {plan.type} · {plan.frequency} · from {fmtDate(plan.startDate)}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="moneySmall">{fmt(plan.amount)}</Text>
            <Text variant="caption" tone="faint" style={{ marginTop: 1 }}>
              per instalment
            </Text>
          </View>
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
          <StatusPill
            dot
            tone={active ? 'success' : 'warning'}
            label={active ? 'Active' : humanise(plan.status)}
          />
          <View style={{ flex: 1 }} />
          <Text variant="caption" tone="faint">
            {plan.regNum}
          </Text>
        </View>
      </Card>
    </Animated.View>
  );
}

function humanise(status: string): string {
  return status.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
}
