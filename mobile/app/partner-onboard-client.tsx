/**
 * A partner onboards one of their own clients.
 *
 * Same two steps as the website's modal. The PAN is verified first (the public
 * PAN gate), which returns the legal name and refuses a PAN that is already a
 * client — so a duplicate is stopped before anything is created. Then mobile and
 * email, and `partner-onboard-client` files the client under this partner and
 * their RM with an auto-generated code.
 *
 * It creates a RECORD only. KYC (bank, demat, documents) and the client's login
 * are finished by the RM, and the screen says so rather than implying the
 * client can sign in straight away.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { CheckCircle2, CreditCard, Mail, Phone, ShieldCheck, UserPlus, UserRound } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { PartnerService } from '@shared/partner/services/PartnerService';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PHONE_RE = /^[6-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INTERESTS = ['Bonds', 'Unlisted Shares', 'Mutual Funds', 'Fixed Deposit', 'Insurance'];

export default function PartnerOnboardClient() {
  const p = usePalette();

  const [pan, setPan] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [interest, setInterest] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [doneCode, setDoneCode] = useState<string | null>(null);

  const verifyPan = async () => {
    const value = pan.trim().toUpperCase();
    if (!PAN_RE.test(value)) {
      setError('Enter a valid PAN (e.g. ABCDE1234F).');
      return;
    }
    setVerifying(true);
    setError('');
    try {
      const r = await PartnerService.verifyPan(value);
      if (!r.ok) {
        setError(r.error || 'PAN could not be verified.');
        return;
      }
      setPan(value);
      setFullName(r.name || '');
      setVerified(true);
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setVerifying(false);
    }
  };

  const canSubmit =
    verified &&
    fullName.trim().length > 0 &&
    PHONE_RE.test(phone) &&
    EMAIL_RE.test(email.trim()) &&
    !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError('');
    try {
      const r = await PartnerService.onboardClient({
        full_name: fullName.trim(),
        pan,
        phone,
        email: email.trim().toLowerCase(),
        ...(interest ? { investment_preferences: [interest] } : {}),
      });
      if (!r.ok) {
        setError(r.error || 'Could not onboard the client.');
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDoneCode(r.client_code || '');
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (doneCode !== null) {
    return (
      <Screen>
        <ScreenHeader title="Client onboarded" />
        <Animated.View entering={FadeIn.duration(280)} style={{ gap: space[5] }}>
          <Card padding={5} style={{ alignItems: 'center', gap: space[3] }}>
            <CheckCircle2 size={42} color={p.state.successSoft} strokeWidth={1.7} />
            <Text variant="bodyMedium" center>
              {fullName}
            </Text>
            {doneCode ? (
              <>
                <Text variant="overline" tone="muted" caps>
                  Client code
                </Text>
                <Text variant="h2" tone="accent">
                  {doneCode}
                </Text>
              </>
            ) : null}
            <Text variant="small" tone="muted" center>
              They are now mapped under you. Your relationship manager will complete KYC and enable
              their login.
            </Text>
          </Card>
          <Button
            label="Back to my clients"
            onPress={() => router.replace('/(partner)/clients')}
            fullWidth
            size="lg"
          />
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        title="Onboard a client"
        subtitle="Verify their PAN, then add how to reach them."
        showBack
      />

      <View style={{ gap: space[4] }}>
        {error ? (
          <View
            accessibilityLiveRegion="polite"
            style={{
              backgroundColor: `${p.state.dangerSoft}1A`,
              borderColor: `${p.state.dangerSoft}40`,
              borderWidth: 1,
              borderRadius: radius.md,
              paddingHorizontal: space[4],
              paddingVertical: space[3],
            }}
          >
            <Text variant="small" tone="danger">
              {error}
            </Text>
          </View>
        ) : null}

        <Input
          label="PAN"
          icon={CreditCard}
          placeholder="ABCDE1234F"
          value={pan}
          onChangeText={(v) => {
            setPan(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10));
            if (verified) {
              setVerified(false);
              setFullName('');
            }
          }}
          maxLength={10}
          autoCapitalize="characters"
          autoCorrect={false}
          editable={!verified && !verifying}
        />

        {verified ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <ShieldCheck size={16} color={p.state.successSoft} />
            <Text variant="smallMedium" style={{ color: p.state.successSoft, flex: 1 }}>
              PAN verified
            </Text>
            <Text
              variant="smallMedium"
              tone="accent"
              accessibilityRole="button"
              onPress={() => {
                setVerified(false);
                setFullName('');
              }}
            >
              Change
            </Text>
          </View>
        ) : (
          <Button
            label="Verify PAN"
            icon={ShieldCheck}
            onPress={() => void verifyPan()}
            loading={verifying}
            disabled={pan.length !== 10}
            fullWidth
            size="lg"
          />
        )}

        {verified ? (
          <>
            <Input
              label="Client name (as per PAN)"
              icon={UserRound}
              placeholder="Full name"
              value={fullName}
              onChangeText={setFullName}
              autoCapitalize="words"
              editable={!submitting}
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
              editable={!submitting}
            />

            <Input
              label="Email"
              icon={Mail}
              placeholder="name@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              editable={!submitting}
            />

            <View>
              <Text variant="overline" tone="muted" caps style={{ marginBottom: space[2] }}>
                Interested in (optional)
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
                {INTERESTS.map((item) => {
                  const active = item === interest;
                  return (
                    <Text
                      key={item}
                      variant="smallMedium"
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      onPress={() => setInterest(active ? '' : item)}
                      style={{
                        paddingHorizontal: space[3],
                        paddingVertical: space[2],
                        borderRadius: radius.full,
                        overflow: 'hidden',
                        borderWidth: 1,
                        borderColor: active ? p.accent.DEFAULT : p.border.DEFAULT,
                        backgroundColor: active ? p.accent.tint(0.14) : 'transparent',
                        color: active ? p.accent.DEFAULT : p.text.secondary,
                      }}
                    >
                      {item}
                    </Text>
                  );
                })}
              </View>
            </View>

            <Button
              label="Onboard client"
              icon={UserPlus}
              onPress={() => void submit()}
              loading={submitting}
              disabled={!canSubmit}
              fullWidth
              size="lg"
            />
            <Text variant="caption" tone="faint" center>
              Creates the client under you and your relationship manager. KYC (bank, demat,
              documents) and the client login are completed by your RM.
            </Text>
          </>
        ) : null}
      </View>
    </Screen>
  );
}
