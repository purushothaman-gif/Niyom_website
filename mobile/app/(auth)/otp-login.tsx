/**
 * Email-code sign-in, for clients part-way through KYC.
 *
 * Someone who started an application but has not been provisioned by an RM yet
 * has no password — so PAN + password cannot work for them, and without this
 * screen the app would be a dead end for exactly the people it most needs to
 * bring back. `public-onboard-send-otp` / `public-onboard-verify-otp` are the
 * same pair the website uses.
 *
 * The server's `password_changed` flag is honoured on the way out: a client who
 * HAS completed onboarding and holds a temporary password is still routed
 * through the forced change screen rather than slipping past it by using a code.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Mail } from 'lucide-react-native';
import { clientSendLoginOtp, clientVerifyLoginOtp } from '@/features/auth/authApi';
import { useAuth } from '@/features/auth/AuthContext';
import { AuthLayout, AuthNotice } from '@/features/auth/AuthLayout';
import { space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { OtpInput } from '@/ui/OtpInput';
import { Text } from '@/ui/Text';

const RESEND_SECONDS = 30;

export default function OtpLogin() {
  const p = usePalette();
  const { signIn } = useAuth();

  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [masked, setMasked] = useState('');
  const [code, setCode] = useState('');
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

  const send = async () => {
    setError('');
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    const { ok, data } = await clientSendLoginOtp(clean);
    setBusy(false);
    if (!ok) {
      setError(data?.error || 'Could not send the code.');
      return;
    }
    setMasked(data?.email_masked || 'your registered email');
    setCode('');
    setStage('code');
    startCooldown();
  };

  const verify = async (entered: string) => {
    setError('');
    if (!/^\d{6}$/.test(entered)) {
      setError('Enter the 6-digit code sent to your email.');
      return;
    }
    setBusy(true);
    const result = await clientVerifyLoginOtp(email.trim().toLowerCase(), entered);
    setBusy(false);
    if (!result.ok) {
      setError(result.error ?? 'Verification failed.');
      setCode('');
      return;
    }
    await signIn({
      surface: 'client',
      id: result.id!,
      passwordChanged: result.passwordChanged !== false,
    });
    router.replace('/');
  };

  return (
    <AuthLayout
      eyebrow="Client Portal"
      title={stage === 'email' ? 'Sign in with a code' : 'Check your email'}
      subtitle={
        stage === 'email'
          ? 'For applications still in progress — no password needed.'
          : `We sent a 6-digit code to ${masked}.`
      }
      onBack={() => (stage === 'email' ? router.back() : setStage('email'))}
    >
      <View style={{ gap: space[5] }}>
        {error ? <AuthNotice message={error} /> : null}

        {stage === 'email' ? (
          <>
            <Input
              label="Email address"
              icon={Mail}
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="go"
              onSubmitEditing={() => void send()}
              editable={!busy}
            />
            <Button label="Send code" onPress={() => void send()} loading={busy} fullWidth size="lg" />
          </>
        ) : (
          <>
            <OtpInput
              value={code}
              onChange={setCode}
              onComplete={(entered) => void verify(entered)}
              disabled={busy}
              onBrand
            />
            <Button
              label="Sign in"
              onPress={() => void verify(code)}
              loading={busy}
              disabled={code.length !== 6}
              fullWidth
              size="lg"
            />
            <Pressable
              onPress={() => resendIn === 0 && void send()}
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
        )}
      </View>
    </AuthLayout>
  );
}
