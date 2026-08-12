/**
 * Money, and the change in it.
 *
 * `Money` animates from the previous value to the new one on refresh. That is
 * not ornament: a portfolio total that simply swaps digits gives no signal that
 * anything happened, so a client pulls to refresh twice. Counting up says the
 * number is live.
 *
 * Formatting is `fmt` / `fmtFull` from `shared/crm/utils` — the SAME functions
 * the website uses, so ₹14.19 L on this screen is ₹14.19 L on niyomwealth.com
 * rather than two roundings that happen to usually agree.
 */
import { useEffect, useState } from 'react';
import { View, type StyleProp, type TextStyle } from 'react-native';
import { TrendingDown, TrendingUp } from 'lucide-react-native';
import {
  useAnimatedReaction,
  useSharedValue,
  withTiming,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import { fmt, fmtFull } from '@shared/crm/utils';
import { motion, space, type } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Text, type TextTone, type TextVariant } from './Text';

export interface MoneyProps {
  value: number;
  /** `full` writes every rupee; `short` uses the L / Cr abbreviation. */
  precision?: 'short' | 'full';
  variant?: TextVariant;
  tone?: TextTone;
  /** Counts from the previous value. Off for static figures in tables. */
  animate?: boolean;
  style?: StyleProp<TextStyle>;
}

export function Money({
  value,
  precision = 'short',
  variant = 'money',
  tone = 'primary',
  animate = false,
  style,
}: MoneyProps) {
  const format = precision === 'full' ? fmtFull : fmt;
  const [shown, setShown] = useState(value);
  const progress = useSharedValue(value);

  useEffect(() => {
    if (!animate) {
      setShown(value);
      return;
    }
    progress.value = withTiming(value, {
      duration: motion.slow,
      easing: Easing.bezier(...motion.easeOut),
    });
  }, [value, animate, progress]);

  /*
   * The formatted string is rebuilt on the JS thread rather than in a worklet:
   * `fmt` is shared with the website and uses Intl, which is not worklet-safe.
   * At 60fps over 400ms that is ~24 updates — cheap, and it keeps ONE formatter
   * in the codebase rather than a second, subtly different native one.
   */
  useAnimatedReaction(
    () => progress.value,
    (current) => {
      runOnJS(setShown)(current);
    },
    [animate],
  );

  return (
    <Text variant={variant} tone={tone} style={style}>
      {format(animate ? shown : value)}
    </Text>
  );
}

/**
 * A gain or loss: the amount, the percentage, and an arrow.
 *
 * Colour alone is not allowed to carry the meaning — roughly 1 in 12 men cannot
 * separate the red from the green — so the arrow and the explicit sign do the
 * work and the colour reinforces it.
 */
export function Delta({
  amount,
  percent,
  variant = 'smallMedium',
  showAmount = true,
}: {
  amount: number;
  percent?: number | null;
  variant?: TextVariant;
  showAmount?: boolean;
}) {
  const p = usePalette();
  const up = amount >= 0;
  const color = up ? p.state.successSoft : p.state.dangerSoft;
  const Icon = up ? TrendingUp : TrendingDown;
  const iconSize = type[variant].fontSize + 1;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] + 2 }}>
      <Icon size={iconSize} color={color} strokeWidth={2.4} />
      <Text variant={variant} style={{ color }}>
        {showAmount ? `${up ? '+' : '−'}${fmt(Math.abs(amount))}` : ''}
        {percent != null && Number.isFinite(percent)
          ? `${showAmount ? '  ' : ''}${up ? '+' : '−'}${Math.abs(percent).toFixed(2)}%`
          : ''}
      </Text>
    </View>
  );
}
