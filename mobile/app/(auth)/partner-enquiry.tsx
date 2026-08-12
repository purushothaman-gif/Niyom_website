/**
 * Becoming a partner.
 *
 * Not a signup, because a partner account cannot be created by a form — a DSA
 * login is provisioned by a relationship manager after an agreement and an ARN
 * check. What this does is get the enquiry into the queue an admin already
 * works: it creates a lead in the CRM's ADMIN POOL (owner NULL), so an admin
 * assigns it rather than it landing silently with one RM.
 *
 * ## Why so few fields
 *
 * Name and mobile are all the CRM needs to start a conversation, and every
 * extra required field on a screen like this costs submissions. Email, city and
 * ARN are offered because they make the first call shorter, and are optional
 * because they do not make it possible.
 *
 * The direct routes stay on the success screen. Someone who would rather talk
 * now than wait for a call should not have to go looking.
 */
import { useState } from 'react';
import { Alert, Linking, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import {
  BadgeCheck,
  CheckCircle2,
  Mail,
  MapPin,
  MessageCircle,
  Phone,
  PhoneCall,
  UserRound,
  type LucideIcon,
} from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { SUPPORT_EMAIL, SUPPORT_PHONE, SUPPORT_PHONE_HREF } from '@shared/support/contact';
import { submitPartnerEnquiry } from '@/features/auth/authApi';
import { AuthLayout, AuthNotice } from '@/features/auth/AuthLayout';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Text } from '@/ui/Text';

const WHATSAPP = `https://wa.me/918939200110?text=${encodeURIComponent(
  'Hello Niyom Wealth, I would like to know about becoming a distribution partner.',
)}`;

const WHAT_HAPPENS = [
  'An admin reviews your enquiry and calls you back.',
  'We talk through the products you would distribute and how payouts work.',
  'Once the agreement is done, your partner login is enabled — you sign in here.',
];

