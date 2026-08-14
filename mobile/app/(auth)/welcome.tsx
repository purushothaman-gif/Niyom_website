/**
 * The launch screen.
 *
 * ## Why this does not look like the website's landing page
 *
 * It used to: a scrolling column of headline, sub-headline, three cards and a
 * legal footer. That is a web page, and on a phone it reads as one — a lot of
 * reading before the one thing anyone came here to do.
 *
 * An app opens on the ACTION. So the brand sits in a compact lockup at the top,
 * the two sign-ins are large tap targets in the lower half where a thumb rests,
 * and everything else is one line. Nothing scrolls unless the screen is small.
 *
 * ## And why the PIN keypad can appear instead
 *
 * On a phone that already has a PIN saved, this screen is skipped entirely —
 * the launch router sends them to the keypad. This is the first-run screen, and
 * for most people it is seen once.
 */
import { useEffect, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import {
  ArrowRight,
  ChevronRight,
  Fingerprint,
  Handshake,
  LineChart,
  ShieldCheck,
  Wallet,
} from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { listProfiles } from '@/platform/device';
import { font, radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Text } from '@/ui/Text';

export default function Welcome() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [hasPin, setHasPin] = useState(false);

  useEffect(() => {
    // If a PIN exists on this device, offer the fast way back in.
    void Promise.all([listProfiles('client'), listProfiles('partner')]).then(([c, d]) =>
      setHasPin(c.length + d.length > 0),
    );
  }, []);

  return (
    <LinearGradient
      colors={[...p.onBrand.gradient]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={{ flex: 1 }}
    >
      <Svg
        pointerEvents="none"
        style={{ position: 'absolute', top: -200, right: -160, width: 460, height: 460 }}
        width={460}
        height={460}
      >
        <Defs>
          <RadialGradient id="bloom" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#c8a45d" stopOpacity={0.24} />
            <Stop offset="55%" stopColor="#c8a45d" stopOpacity={0.07} />
            <Stop offset="100%" stopColor="#c8a45d" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={230} cy={230} r={230} fill="url(#bloom)" />
      </Svg>

      <View
        style={{
          flex: 1,
          paddingHorizontal: space[6],
          paddingTop: insets.top + space[8],
          paddingBottom: insets.bottom + space[5],
        }}
      >
        {/* --------------------------- brand lockup ---------------------- */}
        <Animated.View entering={FadeIn.duration(420)} style={{ alignItems: 'center' }}>
          <Image
            source={require('../../assets/niyom-mark.png')}
            style={{ width: 76, height: 66 }}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
          <Text
            style={{
              fontFamily: font.displayBold,
              fontSize: 27,
              letterSpacing: -0.4,
              color: p.onBrand.gold,
              marginTop: space[4],
            }}
          >
            Niyom Wealth
          </Text>
          <Text variant="small" tone="onBrandMuted" center style={{ marginTop: space[2] }}>
            Your portfolio, in your pocket
          </Text>
        </Animated.View>

        {/*
          The middle carries three facts and nothing else. The buttons still sit
          in the thumb zone, but the space above them says something rather than
          being blank — and three short lines is not a landing page.
        */}
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <Animated.View entering={FadeIn.duration(500).delay(160)} style={{ gap: space[5] }}>
            <Point icon={ShieldCheck} text="AMFI-registered mutual fund distributor" />
            <Point icon={Fingerprint} text="Unlock with a PIN or your fingerprint" />
            <Point icon={LineChart} text="Every holding, valued at the latest NAV" />
          </Animated.View>
        </View>

        {/* ----------------------------- actions ------------------------- */}
        <View style={{ gap: space[3] }}>
          {hasPin ? (
            <Animated.View entering={FadeInDown.duration(380)}>
              <Pressable
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push('/(auth)/client-login');
                }}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: space[2],
                  paddingVertical: space[4],
                  borderRadius: radius.md,
                  backgroundColor: pressed ? 'rgba(200,164,93,0.26)' : 'rgba(200,164,93,0.16)',
                  borderWidth: 1,
                  borderColor: 'rgba(200,164,93,0.45)',
                })}
              >
                <Text variant="bodyMedium" style={{ color: p.onBrand.gold }}>
                  Unlock with your PIN
                </Text>
                <ArrowRight size={16} color={p.onBrand.gold} strokeWidth={2.4} />
              </Pressable>
            </Animated.View>
          ) : null}

          <Choice
            index={0}
            icon={Wallet}
            title="I'm a client"
            body="Portfolio, statements, investments"
            onPress={() => router.push('/(auth)/client-login')}
          />
          <Choice
            index={1}
            icon={Handshake}
            title="I'm a partner"
            body="Clients, payouts, leads"
            onPress={() => router.push('/(auth)/partner-login')}
          />

          <Animated.View entering={FadeInDown.duration(400).delay(220)}>
            <Pressable
              onPress={() => router.push('/(auth)/get-started')}
              style={({ pressed }) => ({
                paddingVertical: space[4],
                alignItems: 'center',
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Text variant="small" tone="onBrandMuted">
                New here?{' '}
                <Text variant="bodyMedium" style={{ color: p.onBrand.gold }}>
                  Open a free account
                </Text>
              </Text>
            </Pressable>
          </Animated.View>
        </View>
      </View>
    </LinearGradient>
  );
}

function Choice({
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
    <Animated.View entering={FadeInDown.duration(400).delay(80 + index * 70)}>
      <Pressable
        onPress={() => {
          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={title}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[4],
          // 68pt tall — a deliberate, comfortable target rather than a link.
          paddingVertical: space[4],
          paddingHorizontal: space[4],
          borderRadius: radius.lg,
          backgroundColor: pressed ? 'rgba(255,255,255,0.10)' : p.onBrand.veil,
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
            backgroundColor: 'rgba(200,164,93,0.14)',
          }}
        >
          <Icon size={20} color={p.onBrand.gold} strokeWidth={1.9} />
        </View>

        <View style={{ flex: 1 }}>
          <Text variant="h3" tone="onBrand">
            {title}
          </Text>
          <Text variant="caption" tone="onBrandMuted" style={{ marginTop: 1 }}>
            {body}
          </Text>
        </View>

        <ChevronRight size={18} color={p.onBrand.textMuted} />
      </Pressable>
    </Animated.View>
  );
}

/** One short fact. Icon, a line of text, nothing else. */
function Point({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[4] }}>
      <Icon size={17} color={p.onBrand.gold} strokeWidth={1.9} />
      <Text variant="small" tone="onBrandMuted" style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}
