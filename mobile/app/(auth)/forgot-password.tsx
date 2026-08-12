/**
 * Self-serve password reset, for both portals.
 *
 * PAN → a 6-digit code emailed to the address on file → a new password. One
 * screen for clients and partners because the flow is identical; only the pair
 * of endpoints differs, and `surface` picks between them.
 *
 * ## Why the code is verified before the password is asked for
 *
 * The server verifies WITHOUT consuming (`action: 'verify'`) and only spends the
 * code on the final step (`action: 'reset'`). So a mistyped code is caught while
 * it can still be retyped, rather than after the client has composed a new
 * password and lost the code proving they may set it.
 *
 * ## Why nothing here confirms the PAN exists
 *
 * Every response to step one looks the same. Answering "no account with that
 * PAN" would turn this into a way to ask whether a given person banks with
 * Niyom — so an unknown PAN gets the same "check your email" as a real one.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { CreditCard, Lock } from 'lucide-react-native';
import { passwordChecks, passwordError } from '@shared/lib/passwordPolicy';
import { clientReset, partnerReset } from '@/features/auth/authApi';
import { AuthLayout, AuthNotice } from '@/features/auth/AuthLayout';
import { space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { OtpInput } from '@/ui/OtpInput';
import { Text } from '@/ui/Text';
import { PasswordChecklist } from '@/features/auth/PasswordChecklist';

type Step = 'pan' | 'code' | 'password' | 'done';

const RESEND_SECONDS = 30;

export default function ForgotPassword() {
  const params = useLocalSearchParams<{ surface?: string; pan?: string }>();
  const surface = params.surface === 'partner' ? 'partner' : 'client';
  const api = surface === 'partner' ? partnerReset : clientReset;
  const p = usePalette();

  const [step, setStep] = useState<Step>('pan');
  const [pan, setPan] = useState((params.pan ?? '').toUpperCase());
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resendIn, setResendIn] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
    },
    [],
  );

  const startCooldown = () => {
    setResendIn(RESEND_SECONDS);
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setResendIn((s) => {
        if (s <= 1) {
          if (timer.current) clearInterval(timer.current);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
  };

  const sendCode = async () => {
    setError('');
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
      setError('Please enter a valid PAN number (e.g. ABCDE1234F).');
      return;
    }
    setBusy(true);
    const { ok, data } = await api.sendCode(pan);
    setBusy(false);
    if (!ok) {
      setError(data?.error || 'Could not send the code. Please try again.');
      return;
    }
    setOtp('');
    setStep('code');
    startCooldown();
  };

  const verifyCode = async (code: string) => {
    setError('');
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your email.');
      return;
    }
    setBusy(true);
    const { ok, data } = await api.verifyCode(pan, code);
    setBusy(false);
    if (!ok || !data?.verified) {
      setError(data?.error || 'That code is not right. Please check and try again.');
      setOtp('');
      return;
    }
    setPassword('');
    setConfirm('');
    setStep('password');
  };

  const setNewPassword = async () => {
    const policy = passwordError(password);
    if (policy) {
      setError(policy);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setError('');
    setBusy(true);
    const { ok, data } = await api.setPassword(pan, otp, password);
    setBusy(false);
    if (!ok) {
      setError(data?.error || 'Could not reset your password. Please try again.');
      return;
    }
    if (timer.current) clearInterval(timer.current);
    setStep('done');
  };

  /* --------------------------------- views ------------------------------- */

  if (step === 'done') {
    return (
      <AuthLayout
        eyebrow={surface === 'partner' ? 'Partner Portal' : 'Client Portal'}
        title="Password updated"
        subtitle="You can now sign in with your new password."
      >
        <Button label="Back to sign in" onPress={() => router.back()} fullWidth size="lg" />
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      eyebrow={surface === 'partner' ? 'Partner Portal' : 'Client Portal'}
      title="Reset password"
      subtitle={
        step === 'pan'
          ? 'We will email a 6-digit code to the address on your account.'
          : step === 'code'
            ? 'Enter the 6-digit code we just emailed you.'
            : 'Choose a new password.'
      }
      onBack={() => (step === 'pan' ? router.back() : setStep(step === 'password' ? 'code' : 'pan'))}
    >
      <View style={{ gap: space[5] }}>
        {error ? <AuthNotice message={error} /> : null}

        {step === 'pan' ? (
          <>
            <Input
              label="PAN number"
              format="pan"
              icon={CreditCard}
              placeholder="ABCDE1234F"
              value={pan}
              onChangeText={setPan}
              maxLength={10}
              editable={!busy}
            />
            <Button label="Send code" onPress={() => void sendCode()} loading={busy} fullWidth size="lg" />
          </>
        ) : null}

        {step === 'code' ? (
          <>
            <OtpInput
              value={otp}
              onChange={setOtp}
              onComplete={(code) => void verifyCode(code)}
              disabled={busy}
              onBrand
            />
            <Button
              label="Verify code"
              onPress={() => void verifyCode(otp)}
              loading={busy}
              disabled={otp.length !== 6}
              fullWidth
              size="lg"
            />
            <Pressable
              onPress={() => resendIn === 0 && void sendCode()}
              disabled={resendIn > 0 || busy}
              hitSlop={8}
            >
              <Text variant="small" tone="onBrandMuted" center>
                {resendIn > 0 ? (
                  `Resend the code in ${resendIn}s`
                ) : (
                  <Text variant="smallMedium" style={{ color: p.onBrand.gold }}>
                    Resend the code
                  </Text>
                )}
              </Text>
            </Pressable>
          </>
        ) : null}

        {step === 'password' ? (
          <>
            <Input
              label="New password"
              icon={Lock}
              secure
              placeholder="Choose a strong password"
              value={password}
              onChangeText={setPassword}
              autoComplete="new-password"
              textContentType="newPassword"
              editable={!busy}
            />
            <PasswordChecklist checks={passwordChecks(password)} onBrand />
            <Input
              label="Confirm new password"
              icon={Lock}
              secure
              placeholder="Type it again"
              value={confirm}
              onChangeText={setConfirm}
              editable={!busy}
              returnKeyType="go"
              onSubmitEditing={() => void setNewPassword()}
            />
            <Button
              label="Set new password"
              onPress={() => void setNewPassword()}
              loading={busy}
              fullWidth
              size="lg"
            />
          </>
        ) : null}
      </View>
    </AuthLayout>
  );
}