export default function PartnerEnquiry() {
  const p = usePalette();

  const [fullName, setFullName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [arn, setArn] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ leadCode?: string } | null>(null);

  const validName = fullName.trim().length >= 2;
  const validMobile = /^[6-9]\d{9}$/.test(mobile);
  const validEmail = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const openLink = async (url: string, label: string) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      if (!(await Linking.canOpenURL(url))) throw new Error('unsupported');
      await Linking.openURL(url);
    } catch {
      Alert.alert(
        `Could not open ${label}`,
        `Please reach us on ${SUPPORT_PHONE} or ${SUPPORT_EMAIL}.`,
      );
    }
  };

  const submit = async () => {
    setError('');
    if (!validName) {
      setError('Please enter your name.');
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
    const { ok, data } = await submitPartnerEnquiry({
      full_name: fullName.trim(),
      mobile,
      email: email.trim().toLowerCase(),
      city: city.trim(),
      arn: arn.trim(),
    });
    setBusy(false);

    if (!ok) {
      setError(data?.error || 'Could not send your enquiry. Please try again.');
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // A duplicate is a success: someone is already on it, and saying so would
    // turn this into a way to test whether a number is in Niyom's CRM.
    setDone({ leadCode: data?.lead_code });
  };

  /* ------------------------------- success -------------------------------- */

  if (done) {
    return (
      <AuthLayout
        eyebrow="Become a partner"
        title="We’ve got it"
        subtitle="Our team will call you back. Here is your reference."
      >
        <Animated.View entering={FadeIn.duration(300)} style={{ gap: space[6] }}>
          <View
            style={{
              alignItems: 'center',
              gap: space[3],
              paddingVertical: space[6],
              borderRadius: radius.lg,
              backgroundColor: 'rgba(200, 164, 93, 0.10)',
              borderWidth: 1,
              borderColor: 'rgba(200, 164, 93, 0.35)',
            }}
          >
            <CheckCircle2 size={40} color={p.onBrand.gold} strokeWidth={1.7} />
            {done.leadCode ? (
              <>
                <Text variant="overline" caps tone="onBrandMuted">
                  Reference
                </Text>
                <Text variant="h2" style={{ color: p.onBrand.gold }}>
                  {done.leadCode}
                </Text>
              </>
            ) : (
              <Text variant="bodyMedium" tone="onBrand" center style={{ paddingHorizontal: space[5] }}>
                Your enquiry is with our team.
              </Text>
            )}
          </View>

          <View style={{ gap: space[3] }}>
            <Text variant="overline" caps tone="onBrandMuted">
              What happens next
            </Text>
            {WHAT_HAPPENS.map((line, i) => (
              <Step key={line} n={i + 1} text={line} />
            ))}
          </View>

          <View style={{ gap: space[3] }}>
            <Text variant="overline" caps tone="onBrandMuted">
              Rather talk now?
            </Text>
            <ContactRow
              icon={MessageCircle}
              title="WhatsApp"
              body="Usually the quickest reply"
              onPress={() => void openLink(WHATSAPP, 'WhatsApp')}
            />
            <ContactRow
              icon={PhoneCall}
              title="Call us"
              body={SUPPORT_PHONE}
              onPress={() => void openLink(SUPPORT_PHONE_HREF, 'the dialler')}
            />
          </View>

          <Button
            label="Back to sign in"
            variant="secondary"
            onBrand
            onPress={() => router.replace('/(auth)/welcome')}
            fullWidth
          />
        </Animated.View>
      </AuthLayout>
    );
  }

  /* -------------------------------- form ---------------------------------- */

  return (
    <AuthLayout
      eyebrow="Become a partner"
      title="Partner with Niyom"
      subtitle="Leave your details and our team will call you back to take it forward."
      onBack={() => router.back()}
      footer={
        <Text variant="caption" tone="onBrandMuted" center>
          Already a Niyom partner?{' '}
          <Text
            variant="caption"
            style={{ color: p.onBrand.gold }}
            onPress={() => router.replace('/(auth)/partner-login')}
          >
            Sign in here
          </Text>
        </Text>
      }
    >
      <View style={{ gap: space[4] }}>
        {error ? <AuthNotice message={error} /> : null}

        <Input
          label="Your name"
          icon={UserRound}
          placeholder="Full name"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
          autoComplete="name"
          textContentType="name"
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
          autoComplete="tel"
          textContentType="telephoneNumber"
          editable={!busy}
        />

        <Input
          label="Email (optional)"
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
        />

        <View style={{ flexDirection: 'row', gap: space[3] }}>
          <Input
            label="City (optional)"
            icon={MapPin}
            placeholder="City"
            value={city}
            onChangeText={setCity}
            autoCapitalize="words"
            editable={!busy}
            containerStyle={{ flex: 1 }}
          />
          <Input
            label="ARN (optional)"
            icon={BadgeCheck}
            placeholder="If you have one"
            value={arn}
            onChangeText={setArn}
            autoCapitalize="characters"
            autoCorrect={false}
            editable={!busy}
            containerStyle={{ flex: 1 }}
          />
        </View>

        <Button
          label="Send my enquiry"
          onPress={() => void submit()}
          loading={busy}
          disabled={!validName || !validMobile}
          fullWidth
          size="lg"
        />

        <Text variant="caption" tone="onBrandMuted" center>
          Partner logins are opened by our team after an agreement — this starts that
          conversation.
        </Text>
      </View>
    </AuthLayout>
  );
}

function Step({ n, text }: { n: number; text: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', gap: space[3] }}>
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: radius.full,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(200, 164, 93, 0.16)',
          marginTop: 1,
        }}
      >
        <Text variant="caption" style={{ color: p.onBrand.gold }}>
          {n}
        </Text>
      </View>
      <Text variant="small" tone="onBrandMuted" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}

function ContactRow({
  icon: Icon,
  title,
  body,
  onPress,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  onPress: () => void;
}) {
  const p = usePalette();
  return (
    <Animated.View entering={FadeInDown.duration(360)}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${title}: ${body}`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[4],
          padding: space[4],
          borderRadius: radius.lg,
          backgroundColor: pressed ? 'rgba(200, 164, 93, 0.14)' : p.onBrand.veil,
          borderWidth: 1,
          borderColor: p.onBrand.border,
        })}
      >
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(200, 164, 93, 0.14)',
          }}
        >
          <Icon size={19} color={p.onBrand.gold} strokeWidth={1.9} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyMedium" tone="onBrand">
            {title}
          </Text>
          <Text variant="caption" tone="onBrandMuted" style={{ marginTop: 1 }}>
            {body}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}
