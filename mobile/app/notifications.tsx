/**
 * Notifications — things that need the client to do something.
 *
 * Not a message inbox. There is no notifications table behind this and the app
 * does not send push; every item here is DERIVED from the client's current
 * state, using the same rules as the website: KYC not finished, and systematic
 * plans still waiting on the client's bank approval.
 *
 * That is deliberate. An inbox fills with things that have already happened; a
 * derived list can only contain things that are still true, so an item
 * disappearing means it got done.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { BellOff, CalendarClock, ShieldCheck, type LucideIcon } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { bseGateway } from '@shared/portal/services/bse/gateway';
import type { SystematicPlan } from '@shared/portal/services/bse/contract';
import { onboardingIncomplete } from '@shared/portal/onboarding/onboardingSteps';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { EmptyState, SkeletonScreen } from '@/ui/kit';

interface Alert {
  id: string;
  icon: LucideIcon;
  title: string;
  body: string;
  tone: 'action' | 'info';
  cta?: { label: string; href: string };
}

export default function Notifications() {
  const clientId = useClientId();
  const p = usePalette();
  const { snapshot, loading, refreshedAt, refresh } = useClientSnapshot(clientId);
  const [plans, setPlans] = useState<SystematicPlan[]>([]);

  useEffect(() => {
    let alive = true;
    bseGateway()
      .getSystematicPlans()
      .then((list) => alive && setPlans(list))
      .catch(() => {
        /* A BSE outage must not break this screen — it just has less to say. */
      });
    return () => {
      alive = false;
    };
  }, []);

  const client = snapshot.client;
  const alerts: Alert[] = [];

  if (client && onboardingIncomplete(client)) {
    alerts.push({
      id: 'onboarding',
      icon: ShieldCheck,
      title: 'Finish setting up your account',
      body: 'Your KYC isn’t complete yet, so you can’t invest. It takes a few minutes.',
      tone: 'action',
      cta: { label: 'Complete KYC', href: '/onboarding' },
    });
  }

  const awaiting = plans.filter((plan) => plan.status.toLowerCase() !== 'active');
  if (awaiting.length > 0) {
    alerts.push({
      id: 'sip-auth',
      icon: CalendarClock,
      title: `${awaiting.length} systematic plan${awaiting.length === 1 ? '' : 's'} need your approval`,
      body: 'BSE emailed you an approval link. Until you complete it, the first instalment cannot be collected.',
      tone: 'action',
      cta: { label: 'View plans', href: '/(client)/sip' },
    });
  }

  const actionCount = alerts.filter((a) => a.tone === 'action').length;

  return (
    <Screen onRefresh={refresh} refreshing={loading && !!refreshedAt}>
      <ScreenHeader
        title="Notifications"
        subtitle={
          actionCount > 0
            ? `${actionCount} thing${actionCount === 1 ? '' : 's'} need your attention.`
            : 'Anything needing your attention shows up here.'
        }
        showBack
      />

      {loading && !refreshedAt ? (
        <SkeletonScreen rows={2} />
      ) : alerts.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title="Nothing needs your attention"
          message="When something does — an approval to complete, a payment to make, KYC to finish — it will appear here."
        />
      ) : (
        <View style={{ gap: space[3] }}>
          {alerts.map((a, i) => {
            const Icon = a.icon;
            const tint = a.tone === 'action' ? p.state.warningSoft : p.text.secondary;
            return (
              <Animated.View key={a.id} entering={FadeInDown.duration(360).delay(i * 70)}>
                <Card padding={4}>
                  <View style={{ flexDirection: 'row', gap: space[3] }}>
                    <View
                      style={{
                        width: 38,
                        height: 38,
                        borderRadius: radius.md,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: a.tone === 'action' ? `${tint}1F` : p.bg.surface,
                      }}
                    >
                      <Icon size={18} color={tint} strokeWidth={2} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text variant="bodyMedium">{a.title}</Text>
                      <Text variant="small" tone="muted" style={{ marginTop: space[1] }}>
                        {a.body}
                      </Text>
                      {a.cta ? (
                        <View style={{ marginTop: space[3], alignSelf: 'flex-start' }}>
                          <Button
                            label={a.cta.label}
                            size="sm"
                            onPress={() => router.push(a.cta!.href as never)}
                          />
                        </View>
                      ) : null}
                    </View>
                  </View>
                </Card>
              </Animated.View>
            );
          })}
        </View>
      )}
    </Screen>
  );
}
