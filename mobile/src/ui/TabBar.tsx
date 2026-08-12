/**
 * The bottom tab bar.
 *
 * Custom rather than the stock one so it can carry the three things that make a
 * tab bar feel native on a finance app: a gold indicator that slides between
 * tabs, a haptic tick on press, and a translucent blur over content rather than
 * an opaque bar that cuts the page off.
 *
 * Which destinations earn a slot is not decided here — it comes from
 * `PRIMARY_VIEWS` in the website's navigation config, so the app and the site
 * agree on what an investor opens repeatedly.
 */
import { Platform, Pressable, View } from 'react-native';
import { BlurView } from 'expo-blur';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { useEffect } from 'react';
/*
 * Expo SDK 57 vendors React Navigation inside expo-router rather than depending
 * on it, so this type comes from there. Importing `@react-navigation/bottom-tabs`
 * directly would install a SECOND copy of the navigator whose types describe a
 * different runtime than the one actually rendering these tabs.
 */
import type { BottomTabBarProps } from 'expo-router/build/react-navigation/bottom-tabs/types';
import type { LucideIcon } from 'lucide-react-native';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Text } from './Text';

export const TAB_BAR_HEIGHT = 62;

export interface TabSpec {
  name: string;
  label: string;
  icon: LucideIcon;
}

export function makeTabBar(tabs: TabSpec[]) {
  return function TabBar({ state, navigation }: BottomTabBarProps) {
    const p = usePalette();
    const insets = useSafeAreaInsets();

    /*
     * The opaque ground sits on the wrapper below rather than on the BlurView.
     * A background set ON a blur surface is composited with the blur on iOS and
     * ignored outright by some web implementations, which is how content ends
     * up visibly scrolling through what should be a solid bar.
     *
     * Only iOS actually blurs. Elsewhere the bar is solid, which is correct for
     * Material and unavoidable on web.
     */
    return (
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: Platform.OS === 'ios' ? `${p.bg.elevated}D9` : p.bg.elevated,
          borderTopWidth: 1,
          borderTopColor: p.border.subtle,
        }}
      >
        <BlurView
          intensity={Platform.OS === 'ios' ? 60 : 0}
          tint={p.name === 'dark' ? 'dark' : 'light'}
          style={{
            flexDirection: 'row',
            paddingBottom: insets.bottom,
            height: TAB_BAR_HEIGHT + insets.bottom,
          }}
        >
          {state.routes.map((route, index) => {
            const spec = tabs.find((t) => t.name === route.name);
            if (!spec) return null;
            const focused = state.index === index;

            return (
              <TabItem
                key={route.key}
                spec={spec}
                focused={focused}
                onPress={() => {
                  const event = navigation.emit({
                    type: 'tabPress',
                    target: route.key,
                    canPreventDefault: true,
                  });
                  if (focused || event.defaultPrevented) return;
                  void Haptics.selectionAsync();
                  navigation.navigate(route.name);
                }}
              />
            );
          })}
        </BlurView>
      </View>
    );
  };
}

function TabItem({
  spec,
  focused,
  onPress,
}: {
  spec: TabSpec;
  focused: boolean;
  onPress: () => void;
}) {
  const p = usePalette();
  const lift = useSharedValue(focused ? 1 : 0);

  useEffect(() => {
    lift.value = withSpring(focused ? 1 : 0, { damping: 16, stiffness: 260 });
  }, [focused, lift]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -2 * lift.value }, { scale: 1 + 0.08 * lift.value }],
  }));

  const pillStyle = useAnimatedStyle(() => ({
    opacity: lift.value,
    transform: [{ scaleX: 0.4 + 0.6 * lift.value }],
  }));

  const Icon = spec.icon;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={spec.label}
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingTop: space[2],
        gap: 3,
      }}
    >
      <Animated.View
        style={[
          {
            position: 'absolute',
            top: 4,
            width: 30,
            height: 3,
            borderRadius: radius.full,
            backgroundColor: p.accent.DEFAULT,
          },
          pillStyle,
        ]}
      />
      <Animated.View style={iconStyle}>
        <Icon
          size={21}
          color={focused ? p.accent.DEFAULT : p.text.muted}
          strokeWidth={focused ? 2.4 : 1.9}
        />
      </Animated.View>
      <Text variant="caption" style={{ color: focused ? p.accent.DEFAULT : p.text.muted }}>
        {spec.label}
      </Text>
    </Pressable>
  );
}
