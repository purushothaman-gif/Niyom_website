/**
 * The NAV line, with a finger you can drag along it.
 *
 * An SVG path rather than a charting library. The data is a list of dates and
 * NAVs, the shape is a polyline, and the only interaction worth having is
 * scrubbing — which a library would wrap in its own gesture and theming
 * opinions to be overridden.
 *
 * ## Why the scrub reads a value rather than showing a tooltip
 *
 * A tooltip under a fingertip is under the finger. The read-out is pinned above
 * the chart instead, where it stays visible, and a haptic tick fires as the
 * selection moves so the value can be found without watching closely.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { fmtDate } from '@shared/crm/utils';
import { space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Text } from './Text';

export interface NavPoint {
  date: string;
  nav: number;
}

const HEIGHT = 150;

export function NavChart({ points, width = 320 }: { points: NavPoint[]; width?: number }) {
  const p = usePalette();
  const [selected, setSelected] = useState<number | null>(null);

  const { path, fill, coords, min, max } = useMemo(() => {
    const navs = points.map((pt) => pt.nav);
    const lo = Math.min(...navs);
    const hi = Math.max(...navs);
    // A flat series would divide by zero; give it a nominal band so the line
    // renders through the middle instead of collapsing onto the axis.
    const span = hi - lo || hi * 0.02 || 1;

    const xs = points.map((_, i) => (i / Math.max(points.length - 1, 1)) * width);
    const ys = points.map((pt) => HEIGHT - ((pt.nav - lo) / span) * (HEIGHT - 12) - 6);

    const line = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${ys[i].toFixed(2)}`).join(' ');
    const area = `${line} L${width},${HEIGHT} L0,${HEIGHT} Z`;

    return {
      path: line,
      fill: area,
      coords: xs.map((x, i) => ({ x, y: ys[i] })),
      min: lo,
      max: hi,
    };
  }, [points, width]);

  const rising = points.length > 1 && points[points.length - 1].nav >= points[0].nav;
  const stroke = rising ? p.state.successSoft : p.state.dangerSoft;

  const pick = (x: number) => {
    const index = Math.round((Math.max(0, Math.min(x, width)) / width) * (points.length - 1));
    setSelected((current) => {
      if (current !== index) void Haptics.selectionAsync();
      return index;
    });
  };

  const pan = Gesture.Pan()
    .onBegin((e) => runOnJS(pick)(e.x))
    .onUpdate((e) => runOnJS(pick)(e.x))
    .onFinalize(() => runOnJS(setSelected)(null));

  const active = selected != null ? points[selected] : null;

  return (
    <View>
      <View style={{ height: 34, justifyContent: 'center' }}>
        {active ? (
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space[2] }}>
            <Text variant="moneySmall">₹{active.nav.toFixed(4)}</Text>
            <Text variant="caption" tone="muted">
              {fmtDate(active.date)}
            </Text>
          </View>
        ) : (
          <Text variant="caption" tone="faint">
            Touch and drag the line to read a value
          </Text>
        )}
      </View>

      <GestureDetector gesture={pan}>
        <View>
          <Svg width={width} height={HEIGHT}>
            <Defs>
              <LinearGradient id="navFill" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0%" stopColor={stroke} stopOpacity={0.22} />
                <Stop offset="100%" stopColor={stroke} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Path d={fill} fill="url(#navFill)" />
            <Path d={path} stroke={stroke} strokeWidth={2} fill="none" strokeLinejoin="round" />
            {active && selected != null ? (
              <Circle
                cx={coords[selected].x}
                cy={coords[selected].y}
                r={4.5}
                fill={stroke}
                stroke={p.bg.elevated}
                strokeWidth={2}
              />
            ) : null}
          </Svg>
        </View>
      </GestureDetector>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space[2] }}>
        <Text variant="caption" tone="faint">
          ₹{min.toFixed(2)}
        </Text>
        <Text variant="caption" tone="faint">
          ₹{max.toFixed(2)}
        </Text>
      </View>
    </View>
  );
}
