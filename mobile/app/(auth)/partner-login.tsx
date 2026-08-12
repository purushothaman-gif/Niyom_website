/**
 * Partner (DSA) sign-in.
 *
 * The same shape as the client screen and the same server-side rules, against
 * the partner endpoints: `partner-pan-login`, `partner-pin-login`, and the
 * `send-partner-reset-otp` / `reset-partner-password-with-otp` pair.
 *
 * ## No demo mode here
 *
 * The website offers published demo credentials that mount the partner portal
 * on fixture data. The app deliberately does not: an app-store build carrying a
 * working set of credentials in its own sign-in screen is a different exposure
 * from a link on a website, and a prospective partner is better served by an
 * enquiry that reaches a person than by a sandbox that cannot.
 *
 * "Become a partner today" replaces it, and creates a real lead in the CRM's
 * admin pool. (The demo path still exists in `shared/` for the website; nothing
 * in the app calls it.)
 */
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { CreditCard, Lock } from 'lucide-react-native';
import { space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { AuthLayout, AuthNotice } from '@/features/auth/AuthLayout';
import { useLoginRateLimit } from '@/features/auth/useLoginRateLimit';
import { partnerPinSignIn, partnerSignIn } from '@/features/auth/authApi';
import { useAuth } from '@/features/auth/AuthContext';
import {
  getDeviceId,
  hasBiometricPin,
  listProfiles,
  readBiometricPin,
  removeProfile,
  type PinProfile,
} from '@/platform/device';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { PinKeypad } from '@/ui/PinKeypad';
import { Text } from '@/ui/Text';

export default function PartnerLogin() {
  const p = usePalette();
  const { signIn, lastSignOutReason } = useAuth();
  const limit = useLoginRateLimit('partner-login');

  const [ready, setReady] = useState(false);
  const [active, setActive] = useState<PinProfile | null>(null);
  const [view, setView] = useState<'pin' | 'password'>('password');

  const [pan, setPan] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [shake, setShake] = useState(0);
  const [biometric, setBiometric] = useState<'face' | 'fingerprint' | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const saved = await listProfiles('partner');
      if (!alive) return;
      const only = saved.length >= 1 ? saved[0] : null;
      setActive(only);
      setView(only ? 'pin' : 'password');
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || view !== 'pin' || !active) return;
    let alive = true;
    (async () => {
      const [hasHardware, enrolled, types, saved] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        LocalAuthentication.supportedAuthenticationTypesAsync(),
        hasBiometricPin('partner', active.id),
      ]);
      if (!alive || !hasHardware || !enrolled || !saved) return;
      setBiometric(
        types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
          ? 'face'
          : 'fingerprint',
      );
      if (lastSignOutReason !== 'idle') void useBiometric(active, true);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, view, active, lastSignOutReason]);

  const useBiometric = async (profile: PinProfile, auto: boolean) => {
    const stored = await readBiometricPin('partner', profile.id);
    if (!stored) {
      if (!auto) setPinError('Face ID didn’t work. Enter your PIN instead.');
      return;
    }
    await submitPin(stored, profile);
  };

  const submitPin = async (entered: string, profile: PinProfile) => {
    setPinError('');
    setBusy(true);
    const deviceId = await getDeviceId();
    const result = await partnerPinSignIn(deviceId, profile.id, entered);
    setBusy(false);
    setPin('');

    if (!result.ok) {
      setShake((n) => n + 1);
      setPinError(result.error ?? 'That PIN didn’t work.');
      if (result.code === 'burned' || result.code === 'expired') {
        setTimeout(() => void forget(profile.id), 1800);
      }
      return;
    }

    await signIn({
      surface: 'partner',
      id: result.id!,
      passwordChanged: result.passwordChanged !== false,
    });
    router.replace('/');
  };

  const forget = async (dsaId: string) => {
    await removeProfile('partner', dsaId);
    setActive(null);
    setBiometric(null);
    setPinError('');
    setView('password');
  };

  const submitPassword = async () => {
    setError('');
    if (limit.locked) return;

    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
      setError('Please enter a valid PAN number (e.g. ABCDE1234F).');
      return;
    }
    if (!password) {
      setError('Password is required.');
      return;
    }

    setBusy(true);
    const result = await partnerSignIn(pan, password);
    setBusy(false);

    if (!result.ok) {
      setError(limit.failureMessage());
      return;
    }

    limit.clear();
    await signIn({
      surface: 'partner',
      id: result.id!,
      passwordChanged: result.passwordChanged !== false,
    });
    router.replace('/');
  };

  if (!ready) return <AuthLayout title="" />;

  if (view === 'pin' && active) {
    return (
      <AuthLayout
        eyebrow="Partner Portal"
        title={firstName(active.name)}
        subtitle={active.maskedEmail}
        onBack={() => router.back()}
        footer={
          <View style={{ gap: space[3], alignItems: 'center' }}>
            <Pressable onPress={() => setView('password')} hitSlop={8}>
              <Text variant="smallMedium" style={{ color: p.onBrand.gold }}>
                Use PAN and password instead
              </Text>
            </Pressable>
            <Pressable onPress={() => void forget(active.id)} hitSlop={8}>
              <Text variant="small" tone="onBrandMuted">
                Not you? Remove this account
              </Text>
            </Pressable>
          </View>
        }
      >
        <View style={{ gap: space[6], alignItems: 'center' }}>
          {lastSignOutReason === 'idle' ? (
            <AuthNotice tone="info" message="Signed out after 5 minutes of inactivity." />
          ) : null}
          {pinError ? <AuthNotice message={pinError} /> : null}

          <Text variant="small" tone="onBrandMuted">
            Enter your 4-digit PIN
          </Text>

          <PinKeypad
            value={pin}
            onChange={setPin}
            onComplete={(entered) => void submitPin(entered, active)}
            shakeToken={shake}
            disabled={busy}
            onBrand
            biometric={
              biometric ? { kind: biometric, onPress: () => void useBiometric(active, false) } : null
            }
          />
        </View>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      eyebrow="Partner Portal"
      title="Partner sign-in"
      subtitle="Sign in with your PAN number and password."
      onBack={() => (active ? setView('pin') : router.back())}
      footer={
        <Pressable onPress={() => router.push('/(auth)/partner-enquiry')} hitSlop={8}>
          <Text variant="small" tone="onBrandMuted" center>
            New to Niyom?{' '}
            <Text variant="smallMedium" style={{ color: p.onBrand.gold }}>
              Become a partner today
            </Text>
          </Text>
        </Pressable>
      }
    >
      <View style={{ gap: space[4] }}>
        {limit.locked ? <AuthNotice message={limit.lockMessage} /> : error ? <AuthNotice message={error} /> : null}

        <Input
          label="PAN number"
          format="pan"
          icon={CreditCard}
          placeholder="ABCDE1234F"
          value={pan}
          onChangeText={setPan}
          maxLength={10}
          autoComplete="username"
          textContentType="username"
          editable={!busy && !limit.locked}
        />

        <Input
          label="Password"
          icon={Lock}
          secure
          placeholder="Your password"
          value={password}
          onChangeText={setPassword}
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="go"
          onSubmitEditing={() => void submitPassword()}
          editable={!busy && !limit.locked}
        />

        <Pressable
          onPress={() =>
            router.push({ pathname: '/(auth)/forgot-password', params: { surface: 'partner', pan } })
          }
          hitSlop={8}
          style={{ alignSelf: 'flex-end' }}
        >
          <Text variant="small" style={{ color: p.onBrand.gold }}>
            Forgot password?
          </Text>
        </Pressable>

        <Button
          label="Sign in"
          onPress={() => void submitPassword()}
          loading={busy}
          disabled={limit.locked}
          fullWidth
          size="lg"
        />

        <Text variant="caption" tone="onBrandMuted" center>
          Partner access is enabled by your relationship manager.
        </Text>
      </View>
    </AuthLayout>
  );
}

function firstName(full: string): string {
  const first = full.trim().split(/\s+/)[0] ?? '';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}
