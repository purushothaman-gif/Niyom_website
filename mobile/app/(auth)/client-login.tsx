/**
 * Client sign-in.
 *
 * A port of `src/pages/ClientLogin.tsx` — the same PAN + password, the same
 * five-tries lockout, the same PIN keypad, and the same escape hatches (email
 * code for a client still in KYC, and the PAN → emailed code password reset).
 *
 * The one thing the app adds is Face ID, and it adds it without inventing a new
 * way in: an enrolled device keeps the PIN in the keychain behind a biometric
 * flag, and unlocking releases that PIN into the SAME `client-pin-login` call
 * the keypad makes. The server's counting, cool-off and burn-after-ten are
 * untouched — see `src/platform/device.ts`.
 *
 * ## Why a device with a PIN opens on the keypad
 *
 * Because that is what someone came here to do. What is stored locally is a
 * name and a masked email — enough to recognise the account, and unverified: it
 * decides which screen shows first and nothing else. The server still decides
 * whether the PIN is right, and for which client.
 */
import { useCallback, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { CreditCard, Lock } from 'lucide-react-native';
import { space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { AuthLayout, AuthNotice } from '@/features/auth/AuthLayout';
import { useLoginRateLimit } from '@/features/auth/useLoginRateLimit';
import { clientPinSignIn, clientSignIn } from '@/features/auth/authApi';
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

type View_ = 'pin' | 'password';

export default function ClientLogin() {
  const p = usePalette();
  const { signIn, lastSignOutReason } = useAuth();
  const limit = useLoginRateLimit('client-login');

  const [ready, setReady] = useState(false);
  const [profiles, setProfiles] = useState<PinProfile[]>([]);
  const [active, setActive] = useState<PinProfile | null>(null);
  const [view, setView] = useState<View_>('password');

  const [pan, setPan] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [shake, setShake] = useState(0);
  const [biometric, setBiometric] = useState<'face' | 'fingerprint' | null>(null);

  /* --------------------------- what to open on -------------------------- */

  useEffect(() => {
    let alive = true;
    (async () => {
      const saved = await listProfiles('client');
      if (!alive) return;
      setProfiles(saved);
      const only = saved.length === 1 ? saved[0] : null;
      setActive(only);
      setView(saved.length > 0 ? 'pin' : 'password');
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* ------------------------------ biometrics ---------------------------- */

  const attemptBiometric = useCallback(
    async (profile: PinProfile, auto: boolean) => {
      const stored = await readBiometricPin('client', profile.id);
      if (!stored) {
        // Declined or failed. On an automatic attempt say nothing — the keypad
        // is right there; on a deliberate tap, explain.
        if (!auto) setPinError('Face ID didn’t work. Enter your PIN instead.');
        return;
      }
      await submitPin(stored, profile);
    },
    // submitPin is stable for the life of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    if (!ready || view !== 'pin' || !active) return;
    let alive = true;
    (async () => {
      const [hasHardware, enrolled, types, saved] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        LocalAuthentication.supportedAuthenticationTypesAsync(),
        hasBiometricPin('client', active.id),
      ]);
      if (!alive || !hasHardware || !enrolled || !saved) return;

      setBiometric(
        types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
          ? 'face'
          : 'fingerprint',
      );

      /*
       * Offer it immediately, but NOT when the client was just signed out for
       * being idle: unlocking them straight back in would defeat the timeout
       * they were signed out by.
       */
      if (lastSignOutReason !== 'idle') void attemptBiometric(active, true);
    })();
    return () => {
      alive = false;
    };
  }, [ready, view, active, lastSignOutReason, attemptBiometric]);

  /* ------------------------------- actions ------------------------------ */

  const submitPin = async (entered: string, profile: PinProfile) => {
    setPinError('');
    setBusy(true);
    const deviceId = await getDeviceId();
    const result = await clientPinSignIn(deviceId, profile.id, entered);
    setBusy(false);
    setPin('');

    if (!result.ok) {
      setShake((n) => n + 1);
      setPinError(result.error ?? 'That PIN didn’t work.');
      /*
       * A burned or expired PIN is gone for good — the server will refuse it
       * from now on. Stop offering a keypad that cannot work, after a beat so
       * the client can read why.
       */
      if (result.code === 'burned' || result.code === 'expired') {
        setTimeout(() => void forget(profile.id), 1800);
      }
      return;
    }

    await signIn({
      surface: 'client',
      id: result.id!,
      passwordChanged: result.passwordChanged !== false,
    });
    router.replace('/');
  };

  const forget = async (clientId: string) => {
    await removeProfile('client', clientId);
    const left = await listProfiles('client');
    setProfiles(left);
    setActive(left.length === 1 ? left[0] : null);
    setPinError('');
    setBiometric(null);
    if (left.length === 0) setView('password');
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
    const result = await clientSignIn(pan, password);
    setBusy(false);

    if (!result.ok) {
      setError(limit.failureMessage());
      return;
    }

    limit.clear();
    await signIn({
      surface: 'client',
      id: result.id!,
      passwordChanged: result.passwordChanged !== false,
    });
    router.replace('/');
  };

  if (!ready) return <AuthLayout title="" />;

  /* --------------------------------- PIN -------------------------------- */

  if (view === 'pin' && active) {
    return (
      <AuthLayout
        eyebrow="Client Portal"
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
              biometric ? { kind: biometric, onPress: () => void attemptBiometric(active, false) } : null
            }
          />

          {profiles.length > 1 ? (
            <View style={{ gap: space[2], alignItems: 'center' }}>
              <Text variant="caption" tone="onBrandMuted" caps>
                Switch account
              </Text>
              <View style={{ flexDirection: 'row', gap: space[2], flexWrap: 'wrap', justifyContent: 'center' }}>
                {profiles.map((prof) => (
                  <Pressable
                    key={prof.id}
                    onPress={() => {
                      setActive(prof);
                      setPin('');
                      setPinError('');
                    }}
                    style={{
                      paddingHorizontal: space[3],
                      paddingVertical: space[2],
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: prof.id === active.id ? p.onBrand.gold : p.onBrand.border,
                      backgroundColor: prof.id === active.id ? 'rgba(200,164,93,0.14)' : 'transparent',
                    }}
                  >
                    <Text variant="caption" tone={prof.id === active.id ? 'onBrand' : 'onBrandMuted'}>
                      {firstName(prof.name)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </View>
      </AuthLayout>
    );
  }

  /* ------------------------------ password ------------------------------ */

  return (
    <AuthLayout
      eyebrow="Client Portal"
      title="Welcome back"
      subtitle="Sign in with your PAN number and password."
      onBack={() => (profiles.length > 0 ? setView('pin') : router.back())}
      footer={
        <View style={{ gap: space[4], alignItems: 'center' }}>
          <Pressable onPress={() => router.push('/(auth)/otp-login')} hitSlop={8}>
            <Text variant="small" tone="onBrandMuted" center>
              Already started your application?{' '}
              <Text variant="smallMedium" style={{ color: p.onBrand.gold }}>
                Sign in with an email code
              </Text>
            </Text>
          </Pressable>
        </View>
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
          returnKeyType="next"
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
            router.push({ pathname: '/(auth)/forgot-password', params: { surface: 'client', pan } })
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
          Your PAN is your login ID. Credentials are set up by your relationship manager.
        </Text>
      </View>
    </AuthLayout>
  );
}

/** "ANAND KRISHNAMURTHY" → "Anand" — a greeting, not a record. */
function firstName(full: string): string {
  const first = full.trim().split(/\s+/)[0] ?? '';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}
