/**
 * Submitting a prospect.
 *
 * Goes through `partner-submit-lead`, which re-reads `nw_dsa` to confirm the
 * caller is an enabled, active partner — the JWT's `is_partner` metadata alone
 * is never treated as authoritative. So a partner disabled mid-session gets a
 * clear refusal here rather than silently creating a lead nobody owns.
 *
 * A duplicate mobile is reported plainly rather than quietly creating a second
 * record: the partner should know the prospect is already in the system, and an
 * RM should not have to de-dupe it later.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { CheckCircle2, Mail, MapPin, Phone, Send, UserRound } from 'lucide-react-native';
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

const PRODUCTS = ['Mutual Funds', 'Bonds', 'Fixed Deposits', 'Insurance', 'Not sure yet'];

export default function PartnerSubmitLead() {
  const p = usePalette();

  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [product, setProduct] = useState('');
  const [remarks, setRemarks] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<string | null>(null);

  const validName = fullName.trim().length >= 2;
  const validMobile = /^[6-9]\d{9}$/.test(mobile);
  const validEmail = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const submit = async () => {
    setError('');
    if (!validName) {
      setError('Please enter the prospect’s name.');
      return;
    }
    if (!validMobile) {
      setError('Please enter a valid 10-digit mobile number.');
      return;
    }
    if (!validEmail) {
      setError('Please enter a valid email address.');
      return;
    }

    setBusy(true);
    const result = await PartnerService.submitLead({
      full_name: fullName.trim(),
      mobile,
      email: email.trim().toLowerCase(),
      city: city.trim(),
      interested_product: product,
      remarks: remarks.trim(),
    });
    setBusy(false);

    if (!result.ok) {
      setError(result.error ?? 'Could not submit this lead.');
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDone(result.lead_code ?? '');
  };

  if (done !== null) {
    return (
      <Screen>
        <ScreenHeader title="Lead submitted" />
        <Animated.View entering={FadeIn.duration(280)} style={{ gap: space[5] }}>
          <Card padding={5} style={{ alignItems: 'center', gap: space[3] }}>
            <CheckCircle2 size={42} color={p.state.successSoft} strokeWidth={1.7} />
            {done ? (
              <>
                <Text variant="overline" tone="muted" caps>
                  Reference
                </Text>
                <Text variant="h2" tone="accent">
                  {done}
                </Text>
              </>
            ) : null}
            <Text variant="small" tone="muted" center>
              Your relationship manager has it. You can follow its progress under My Leads.
            </Text>
          </Card>
          <Button
            label="Back to my leads"
            onPress={() => router.replace('/(partner)/leads')}
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
        title="Submit a lead"
        subtitle="Pass a prospect to Niyom and follow how it goes."
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
          label="Prospect’s name"
          icon={UserRound}
          placeholder="Full name"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
          editable={!busy}
        />

        <Input
          label="Mobile number"
          icon={Phone}
          format="digits"
          placeholder="10-digit mobile"
          value={mobile}
          onChangeText={(v) => setMobile(v.replace(/\D/g, '').slice(0, 10))}
          maxLength={10}
          keyboardType="phone-pad"
          editable={!busy}
        />

        <Input
          label="Email (optional)"
          icon={Mail}
          placeholder="them@example.com"
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!busy}
        />

        <Input
          label="City (optional)"
          icon={MapPin}
          placeholder="City"
          value={city}
          onChangeText={setCity}
          autoCapitalize="words"
          editable={!busy}
        />

        <View>
          <Text variant="overline" tone="muted" caps style={{ marginBottom: space[2] }}>
            Interested in (optional)
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
            {PRODUCTS.map((item) => {
              const active = item === product;
              return (
                <Text
                  key={item}
                  variant="smallMedium"
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => setProduct(active ? '' : item)}
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

        <Input
          label="Notes (optional)"
          placeholder="Anything the RM should know before calling"
          value={remarks}
          onChangeText={setRemarks}
          multiline
          multilineHeight={100}
          maxLength={500}
          editable={!busy}
        />

        <Button
          label="Submit lead"
          icon={Send}
          onPress={() => void submit()}
          loading={busy}
          disabled={!validName || !validMobile}
          fullWidth
          size="lg"
        />
      </View>
    </Screen>
  );
}
