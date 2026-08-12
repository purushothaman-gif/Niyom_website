/**
 * The navy panel every sign-in screen sits on.
 *
 * The website gives the login pages a deep-navy brand rail down the left. There
 * is no room for a rail on a phone, so the whole screen becomes the rail: the
 * same `--brand-panel-bg` gradient, the same gold, and the same three-line
 * promise — which also means the sign-in screens look identical in light mode
 * and dark, as a brand surface should.
 */
import type { ReactNode } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft } from 'lucide-react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Text } from '@/ui/Text';

export interface AuthLayoutProps {
  /** Optional so a screen can render the bare panel while it decides what to
   *  show — which keeps the brand navy on screen instead of a white flash. */
  children?: ReactNode;
  title: string;
  subtitle?: string;
  /** The small caption above the title, e.g. "CLIENT PORTAL". */
  eyebrow?: string;
  /** Suppresses the eyebrow slot entirely — for the logo-led welcome screen. */
  hideEyebrow?: boolean;
  /** Shows the Niyom mark and wordmark above the title. */
  brandMark?: boolean;
  onBack?: () => void;
  /** Pinned to the bottom, clear of the keyboard — links and sign-up prompts. */
  footer?: ReactNode;
}

export function AuthLayout({
  children,
  title,
  subtitle,
  eyebrow,
  hideEyebrow,
  brandMark,
  onBack,
  footer,
}: AuthLayoutProps) {
  const p = usePalette();
  const insets = useSafeAreaInsets();

  return (
    <LinearGradient
      colors={[...p.onBrand.gradient]}
      start={{ x: 0.1, y: 0 }}
      end={{ x: 0.9, y: 1 }}
      style={{ flex: 1 }}
    >
      {/*
       * A soft gold bloom behind the heading. Purely atmospheric, but it is what
       * stops a full-bleed navy screen reading as a flat rectangle.
       *
       * An SVG radial gradient rather than a translucent circle: a flat fill has
       * a hard edge wherever it ends, and at 10% opacity on navy that edge reads
       * as a grey disc someone forgot to remove rather than as light.
       */}
      <Svg
        pointerEvents="none"
        style={{ position: 'absolute', top: -180, right: -140, width: 420, height: 420 }}
        width={420}
        height={420}
      >
        <Defs>
          <RadialGradient id="bloom" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor="#c8a45d" stopOpacity={0.22} />
            <Stop offset="55%" stopColor="#c8a45d" stopOpacity={0.07} />
            <Stop offset="100%" stopColor="#c8a45d" stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={210} cy={210} r={210} fill="url(#bloom)" />
      </Svg>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingTop: insets.top + space[4],
            paddingBottom: insets.bottom + space[6],
            paddingHorizontal: space[6],
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {onBack ? (
            <Pressable
              onPress={onBack}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Go back"
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.full,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: p.onBrand.veil,
                borderWidth: 1,
                borderColor: p.onBrand.border,
                marginBottom: space[5],
              }}
            >
              <ChevronLeft size={20} color={p.onBrand.text} />
            </Pressable>
          ) : (
            <View style={{ height: space[6] }} />
          )}

          <Animated.View entering={FadeIn.duration(400)}>
            {brandMark ? (
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space[3],
                  marginBottom: space[6],
                }}
              >
                <Image
                  source={require('../../../assets/niyom-mark.png')}
                  style={{ width: 40, height: 40 }}
                  resizeMode="contain"
                  accessibilityIgnoresInvertColors
                />
                <View>
                  <Text variant="h3" style={{ color: p.onBrand.gold }}>
                    Niyom Wealth
                  </Text>
                  <Text variant="caption" tone="onBrandMuted">
                    Distribution LLP
                  </Text>
                </View>
              </View>
            ) : null}

            {eyebrow && !hideEyebrow ? (
              <Text
                variant="overline"
                caps
                style={{ color: p.onBrand.gold, marginBottom: space[2] }}
              >
                {eyebrow}
              </Text>
            ) : null}
            {/* `\n` in a title is honoured so a screen can control where a long
                heading breaks, rather than leaving it to the viewport width. */}
            <Text variant="hero" tone="onBrand">
              {title.replace(/\\n/g, '\n')}
            </Text>
            {subtitle ? (
              <Text variant="body" tone="onBrandMuted" style={{ marginTop: space[2] }}>
                {subtitle}
              </Text>
            ) : null}
          </Animated.View>

          <Animated.View
            entering={FadeInDown.duration(450).delay(80)}
            style={{ marginTop: space[7], flex: 1 }}
          >
            {children}
          </Animated.View>

          {footer ? <View style={{ marginTop: space[6] }}>{footer}</View> : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </LinearGradient>
  );
}

/**
 * An error or notice on the navy panel.
 *
 * `polite` rather than `assertive`: a wrong password is not an emergency, and
 * an assertive region interrupts whatever VoiceOver is mid-sentence on.
 */
export function AuthNotice({
  message,
  tone = 'error',
}: {
  message: string;
  tone?: 'error' | 'success' | 'info';
}) {
  const p = usePalette();
  const color =
    tone === 'error' ? p.state.dangerSoft : tone === 'success' ? p.state.successSoft : p.onBrand.gold;

  return (
    <View
      accessibilityLiveRegion="polite"
      style={{
        backgroundColor: `${color}1A`,
        borderColor: `${color}40`,
        borderWidth: 1,
        borderRadius: radius.md,
        paddingHorizontal: space[4],
        paddingVertical: space[3],
      }}
    >
      <Text variant="small" style={{ color }}>
        {message}
      </Text>
    </View>
  );
}
