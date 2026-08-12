/**
 * Buttons.
 *
 * `primary` is the gold gradient — one per screen, on the action the screen
 * exists for. `secondary` is a bordered surface, `ghost` is text only, and
 * `danger` is reserved for the two irreversible things a client can do
 * (signing out, cancelling an order).
 *
 * Every press fires a haptic. On a finance app that is not decoration: it is
 * the confirmation that a tap on "Invest" registered, before the network has
 * had time to say anything.
 */
import { ActivityIndicator, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import type { LucideIcon } from 'lucide-react-native';
import { font, radius, space } from '@/design/tokens';
import { useTheme } from '@/design/ThemeProvider';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  /** Puts the icon after the label — for "Continue →" style actions. */
  iconRight?: boolean;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  /** Draws for a navy panel regardless of theme (the sign-in hero). */
  onBrand?: boolean;
}

const HEIGHT: Record<ButtonSize, number> = { sm: 38, md: 48, lg: 54 };

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  iconRight,
  loading,
  disabled,
  fullWidth,
  style,
  onBrand,
}: ButtonProps) {
  const { theme: p, shadow } = useTheme();
  const scale = useSharedValue(1);
  const isDisabled = disabled || loading;

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const height = HEIGHT[size];
  const textVariant = size === 'sm' ? 'smallMedium' : 'bodyMedium';
  const iconSize = size === 'sm' ? 15 : 17;

  const shell: ViewStyle = {
    height,
    borderRadius: radius.md,
    paddingHorizontal: size === 'sm' ? space[3] : space[5],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
    ...(fullWidth ? { alignSelf: 'stretch' } : null),
  };

  const fg =
    variant === 'primary'
      ? p.text.onAccent
      : variant === 'danger'
        ? p.state.danger
        : onBrand
          ? p.onBrand.gold
          : variant === 'ghost'
            ? p.accent.DEFAULT
            : p.text.primary;

  const content = (
    <>
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          {Icon && !iconRight ? <Icon size={iconSize} color={fg} strokeWidth={2.2} /> : null}
          <Text variant={textVariant} style={{ color: fg, fontFamily: font.bodySemi }}>
            {label}
          </Text>
          {Icon && iconRight ? <Icon size={iconSize} color={fg} strokeWidth={2.2} /> : null}
        </>
      )}
    </>
  );

  return (
    <Animated.View style={[animated, fullWidth ? { alignSelf: 'stretch' } : null, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!isDisabled, busy: !!loading }}
        disabled={isDisabled}
        onPress={() => {
          void Haptics.impactAsync(
            variant === 'primary' ? Haptics.ImpactFeedbackStyle.Medium : Haptics.ImpactFeedbackStyle.Light,
          );
          onPress();
        }}
        onPressIn={() => {
          scale.value = withSpring(0.97, { damping: 20, stiffness: 400 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 20, stiffness: 400 });
        }}
        style={{ opacity: isDisabled ? 0.45 : 1 }}
      >
        {variant === 'primary' ? (
          <LinearGradient
            colors={[...p.accent.gradient]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[shell, shadow('sm')]}
          >
            {content}
          </LinearGradient>
        ) : (
          <View
            style={[
              shell,
              {
                backgroundColor:
                  variant === 'ghost'
                    ? 'transparent'
                    : onBrand
                      ? p.onBrand.veil
                      : p.bg.surface,
                borderWidth: variant === 'ghost' ? 0 : 1,
                borderColor:
                  variant === 'danger'
                    ? p.state.danger
                    : onBrand
                      ? p.onBrand.border
                      : p.border.strong,
              },
            ]}
          >
            {content}
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}
