/**
 * The underline tab strip that sits under a screen title.
 *
 * The pattern every Indian investing app uses at the top of a product section
 * — Explore / Dashboard / SIPs / Watchlist — and it earns its place: these are
 * four views of ONE product, so they belong inside the Mutual Funds screen
 * rather than as four entries in a bottom bar that also has to carry Home and
 * Portfolio.
 *
 * Horizontally scrollable, and the active tab is scrolled into view, so a fifth
 * or sixth tab can be added later without the layout having to change.
 */
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { font, motion, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Text } from './Text';

export interface TopTab<T extends string> {
  value: T;
  label: string;
  /** Small count pill, e.g. the number of items on a watchlist. */
  badge?: number;
}

export function TopTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: TopTab<T>[];
  value: T;
  onChange: (next: T) => void;
}) {
  const p = usePalette();
  const scroller = useRef<ScrollView>(null);
  // Where each tab starts and how wide it is, measured on layout.
  const layouts = useRef<Record<string, { x: number; width: number }>>({});

  const activeIndex = tabs.findIndex((t) => t.value === value);

  useEffect(() => {
    const l = layouts.current[value];
    if (!l) return;
    // Keep the selected tab visible when the strip is wider than the screen.
    scroller.current?.scrollTo({ x: Math.max(l.x - space[5], 0), animated: true });
  }, [value]);

  return (
    <View style={{ borderBottomWidth: 1, borderBottomColor: p.border.subtle }}>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: space[5] }}
      >
        {tabs.map((tab, i) => {
          const active = i === activeIndex;
          return (
            <Pressable
              key={tab.value}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onLayout={(e) => {
                const { x, width } = e.nativeEvent.layout;
                layouts.current[tab.value] = { x, width };
              }}
              onPress={() => {
                if (active) return;
                void Haptics.selectionAsync();
                onChange(tab.value);
              }}
              style={{ paddingVertical: space[3], marginRight: space[6] }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
                <Text
                  style={{
                    fontFamily: active ? font.displayBold : font.bodyMedium,
                    fontSize: 16,
                    color: active ? p.text.primary : p.text.muted,
                  }}
                >
                  {tab.label}
                </Text>
                {tab.badge ? (
                  <View
                    style={{
                      minWidth: 18,
                      paddingHorizontal: 5,
                      paddingVertical: 1,
                      borderRadius: 999,
                      backgroundColor: p.accent.tint(0.18),
                    }}
                  >
                    <Text variant="caption" tone="accent" style={{ textAlign: 'center' }}>
                      {tab.badge}
                    </Text>
                  </View>
                ) : null}
              </View>

              <Underline active={active} />
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * Sits flush with the strip's bottom border so the selected tab appears to
 * punch through it — the detail that makes this read as a tab bar rather than
 * as a row of words with a line underneath one of them.
 */
function Underline({ active }: { active: boolean }) {
  const p = usePalette();
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    progress.value = withTiming(active ? 1 : 0, { duration: motion.fast });
  }, [active, progress]);

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scaleX: 0.6 + 0.4 * progress.value }],
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: -1,
          height: 2.5,
          borderRadius: 2,
          backgroundColor: p.accent.DEFAULT,
        },
        style,
      ]}
    />
  );
}
