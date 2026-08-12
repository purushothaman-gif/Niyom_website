/**
 * Setting (or replacing) the PARTNER device PIN, and turning on biometrics.
 *
 * ## Why a PIN at all
 *
 * Five minutes of inactivity signs a partner out, matching the website. That is
 * only a fair trade if getting back in is quick — so the PIN is not a
 * convenience bolted on, it is what makes the timeout tolerable.
 *
 * ## What is stored where
 *
 * The PIN goes to the SERVER (`partner-pin-set`), hashed, against this device's
 * id. Nothing on the phone can verify it — the device only ever asks, and
 * `partner-pin-login` decides, counts the failures, cools the device off after
 * five and burns the PIN after ten.
 *
 * A copy is kept locally ONLY if the partner turns on Face ID, and only inside
 * the keychain behind a biometric access-control flag, so unlocking releases it
 * into that same server call. See `src/platform/device.ts`.
 */
import { useCallback, useState } from 'react';
import { Platform, View } from 'react-native';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { CheckCircle2, Fingerprint, ScanFace, ShieldCheck } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { partnerSetPin } from '@/features/auth/authApi';
import { useDsaId } from '@/features/auth/AuthContext';
import {
  getDeviceId,
  markBiometricPin,
  maskEmail,
  saveBiometricPin,
  saveProfile,
  silencePinPrompt,
} from '@/platform/device';
import { PartnerService } from '@shared/partner/services/PartnerService';
import { usePartnerQuery } from '@/features/partner/usePartnerData';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { PinKeypad, PIN_LENGTH } from '@/ui/PinKeypad';

type Stage = 'choose' | 'confirm' | 'biometric' | 'done';

