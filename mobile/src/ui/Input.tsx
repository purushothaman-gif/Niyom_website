/**
 * Text fields.
 *
 * One component rather than a raw TextInput per screen, because the details
 * that make a field feel native are the ones easiest to forget: a focus ring
 * that animates, an error that is announced rather than only coloured, and the
 * right keyboard for the content.
 *
 * `format="pan"` exists because a PAN is the login ID on both portals, and
 * typing one on a phone keyboard is the single most error-prone moment in the
 * app: it upper-cases as you type and refuses characters that cannot appear.
 */
import { forwardRef, useState } from 'react';
import {
  Pressable,
  TextInput,
  View,
  type TextInputProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Eye, EyeOff, type LucideIcon } from 'lucide-react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { font, radius, space, type } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Text } from './Text';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  error?: string | null;
  hint?: string;
  icon?: LucideIcon;
  /** Renders the show/hide toggle and starts obscured. */
  secure?: boolean;
  format?: 'pan' | 'digits' | 'amount';
  containerStyle?: StyleProp<ViewStyle>;
  /**
   * Height for a multi-line field. Passing it also top-aligns the text and the
   * icon — a 120pt box with the caret vertically centred looks broken.
   */
  multilineHeight?: number;
}

/** PAN is 5 letters, 4 digits, 1 letter — nothing else can be typed. */
function formatPan(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

export const Input = forwardRef<TextInput, InputProps>(function Input(
  {
    label,
    error,
    hint,
    icon: Icon,
    secure,
    format,
    containerStyle,
    multilineHeight,
    onChangeText,
    onFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  const [reveal, setReveal] = useState(false);
  const focus = useSharedValue(0);

  /*
   * Resolved HERE, on the JS thread, and only the finished strings cross into
   * the worklet below.
   *
   * `useAnimatedStyle` runs its body on the UI thread, where a plain JS
   * function does not exist. Calling `p.accent.tint(...)` inside it threw and
   * took the whole app down — and because that call sat behind a
   * `focus.value > 0.5` branch it never ran until a field was focused, so the
   * app looked fine until the first tap on the PAN box.
   *
   * The rule this encodes: a worklet may close over VALUES, never over
   * functions from outside Reanimated.
   */
  const idleBorder = error ? p.state.danger : p.border.DEFAULT;
  const activeBorder = error ? p.state.danger : p.accent.DEFAULT;
  // A ring rather than a thicker border: growing the border would reflow the
  // field by a pixel on every focus, which reads as a twitch.
  const focusRing = `0px 0px 0px 3px ${p.accent.tint(0.16)}`;

  const borderStyle = useAnimatedStyle(() => ({
    borderColor: interpolateColor(focus.value, [0, 1], [idleBorder, activeBorder]),
  }));

  const keyboardType: TextInputProps['keyboardType'] =
    format === 'digits' || format === 'amount'
      ? 'number-pad'
      : rest.keyboardType ?? 'default';

  return (
    <View style={containerStyle}>
      {label ? (
        <Text variant="overline" tone="muted" caps style={{ marginBottom: space[2] }}>
          {label}
        </Text>
      ) : null}

      <Animated.View
        style={[
          {
            flexDirection: 'row',
            alignItems: multilineHeight ? 'flex-start' : 'center',
            gap: space[2],
            backgroundColor: p.bg.surface,
            borderWidth: 1,
            borderRadius: radius.md,
            paddingHorizontal: space[4],
            height: multilineHeight ?? 52,
            paddingVertical: multilineHeight ? space[3] : 0,
          },
          borderStyle,
          // Driven by React state, not by the worklet — a shadow is not a prop
          // Reanimated can interpolate anyway, so there is nothing to gain by
          // moving it back onto the UI thread.
          focused && !error ? { boxShadow: focusRing } : null,
        ]}
      >
        {Icon ? (
          <Icon
            size={18}
            color={focused ? p.accent.DEFAULT : p.text.muted}
            style={multilineHeight ? { marginTop: 2 } : undefined}
          />
        ) : null}

        <TextInput
          ref={ref}
          {...rest}
          keyboardType={keyboardType}
          secureTextEntry={secure && !reveal}
          autoCapitalize={format === 'pan' ? 'characters' : rest.autoCapitalize}
          autoCorrect={format === 'pan' ? false : rest.autoCorrect}
          placeholderTextColor={p.text.placeholder}
          // Matches the palette so the caret and selection are not iOS blue.
          selectionColor={p.accent.DEFAULT}
          keyboardAppearance={p.scheme}
          onChangeText={(t) => onChangeText?.(format === 'pan' ? formatPan(t) : t)}
          onFocus={(e) => {
            setFocused(true);
            focus.value = withTiming(1, { duration: 160 });
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            focus.value = withTiming(0, { duration: 160 });
            onBlur?.(e);
          }}
          style={{
            flex: 1,
            color: p.text.primary,
            fontFamily: format === 'pan' ? font.displayMedium : font.body,
            fontSize: type.body.fontSize,
            letterSpacing: format === 'pan' ? 1.5 : 0,
            // Android centres poorly without this; iOS ignores it.
            paddingVertical: 0,
            ...(multilineHeight
              ? { height: '100%' as const, textAlignVertical: 'top' as const }
              : null),
          }}
        />

        {secure ? (
          <Pressable
            onPress={() => setReveal((v) => !v)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={reveal ? 'Hide password' : 'Show password'}
          >
            {reveal ? (
              <EyeOff size={18} color={p.text.muted} />
            ) : (
              <Eye size={18} color={p.text.muted} />
            )}
          </Pressable>
        ) : null}
      </Animated.View>

      {error ? (
        <Text variant="small" tone="danger" style={{ marginTop: space[2] }} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : hint ? (
        <Text variant="small" tone="muted" style={{ marginTop: space[2] }}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
});
