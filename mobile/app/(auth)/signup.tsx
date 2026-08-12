/**
 * Opening a free account.
 *
 * The website's `/onboarding` flow, unchanged: PAN → details → emailed code →
 * a live session. Same four edge functions, same order, same rules.
 *
 * ## Why the PAN comes first
 *
 * The step that looks like friction is the one that removes it. Verifying the
 * PAN returns the name held against it, so the account is opened in the
 * registrar's spelling rather than whatever someone types on a phone keyboard
 * — which is what stops a KYC name mismatch surfacing weeks later, when fixing
 * it means re-doing the paperwork. The name field is therefore filled in and
 * left read-only.
 *
 * A PAN that already has an account does not get an error and a dead end: it
 * gets pointed at "Continue your application", which is the screen that can
 * actually let that person in.
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { CreditCard, Mail, Phone, ShieldCheck, UserRound } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { signupResendOtp, signupStart, signupVerifyOtp, signupVerifyPan } from '@/features/auth/authApi';
import { useAuth } from '@/features/auth/AuthContext';
import { AuthLayout, AuthNotice } from '@/features/auth/AuthLayout';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { OtpInput } from '@/ui/OtpInput';
import { Text } from '@/ui/Text';

type Step = 'pan' | 'details' | 'otp';

const RESEND_SECONDS = 30;
const STEPS: { key: Step; label: string }[] = [
  { key: 'pan', label: 'PAN' },
  { key: 'details', label: 'Details' },
  { key: 'otp', label: 'Verify' },
];

export default function Signup() {
  const p = usePalette();
  const { signIn } = useAuth();

  const [step, setStep] = useState<Step>('pan');
  const [pan, setPan] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [masked, setMasked] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
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

  const validPan = /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);
  // A 10-digit Indian mobile, which always starts 6–9.
  const validPhone = /^[6-9]\d{9}$/.test(phone);
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  /* -------------------------------- step 1 -------------------------------- */

  const verifyPan = async () => {
    setError('');
    setAlreadyRegistered(false);
    if (!validPan) {
      setError('Enter a valid PAN (e.g. ABCDE1234F).');
      return;
    }
    setBusy(true);
    const { ok, data } = await signupVerifyPan(pan);
    setBusy(false);

    if (data?.already_registered) {
      setAlreadyRegistered(true);
      return;
    }
    if (!ok || !data?.valid || !data?.name_as_per_pan) {
      setError(data?.error || 'PAN could not be verified. Please check and try again.');
      return;
    }
    setFullName(data.name_as_per_pan);
    setStep('details');
  };

  /* -------------------------------- step 2 -------------------------------- */

  const createAccount = async () => {
    setError('');
    if (!validPhone) {
      setError('Enter a valid 10-digit mobile number.');
      return;
    }
    if (!validEmail) {
      setError('Enter a valid email address.');
      return;
    }
    setBusy(true);
    const { ok, data } = await signupStart({
      full_name: fullName.trim(),
      pan,
      phone,
      email: email.trim().toLowerCase(),
    });
    setBusy(false);

    /*
     * `already_exists` is not a failure. It means a previous attempt got this
     * far, so the account is there and a fresh code has gone out — carrying on
     * to the code step is exactly right.
     */
    if (!ok && !data?.already_exists) {
      setError(data?.error || 'Could not create your account. Please try again.');
      return;
    }
    setMasked(data?.email_masked || email.trim().toLowerCase());
    setOtp('');
    setStep('otp');
    startCooldown();
  };

  /* -------------------------------- step 3 -------------------------------- */

  const verify = async (code: string) => {
    setError('');
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code sent to your email.');
      return;
    }
    setBusy(true);
    const result = await signupVerifyOtp(phone, code);
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? 'Verification failed.');
      setOtp('');
      return;
    }
    await signIn({ surface: 'client', id: result.id!, passwordChanged: true });
    router.replace('/');
  };

  const resend = async () => {
    if (resendIn > 0) return;
    setError('');
    setBusy(true);
    const { ok, data } = await signupResendOtp(phone);
    setBusy(false);
    if (!ok) {
      setError(data?.error || 'Could not resend the code.');
      return;
    }
    startCooldown();
  };

  /* --------------------------------- view --------------------------------- */

  return (
    <AuthLayout
      eyebrow="Open a free account"
      title={
        step === 'pan' ? 'Your PAN' : step === 'details' ? 'Your details' : 'Check your email'
      }
      subtitle={
        step === 'pan'
          ? 'We use it to fetch your name exactly as it is registered.'
          : step === 'details'
            ? 'Where we should reach you. Both are verified.'
            : `We sent a 6-digit code to ${masked}.`
      }
      onBack={() =>
        step === 'pan'
          ? router.back()
          : setStep(step === 'otp' ? 'details' : 'pan')
      }
    >
      <View style={{ gap: space[5] }}>
        <StepDots current={step} />

        {alreadyRegistered ? (
          <Animated.View entering={FadeIn.duration(220)} style={{ gap: space[3] }}>
            <AuthNotice
              tone="info"
              message="This PAN already has a Niyom account. Sign in instead of opening a second one."
            />
            <Button
              label="Sign in with an email code"
              onPress={() => router.replace('/(auth)/otp-login')}
              fullWidth
            />
            <Button
              label="Sign in with PAN and password"
              variant="secondary"
              onBrand
              onPress={() => router.replace('/(auth)/client-login')}
              fullWidth
            />
          </Animated.View>
        ) : error ? (
          <AuthNotice message={error} />
        ) : null}

        {step === 'pan' && !alreadyRegistered ? (
          <>
            <Input
              label="PAN number"
              format="pan"
              icon={CreditCard}
              placeholder="ABCDE1234F"
              value={pan}
              onChangeText={(v) => {
                setPan(v);
                setAlreadyRegistered(false);
              }}
              maxLength={10}
              editable={!busy}
              returnKeyType="go"
              onSubmitEditing={() => void verifyPan()}
            />
            <Button
              label="Verify PAN"
              onPress={() => void verifyPan()}
              loading={busy}
              disabled={!validPan}
              fullWidth
              size="lg"
            />
            <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'flex-start' }}>
              <ShieldCheck size={14} color={p.onBrand.textMuted} style={{ marginTop: 2 }} />
              <Text variant="caption" tone="onBrandMuted" style={{ flex: 1 }}>
                Your PAN is verified with the income-tax database and is never shown to anyone
                outside Niyom.
              </Text>
            </View>
          </>
        ) : null}

        {step === 'details' ? (
          <>
            {/* Read-only: this is the registrar's spelling, and letting someone
                "correct" it is how a KYC mismatch gets created. */}
            <Input
              label="Name as per PAN"
              icon={UserRound}
              value={fullName}
              editable={false}
              hint="Taken from your PAN record — this cannot be edited."
            />
            <Input
              label="Mobile number"
              icon={Phone}
              format="digits"
              placeholder="10-digit mobile"
              value={phone}
              onChangeText={(v) => setPhone(v.replace(/\D/g, '').slice(0, 10))}
              maxLength={10}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              editable={!busy}
            />
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
              editable={!busy}
              returnKeyType="go"
              onSubmitEditing={() => void createAccount()}
            />
            <Button
              label="Create my account"
              onPress={() => void createAccount()}
              loading={busy}
              disabled={!validPhone || !validEmail}
              fullWidth
              size="lg"
            />
          </>
        ) : null}

        {step === 'otp' ? (
          <>
            <OtpInput
              value={otp}
              onChange={setOtp}
              onComplete={(code) => void verify(code)}
              disabled={busy}
              onBrand
            />
            <Button
              label="Verify and continue"
              onPress={() => void verify(otp)}
              loading={busy}
              disabled={otp.length !== 6}
              fullWidth
              size="lg"
            />
            <Pressable onPress={() => void resend()} disabled={resendIn > 0 || busy} hitSlop={8}>
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
      </View>
    </AuthLayout>
  );
}

/** Three dots showing where in the signup someone is. */
function StepDots({ current }: { current: Step }) {
  const p = usePalette();
  const index = STEPS.findIndex((s) => s.key === current);

  return (
    <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'center' }}>
      {STEPS.map((s, i) => {
        const done = i < index;
        const active = i === index;
        return (
          <View key={s.key} style={{ flex: 1, gap: space[2] }}>
            <View
              style={{
                height: 3,
                borderRadius: radius.full,
                backgroundColor:
                  done || active ? p.onBrand.gold : 'rgba(255, 255, 255, 0.14)',
                opacity: done ? 0.55 : 1,
              }}
            />
            <Text
              variant="caption"
              style={{ color: active ? p.onBrand.gold : p.onBrand.textMuted }}
            >
              {s.label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}
