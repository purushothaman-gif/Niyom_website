/**
 * Typography.
 *
 * Every piece of text in the app goes through here rather than through RN's
 * `Text`, so a screen cannot accidentally ship the system font: React Native
 * silently falls back to San Francisco or Roboto when a `fontFamily` is missing,
 * which looks fine in isolation and wrong beside anything using Space Grotesk.
 */
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from 'react-native';
import { type } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';

export type TextVariant = keyof typeof type;
export type TextTone =
  | 'primary'
  | 'secondary'
  | 'muted'
  | 'faint'
  | 'accent'
  | 'success'
  | 'danger'
  | 'warning'
  | 'onAccent'
  | 'onBrand'
  | 'onBrandMuted';

export interface TextProps extends RNTextProps {
  variant?: TextVariant;
  tone?: TextTone;
  /** Uppercases and applies the overline tracking. Use with `variant="overline"`. */
  caps?: boolean;
  center?: boolean;
}

export function Text({
  variant = 'body',
  tone = 'primary',
  caps,
  center,
  style,
  children,
  ...rest
}: TextProps) {
  const p = usePalette();

  const color: Record<TextTone, string> = {
    primary: p.text.primary,
    secondary: p.text.secondary,
    muted: p.text.muted,
    faint: p.text.faint,
    accent: p.accent.DEFAULT,
    success: p.state.successSoft,
    danger: p.state.dangerSoft,
    warning: p.state.warningSoft,
    onAccent: p.text.onAccent,
    onBrand: p.onBrand.text,
    onBrandMuted: p.onBrand.textSecondary,
  };

  const base: TextStyle = {
    ...type[variant],
    color: color[tone],
    ...(caps ? { textTransform: 'uppercase' as const } : null),
    ...(center ? { textAlign: 'center' as const } : null),
  };

  return (
    <RNText {...rest} style={[base, style]}>
      {children}
    </RNText>
  );
}
