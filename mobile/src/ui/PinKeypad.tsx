/**
 * The 4-digit PIN keypad.
 *
 * Its own keypad rather than a numeric TextInput, for three reasons that all
 * matter on the unlock screen: the OS keyboard takes half a second to animate
 * in, it can be a third-party keyboard the client did not choose to type a PIN
 * on, and a hardware-backed layout lets the dots, the shake and the biometric
 * button live in one place.
 *
 * The component holds no policy. It reports a completed 4 digits and shakes
 * when told to; how many tries are left and what happens next is the server's
 * business — see the `*-pin-login` edge functions, which do the counting.
 */
import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Delete, Fingerprint, ScanFace } from 'lucide-react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { font, radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Text } from './Text';

export const PIN_LENGTH = 4;

export interface PinKeypadProps {
  value: string;
  onChange: (next: string) => void;
  /** Fired the moment the fourth digit lands. */
  onComplete: (pin: string) => void;
  /** Bump to shake the dots and clear them — a rejected PIN. */
  shakeToken?: number;
  disabled?: boolean;
  /** Shows the biometric key in the bottom-left. */
  biometric?: { kind: 'face' | 'fingerprint'; onPress: () => void } | null;
  /** Replaces the biometric key when there is none — e.g. "Use password". */
  secondaryAction?: { label: string; onPress: () => void } | null;
  /** Drawn for a navy panel regardless of theme. */
  onBrand?: boolean;
}

export function PinKeypad({
  value,
  onChange,
  onComplete,
  shakeToken = 0,
  disabled,
  biometric,
  secondaryAction,
  onBrand,
}: PinKeypadProps) {
  const p = usePalette();
  const shake = useSharedValue(0);

  const fg = onBrand ? p.onBrand.text : p.text.primary;
  const dim = onBrand ? p.onBrand.textMuted : p.text.muted;
  const keyBg = onBrand ? p.onBrand.veil : p.bg.surface;
  const keyBorder = onBrand ? p.onBrand.border : p.border.DEFAULT;

  useEffect(() => {
    if (shakeToken === 0) return;
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    shake.value = withSequence(
      withTiming(-9, { duration: 45 }),
      withTiming(9, { duration: 45 }),
      withTiming(-6, { duration: 45 }),
      withTiming(6, { duration: 45 }),
      withTiming(0, { duration: 45 }),
    );
  }, [shakeToken, shake]);

  const shakeStyle = useAnimatedStyle(() => ({ transform: [{ translateX: shake.value }] }));

  const press = (digit: string) => {
    if (disabled || value.length >= PIN_LENGTH) return;
    void Haptics.selectionAsync();
    const next = value + digit;
    onChange(next);
    if (next.length === PIN_LENGTH) onComplete(next);
  };

  const back = () => {
    if (disabled || value.length === 0) return;
    void Haptics.selectionAsync();
    onChange(value.slice(0, -1));
  };

  return (
    <View style={{ gap: space[7], alignItems: 'center' }}>
      {/* Dots */}
      <Animated.View style={[{ flexDirection: 'row', gap: space[4] }, shakeStyle]}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <Dot key={i} filled={i < value.length} onBrand={onBrand} />
        ))}
      </Animated.View>

      {/* Keys */}
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'center',
          width: 264,
          gap: space[4],
        }}
      >
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <Key key={d} onPress={() => press(d)} bg={keyBg} border={keyBorder} disabled={disabled}>
            <Text style={{ fontFamily: font.displayMedium, fontSize: 26, color: fg }}>{d}</Text>
          </Key>
        ))}

        {biometric ? (
          <Key onPress={biometric.onPress} bg="transparent" border="transparent" disabled={disabled}>
            {biometric.kind === 'face' ? (
              <ScanFace size={28} color={p.accent.DEFAULT} strokeWidth={1.8} />
            ) : (
              <Fingerprint size={28} color={p.accent.DEFAULT} strokeWidth={1.8} />
            )}
          </Key>
        ) : secondaryAction ? (
          <Key
            onPress={secondaryAction.onPress}
            bg="transparent"
            border="transparent"
            disabled={disabled}
          >
            <Text variant="caption" style={{ color: dim, textAlign: 'center' }}>
              {secondaryAction.label}
            </Text>
          </Key>
        ) : (
          <View style={{ width: 72, height: 72 }} />
        )}

        <Key onPress={() => press('0')} bg={keyBg} border={keyBorder} disabled={disabled}>
          <Text style={{ fontFamily: font.displayMedium, fontSize: 26, color: fg }}>0</Text>
        </Key>

        <Key onPress={back} bg="transparent" border="transparent" disabled={disabled}>
          <Delete size={24} color={dim} strokeWidth={1.8} />
        </Key>
      </View>
    </View>
  );
}

function Dot({ filled, onBrand }: { filled: boolean; onBrand?: boolean }) {
  const p = usePalette();
  const scale = useSharedValue(filled ? 1 : 0.55);

  useEffect(() => {
    scale.value = withSpring(filled ? 1 : 0.55, { damping: 12, stiffness: 320 });
  }, [filled, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View
      style={[
        {
          width: 14,
          height: 14,
          borderRadius: radius.full,
          borderWidth: 1.5,
          borderColor: filled ? p.accent.DEFAULT : onBrand ? p.onBrand.border : p.border.strong,
          backgroundColor: filled ? p.accent.DEFAULT : 'transparent',
        },
        style,
      ]}
    />
  );
}

function Key({
  children,
  onPress,
  bg,
  border,
  disabled,
}: {
  children: React.ReactNode;
  onPress: () => void;
  bg: string;
  border: string;
  disabled?: boolean;
}) {
  const scale = useSharedValue(1);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <Animated.View style={style}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        onPressIn={() => {
          scale.value = withSpring(0.9, { damping: 15, stiffness: 500 });
        }}
        onPressOut={() => {
          scale.value = withSpring(1, { damping: 15, stiffness: 500 });
        }}
        style={{
          width: 72,
          height: 72,
          borderRadius: radius.full,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: bg,
          borderWidth: border === 'transparent' ? 0 : 1,
          borderColor: border,
          opacity: disabled ? 0.4 : 1,
        }}
      >
        {children}
      </Pressable>
    </Animated.View>
  );
}
