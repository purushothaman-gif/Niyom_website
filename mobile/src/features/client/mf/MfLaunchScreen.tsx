/**
 * Mutual funds run on the MF platform. The Invest tab becomes one button that asks the
 * server for a one-time MF platform sign-in link (investor SSO) and opens it in the
 * in-app browser — the client lands on their holdings without a second login.
 *
 * The link is a credential: it is opened at once and never kept, so every tap
 * asks for a fresh one.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { AlertTriangle, ExternalLink, Hourglass, TrendingUp } from 'lucide-react-native';
import { MfSsoService, type MfLaunchResult } from '@shared/portal/services/MfSsoService';
import { space } from '@/design/tokens';
import { useClientId } from '@/features/auth/AuthContext';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/kit';

type State = 'idle' | MfLaunchResult['status'];

const COPY: Record<Exclude<State, 'ok'>, { title: string; message: string }> = {
  idle: {
    title: 'Your mutual fund account',
    message: 'Holdings, investments and SIPs open in our MF platform — no separate sign-in needed.',
  },
  not_mapped: {
    title: 'Your mutual fund account is being set up',
    message: "Your relationship manager has been notified and will let you know as soon as it's ready.",
  },
  kyc_incomplete: {
    title: 'Complete your KYC first',
    message: 'Your PAN needs to be verified before we can open your mutual fund account.',
  },
  not_available: {
    title: 'Not available for this login',
    message: 'Mutual funds open from a client login.',
  },
  demo: {
    title: 'Not available in the sample portal',
    message: 'In a live account this opens your mutual fund holdings, signed in.',
  },
  error: {
    title: "We couldn't open your mutual fund account",
    message: 'Please try again in a moment. If it keeps happening, raise a ticket from Support.',
  },
};

export function MfLaunchScreen() {
  const clientId = useClientId();
  const [state, setState] = useState<State>('idle');
  const [busy, setBusy] = useState(false);

  const open = async () => {
    if (busy || !clientId) return;
    setBusy(true);
    const res = await MfSsoService.getLoginLink(clientId);
    setBusy(false);
    if (res.status === 'ok') {
      setState('idle');
      await WebBrowser.openBrowserAsync(res.redirectUrl);
      return;
    }
    setState(res.status);
  };

  const c = COPY[state === 'ok' ? 'idle' : state];
  const icon = state === 'not_mapped' ? Hourglass : state === 'idle' || state === 'demo' ? TrendingUp : AlertTriangle;
  const canOpen = state === 'idle' || state === 'error';

  return (
    <Screen tabBarInset>
      <View style={{ paddingBottom: space[3] }}>
        <Text variant="h1">Mutual Funds</Text>
      </View>
      <EmptyState
        icon={icon}
        title={c.title}
        message={c.message}
        action={
          canOpen ? (
            <Button label="Open Mutual Funds" icon={ExternalLink} loading={busy} onPress={() => void open()} />
          ) : state === 'kyc_incomplete' ? (
            <Button label="Complete KYC" onPress={() => router.push('/onboarding')} />
          ) : undefined
        }
      />
    </Screen>
  );
}
