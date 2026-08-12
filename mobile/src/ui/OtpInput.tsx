/**
 * The six-digit code field.
 *
 * One hidden TextInput behind six drawn boxes. That combination is what makes
 * iOS and Android offer the code from the SMS/notification as an autofill
 * suggestion — six separate inputs get no such offer, and a client then types a
 * code they were shown a tap away from being filled in.
 */
import { useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { font, radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Text } from './Text';

export const OTP_LENGTH = 6;

export function OtpInput({
  value,
  onChange,
  onComplete,
  autoFocus = true,
  disabled,
  onBrand,
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  autoFocus?: boolean;
  disabled?: boolean;
  onBrand?: boolean;
}) {
  const p = usePalette();
  const ref = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);

  const set = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, OTP_LENGTH);
    onChange(digits);
    if (digits.length === OTP_LENGTH) onComplete?.(digits);
  };

  return (
    <Pressable onPress={() => ref.current?.focus()} disabled={disabled}>
      <View style={{ flexDirection: 'row', gap: space[2], justifyContent: 'center' }}>
        {Array.from({ length: OTP_LENGTH }).map((_, i) => {
          const char = value[i];
          // The "cursor" box is the next empty one — or the last, once full.
          const isCursor = focused && (i === value.length || (value.length === OTP_LENGTH && i === OTP_LENGTH - 1));
          return (
            <View
              key={i}
              style={{
                width: 46,
                height: 56,
                borderRadius: radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: onBrand ? p.onBrand.veil : p.bg.surface,
                borderWidth: isCursor ? 2 : 1,
                borderColor: isCursor
                  ? p.accent.DEFAULT
                  : onBrand
                    ? p.onBrand.border
                    : p.border.DEFAULT,
              }}
            >
              <Text
                style={{
                  fontFamily: font.displayBold,
                  fontSize: 24,
                  color: onBrand ? p.onBrand.text : p.text.primary,
                }}
              >
                {char ?? ''}
              </Text>
            </View>
          );
        })}
      </View>

      <TextInput
        ref={ref}
        value={value}
        onChangeText={set}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus={autoFocus}
        editable={!disabled}
        keyboardType="number-pad"
        maxLength={OTP_LENGTH}
        // What tells the OS this field is a one-time code.
        textContentType="oneTimeCode"
        autoComplete="one-time-code"
        importantForAutofill="yes"
        caretHidden
        style={{
          // Sized over the boxes rather than 0×0: a zero-size input is skipped
          // by some autofill implementations and cannot be tapped into.
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 56,
          opacity: 0,
        }}
      />
    </Pressable>
  );
}
