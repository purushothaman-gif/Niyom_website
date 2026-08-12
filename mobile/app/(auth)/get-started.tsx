/**
 * Which kind of new.
 *
 * The two are not symmetric, and the screen says so rather than pretending
 * otherwise. Opening a CLIENT account is genuinely self-serve — PAN, name,
 * mobile, email, and the account exists a minute later. Becoming a PARTNER is
 * not: a DSA login is provisioned by a relationship manager after an
 * agreement, so there is no form that could create one, and offering a
 * lookalike signup would end in a dead screen.
 *
 * So the client path is a primary action and the partner path is an enquiry.
 */
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ArrowRight, BadgeCheck, Clock, Handshake, ShieldCheck, Zap } from 'lucide-react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { Button } from '@/ui/Button';
import { Text } from '@/ui/Text';

const POINTS = [
  { icon: Zap, text: 'Open in minutes — PAN, name, mobile and email' },
  { icon: ShieldCheck, text: 'KYC finished inside the app, at your pace' },
  { icon: BadgeCheck, text: 'No account-opening or maintenance charges' },
];

export default function GetStarted() {
  const p = usePalette();

  return (
    <AuthLayout
      eyebrow="New to Niyom Wealth"
      title="Let’s get you started"
      subtitle="Tell us which of these you are, and we will take the shortest route."
      onBack={() => router.back()}
      footer={
        <Pressable onPress={() => router.push('/(auth)/otp-login')} hitSlop={8}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], justifyContent: 'center' }}>
            <Clock size={15} color={p.onBrand.textMuted} />
            <Text variant="small" tone="onBrandMuted">
              Already started?{' '}
              <Text variant="smallMedium" style={{ color: p.onBrand.gold }}>
                Continue your application
              </Text>
            </Text>
          </View>
        </Pressable>
      }
    >
      <View style={{ gap: space[6] }}>
        {/* ---------------------------- New client -------------------------- */}
        <Animated.View entering={FadeInDown.duration(420)}>
          <View
            style={{
              borderRadius: radius.lg,
              padding: space[5],
              backgroundColor: 'rgba(200, 164, 93, 0.10)',
              borderWidth: 1,
              borderColor: 'rgba(200, 164, 93, 0.40)',
            }}
          >
            <Text variant="overline" caps style={{ color: p.onBrand.gold }}>
              I want to invest
            </Text>
            <Text variant="h2" tone="onBrand" style={{ marginTop: space[2] }}>
              Open a free account
            </Text>

            <View style={{ gap: space[3], marginTop: space[4] }}>
              {POINTS.map(({ icon: Icon, text }) => (
                <View key={text} style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
                  <Icon size={15} color={p.onBrand.gold} strokeWidth={2.1} />
                  <Text variant="small" tone="onBrandMuted" style={{ flex: 1 }}>
                    {text}
                  </Text>
                </View>
              ))}
            </View>

            <View style={{ marginTop: space[5] }}>
              <Button
                label="Open my account"
                icon={ArrowRight}
                iconRight
                onPress={() => router.push('/(auth)/signup')}
                fullWidth
                size="lg"
              />
            </View>
          </View>
        </Animated.View>

        {/* --------------------------- New partner -------------------------- */}
        <Animated.View entering={FadeInDown.duration(420).delay(100)}>
          <Pressable
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.push('/(auth)/partner-enquiry');
            }}
            accessibilityRole="button"
            style={({ pressed }) => ({
              borderRadius: radius.lg,
              padding: space[5],
              backgroundColor: pressed ? 'rgba(255,255,255,0.10)' : p.onBrand.veil,
              borderWidth: 1,
              borderColor: p.onBrand.border,
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
              <Handshake size={18} color={p.onBrand.textSecondary} strokeWidth={1.9} />
              <Text variant="overline" caps tone="onBrandMuted">
                I want to distribute
              </Text>
            </View>
            <Text variant="h3" tone="onBrand" style={{ marginTop: space[2] }}>
              Become a partner
            </Text>
            <Text variant="small" tone="onBrandMuted" style={{ marginTop: space[2] }}>
              Leave your details and our team calls you back. Partner logins are opened
              after an agreement, so this starts that conversation.
            </Text>
            <View
              style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] + 2, marginTop: space[4] }}
            >
              <Text variant="smallMedium" style={{ color: p.onBrand.gold }}>
                Become a partner today
              </Text>
              <ArrowRight size={14} color={p.onBrand.gold} strokeWidth={2.4} />
            </View>
          </Pressable>
        </Animated.View>
      </View>
    </AuthLayout>
  );
}
