/**
 * The allocation donut.
 *
 * Drawn with react-native-svg arcs rather than a charting library: the geometry
 * is thirty lines, and a dependency would bring its own animation, theming and
 * gesture opinions to override.
 *
 * The centre is not decoration — it carries the total, which is the number
 * people actually read. A donut with an empty hole makes the eye compare arc
 * lengths, which nobody does accurately.
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import Svg, { Circle, G } from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { motion, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Text } from './Text';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

export interface DonutSlice {
  label: string;
  value: number;
  color?: string;
}

export function DonutChart({
  slices,
  size = 176,
  thickness = 22,
  centerLabel,
  centerValue,
}: {
  slices: DonutSlice[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const p = usePalette();
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;

  // Where each arc starts, as a running fraction of the whole.
  let offset = 0;
  const arcs = slices
    .filter((s) => s.value > 0)
    .map((s, i) => {
      const fraction = total > 0 ? s.value / total : 0;
      const arc = { ...s, fraction, start: offset, color: s.color ?? p.category[i % p.category.length] };
      offset += fraction;
      return arc;
    });

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        {/* Rotated so the first slice starts at twelve o'clock rather than three. */}
        <G rotation={-90} origin={`${size / 2}, ${size / 2}`}>
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={p.bg.raised}
            strokeWidth={thickness}
            fill="none"
          />
          {arcs.map((arc) => (
            <Arc
              key={arc.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              thickness={thickness}
              circumference={circumference}
              fraction={arc.fraction}
              start={arc.start}
              color={arc.color}
            />
          ))}
        </G>
      </Svg>

      {centerValue ? (
        <View style={{ alignItems: 'center', paddingHorizontal: space[4] }}>
          {centerLabel ? (
            <Text variant="caption" tone="muted" caps>
              {centerLabel}
            </Text>
          ) : null}
          <Text variant="moneySmall" style={{ marginTop: 2 }} numberOfLines={1}>
            {centerValue}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Arc({
  cx,
  cy,
  r,
  thickness,
  circumference,
  fraction,
  start,
  color,
}: {
  cx: number;
  cy: number;
  r: number;
  thickness: number;
  circumference: number;
  fraction: number;
  start: number;
  color: string;
}) {
  /*
   * Each arc is a full circle whose dash pattern shows only its own share, and
   * whose dash OFFSET rotates it to where that share begins. Growing the dash
   * from zero is what makes the whole ring draw itself on first paint.
   */
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, {
      duration: motion.slow,
      easing: Easing.bezier(...motion.easeOut),
    });
  }, [progress, fraction]);

  const animatedProps = useAnimatedProps(() => {
    const shown = fraction * progress.value * circumference;
    return {
      strokeDasharray: [shown, circumference - shown].join(' '),
      strokeDashoffset: -start * circumference,
    };
  });

  return (
    <AnimatedCircle
      cx={cx}
      cy={cy}
      r={r}
      stroke={color}
      strokeWidth={thickness}
      strokeLinecap="butt"
      fill="none"
      animatedProps={animatedProps}
    />
  );
}

/** The labelled rows beside or under a donut. */
export function DonutLegend({ slices }: { slices: DonutSlice[] }) {
  const p = usePalette();
  const total = slices.reduce((sum, s) => sum + Math.max(0, s.value), 0);

  return (
    <View style={{ gap: space[3], flex: 1 }}>
      {slices
        .filter((s) => s.value > 0)
        .map((s, i) => (
          <View key={s.label} style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
            <View
              style={{
                width: 9,
                height: 9,
                borderRadius: 999,
                backgroundColor: s.color ?? p.category[i % p.category.length],
              }}
            />
            <Text variant="small" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
              {s.label}
            </Text>
            <Text variant="smallMedium">
              {total > 0 ? `${((s.value / total) * 100).toFixed(1)}%` : '—'}
            </Text>
          </View>
        ))}
    </View>
  );
}