export default function PartnerSetPin() {
  const dsaId = useDsaId();
  const p = usePalette();
  const loadProfile = useCallback(() => PartnerService.getProfile(), []);
  const { data: profile } = usePartnerQuery(loadProfile);

  const [stage, setStage] = useState<Stage>('choose');
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(0);
  const [bioKind, setBioKind] = useState<'face' | 'fingerprint'>('fingerprint');

  const onFirstComplete = (pin: string) => {
    /*
     * Four identical digits or a straight run is most of what gets guessed in
     * the first handful of tries, and the server's counter is the only thing
     * behind it. Refusing here costs a moment; allowing it costs the PIN.
     */
    if (/^(\d)\1{3}$/.test(pin) || isSequential(pin)) {
      setError('Choose something less predictable than 1111 or 1234.');
      setFirst('');
      setShake((n) => n + 1);
      return;
    }
    setError('');
    setSecond('');
    setStage('confirm');
  };

  const onConfirmComplete = async (pin: string) => {
    if (pin !== first) {
      setError('Those did not match. Start again.');
      setFirst('');
      setSecond('');
      setShake((n) => n + 1);
      setStage('choose');
      return;
    }

    setError('');
    setBusy(true);
    const deviceId = await getDeviceId();
    const label = `${Platform.OS === 'ios' ? 'iPhone' : 'Android phone'} · Niyom app`;
    const { ok, data } = await partnerSetPin(deviceId, pin, label);
    setBusy(false);

    if (!ok) {
      setError((data as { error?: string })?.error || 'Could not set your PIN. Please try again.');
      setSecond('');
      setShake((n) => n + 1);
      return;
    }

    /*
     * Remember the account on this device so the keypad can say WHOSE it is.
     * A name and a MASKED email only — enough to recognise yourself, not a copy
     * of the client's contact details.
     */
    await saveProfile('partner', {
      id: dsaId,
      name: profile?.full_name ?? 'Your account',
      maskedEmail: maskEmail(profile?.email ?? ''),
    });
    await silencePinPrompt('partner', dsaId);

    const [hasHardware, enrolled, types] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    if (hasHardware && enrolled) {
      setBioKind(
        types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
          ? 'face'
          : 'fingerprint',
      );
      setStage('biometric');
      return;
    }
    setStage('done');
  };

  const enableBiometric = async () => {
    setBusy(true);
    const saved = await saveBiometricPin('partner', dsaId, first);
    if (saved) await markBiometricPin('partner', dsaId);
    setBusy(false);
    setStage('done');
  };

  /* ------------------------------- rendering ------------------------------ */

  if (stage === 'done') {
    return (
      <Screen>
        <ScreenHeader title="You’re set" showBack />
        <Animated.View entering={FadeIn.duration(280)} style={{ gap: space[5] }}>
          <Card padding={5} style={{ alignItems: 'center', gap: space[3] }}>
            <CheckCircle2 size={42} color={p.state.successSoft} strokeWidth={1.7} />
            <Text variant="h3" center>
              Your PIN is active
            </Text>
            <Text variant="small" tone="muted" center>
              Next time you open Niyom on this phone, four digits gets you in.
            </Text>
          </Card>
          <Button label="Done" onPress={() => router.back()} fullWidth size="lg" />
        </Animated.View>
      </Screen>
    );
  }

  if (stage === 'biometric') {
    const Icon = bioKind === 'face' ? ScanFace : Fingerprint;
    return (
      <Screen>
        <ScreenHeader title={bioKind === 'face' ? 'Use Face ID?' : 'Use your fingerprint?'} />
        <View style={{ gap: space[5] }}>
          <Card padding={5} style={{ alignItems: 'center', gap: space[4] }}>
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: radius.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: p.accent.tint(0.14),
              }}
            >
              <Icon size={34} color={p.accent.DEFAULT} strokeWidth={1.7} />
            </View>
            <Text variant="small" tone="muted" center>
              Your PIN is kept in this phone’s secure keychain and released only when{' '}
              {bioKind === 'face' ? 'Face ID' : 'your fingerprint'} recognises you. The PIN still
              does the signing in, so nothing about the security changes — you just stop typing it.
            </Text>
          </Card>

          <Button
            label={bioKind === 'face' ? 'Turn on Face ID' : 'Turn on fingerprint unlock'}
            onPress={() => void enableBiometric()}
            loading={busy}
            fullWidth
            size="lg"
          />
          <Button label="Not now" variant="ghost" onPress={() => setStage('done')} fullWidth />
        </View>
      </Screen>
    );
  }

  const confirming = stage === 'confirm';

  return (
    <Screen>
      <ScreenHeader
        title={confirming ? 'Confirm your PIN' : 'Choose a PIN'}
        subtitle={
          confirming
            ? 'Enter the same four digits again.'
            : 'Four digits to unlock Niyom on this phone.'
        }
        showBack
      />

      <View style={{ gap: space[6], alignItems: 'center', marginTop: space[5] }}>
        {error ? (
          <View
            style={{
              backgroundColor: `${p.state.dangerSoft}1A`,
              borderColor: `${p.state.dangerSoft}40`,
              borderWidth: 1,
              borderRadius: radius.md,
              paddingHorizontal: space[4],
              paddingVertical: space[3],
            }}
            accessibilityLiveRegion="polite"
          >
            <Text variant="small" tone="danger">
              {error}
            </Text>
          </View>
        ) : null}

        <PinKeypad
          value={confirming ? second : first}
          onChange={confirming ? setSecond : setFirst}
          onComplete={(pin) => (confirming ? void onConfirmComplete(pin) : onFirstComplete(pin))}
          shakeToken={shake}
          disabled={busy}
        />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], maxWidth: 300 }}>
          <ShieldCheck size={14} color={p.text.faint} />
          <Text variant="caption" tone="faint" style={{ flex: 1 }}>
            Five wrong tries cools this device off for 15 minutes; ten burns the PIN and asks for
            your password.
          </Text>
        </View>
      </View>
    </Screen>
  );
}

/** "1234" and "9876" and anything else stepping by one. */
function isSequential(pin: string): boolean {
  if (pin.length !== PIN_LENGTH) return false;
  const step = Number(pin[1]) - Number(pin[0]);
  if (step !== 1 && step !== -1) return false;
  for (let i = 2; i < pin.length; i += 1) {
    if (Number(pin[i]) - Number(pin[i - 1]) !== step) return false;
  }
  return true;
}
