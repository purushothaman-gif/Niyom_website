/**
 * The first screen.
 *
 * Three ways in, and they are not three of the same thing — which is why the
 * layout does not treat them equally:
 *
 *   Client      sign in to an existing portfolio
 *   Partner     sign in to an existing DSA account
 *   New here    open an account, or ask about becoming a partner
 *
 * The two sign-ins are what a returning user wants, so they lead. "New to
 * Niyom" is given its own gold-edged panel underneath rather than a third
 * identical card: someone who has no account is not choosing between three
 * doors, they are looking for the one that is open to them.
 *
 * "Continue your application" sits with it, because a half-finished signup is a
 * new user's problem, not a returning client's — and on the website it is the
 * single most missed link on the sign-in page.
 */
import { Image, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { ArrowRight, ChevronRight, Clock, Handshake, Sparkles, Wallet } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { AuthLayout } from '@/features/auth/AuthLayout';
import { Text } from '@/ui/Text';

export default function Welcome() {
  const p = usePalette();

  return (
    <AuthLayout
      title="Your wealth,\nin one place"
      hideEyebrow
      brandMark
      subtitle="Portfolio, statements and investments — for clients and partners of Niyom Wealth."
      footer={
        <View style={{ gap: space[2], alignItems: 'center' }}>
          <Text variant="caption" tone="onBrandMuted" center>
            Niyom Wealth Distribution LLP · AMFI-registered mutual fund distributor
          </Text>
        </View>
      }
    >
      <View style={{ gap: space[5] }}>
        {/* ------------------------- Returning users ------------------------ */}
        <View style={{ gap: space[3] }}>
          <Text variant="overline" caps style={{ color: p.onBrand.textMuted }}>
            Sign in
          </Text>

          <SignInCard
            index={0}
            icon={Wallet}
            title="Client"
            body="Your portfolio, transactions and statements"
            onPress={() => router.push('/(auth)/client-login')}
          />
          <SignInCard
            index={1}
            icon={Handshake}
            title="Partner"
            body="Your sourced clients, payouts and leads"
            onPress={() => router.push('/(auth)/partner-login')}
          />
        </View>

        {/* ---------------------------- New here ---------------------------- */}
        <Animated.View entering={FadeInDown.duration(440).delay(300)} style={{ gap: space[3] }}>
          <Text variant="overline" caps style={{ color: p.onBrand.textMuted }}>
            New to Niyom Wealth?
          </Text>

          <Pressable
            onPress={() => {
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              router.push('/(auth)/get-started');
            }}
            accessibilityRole="button"
            accessibilityLabel="Open a free account"
            style={({ pressed }) => ({
              borderRadius: radius.lg,
              padding: space[5],
              backgroundColor: pressed ? 'rgba(200, 164, 93, 0.20)' : 'rgba(200, 164, 93, 0.12)',
              borderWidth: 1,
              borderColor: 'rgba(200, 164, 93, 0.42)',
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <Sparkles size={16} color={p.onBrand.gold} strokeWidth={2.2} />
              <Text variant="h3" style={{ color: p.onBrand.gold }}>
                Open a free account
              </Text>
            </View>
            <Text variant="small" tone="onBrandMuted" style={{ marginTop: space[2] }}>
              In minutes — just your PAN, name, mobile and email. No paperwork to start.
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space[1] + 2,
                marginTop: space[4],
              }}
            >
              <Text variant="smallMedium" style={{ color: p.onBrand.gold }}>
                Get started
              </Text>
              <ArrowRight size={15} color={p.onBrand.gold} strokeWidth={2.4} />
            </View>
          </Pressable>

          {/* The half-finished signup. Deliberately quiet but ALWAYS present:
              someone who stopped mid-KYC has no password yet, so neither
              sign-in card above can let them back in. */}
          <Pressable
            onPress={() => router.push('/(auth)/otp-login')}
            accessibilityRole="button"
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[3],
              paddingVertical: space[3],
              paddingHorizontal: space[4],
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: p.onBrand.border,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Clock size={17} color={p.onBrand.textMuted} strokeWidth={1.9} />
            <View style={{ flex: 1 }}>
              <Text variant="smallMedium" tone="onBrand">
                Continue your application
              </Text>
              <Text variant="caption" tone="onBrandMuted" style={{ marginTop: 1 }}>
                Already started? Sign in with an email code — no password needed.
              </Text>
            </View>
            <ChevronRight size={16} color={p.onBrand.textMuted} />
          </Pressable>
        </Animated.View>
      </View>
    </AuthLayout>
  );
}

function SignInCard({
  icon: Icon,
  title,
  body,
  onPress,
  index,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  onPress: () => void;
  index: number;
}) {
  const p = usePalette();

  return (
    <Animated.View entering={FadeInDown.duration(420).delay(120 + index * 80)}>
      <Pressable
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={`${title} sign in`}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[4],
          paddingVertical: space[4],
          paddingHorizontal: space[4],
          borderRadius: radius.lg,
          backgroundColor: pressed ? 'rgba(200, 164, 93, 0.12)' : p.onBrand.veil,
          borderWidth: 1,
          borderColor: p.onBrand.border,
        })}
      >
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(200, 164, 93, 0.14)',
          }}
        >
          <Icon size={20} color={p.onBrand.gold} strokeWidth={1.9} />
        </View>

        <View style={{ flex: 1 }}>
          <Text variant="h3" tone="onBrand">
            {title}
          </Text>
          <Text variant="caption" tone="onBrandMuted" style={{ marginTop: 2 }}>
            {body}
          </Text>
        </View>

        <ChevronRight size={18} color={p.onBrand.textMuted} />
      </Pressable>
    </Animated.View>
  );
}
