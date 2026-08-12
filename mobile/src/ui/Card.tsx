/**
 * The surface almost everything sits on.
 *
 * Three weights, matching how the website layers its navy ladder:
 *   elevated  the default card — sits on the app background
 *   surface   a control or input inside a card
 *   outline   a card with no fill, for grouping without adding a layer
 *
 * `pressable` swaps in a spring-scaled touch response. It is a separate prop
 * rather than "has an onPress" so a card holding its own buttons does not
 * animate when one of them is tapped.
 */
import { Pressable, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { radius, space } from '@/design/tokens';
import { useTheme } from '@/design/ThemeProvider';

export type CardWeight = 'elevated' | 'surface' | 'outline';

export interface CardProps extends ViewProps {
  weight?: CardWeight;
  /** Inner padding from the 4pt scale. `0` for cards holding full-bleed rows. */
  padding?: keyof typeof space;
  radiusToken?: keyof typeof radius;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Card({
  weight = 'elevated',
  padding = 4,
  radiusToken = 'lg',
  onPress,
  disabled,
  style,
  children,
  ...rest
}: CardProps) {
  const { theme: p, shadow } = useTheme();
  const scale = useSharedValue(1);

  const base: ViewStyle = {
    backgroundColor:
      weight === 'outline'
        ? 'transparent'
        : weight === 'surface'
          ? p.bg.surface
          : p.bg.elevated,
    borderRadius: radius[radiusToken],
    borderWidth: 1,
    borderColor: weight === 'surface' ? p.border.subtle : p.border.DEFAULT,
    padding: space[padding],
    ...(weight === 'elevated' ? shadow('card') : null),
  };

  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  if (!onPress) {
    return (
      <View {...rest} style={[base, style]}>
        {children}
      </View>
    );
  }

  return (
    <Animated.View style={animated}>
      <Pressable
        {...rest}
        onPress={onPress}
        disabled={disabled}
        // Springs rather than a timing curve: a card that eases back to rest
        // reads as a physical surface, which is the whole point of the gesture.
        onPressIn={() => {
          scale.value = withSpring(0.975, { damping: 22, stiffness: 380 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 22, stiffness: 380 });
        }}
        style={[base, disabled ? { opacity: 0.5 } : null, style]}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
