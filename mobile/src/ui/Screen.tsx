/**
 * The frame every screen sits in.
 *
 * Handles the four things each screen would otherwise re-solve: the safe area
 * (notch and home indicator), the keyboard pushing content up, pull-to-refresh,
 * and leaving room under the tab bar so the last row of a list is not hidden
 * behind it.
 *
 * `scroll={false}` for screens that own their own list — a FlatList inside a
 * ScrollView virtualises nothing and will stutter on a long portfolio.
 */
import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  ScrollView,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';

export interface ScreenProps {
  children: ReactNode;
  scroll?: boolean;
  /** Adds the standard 20pt gutter. Off for full-bleed headers. */
  padded?: boolean;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Leaves room for the bottom tab bar. */
  tabBarInset?: boolean;
  /** Skips the top safe-area pad — for screens with their own hero header. */
  edgeToEdge?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  style?: StyleProp<ViewStyle>;
}

/** The tab bar's height, so content can clear it. Keep in step with TabBar. */
export const TAB_BAR_HEIGHT = 62;

export function Screen({
  children,
  scroll = true,
  padded = true,
  onRefresh,
  refreshing = false,
  tabBarInset,
  edgeToEdge,
  contentStyle,
  style,
}: ScreenProps) {
  const p = usePalette();
  const insets = useSafeAreaInsets();

  const pad: ViewStyle = {
    paddingHorizontal: padded ? space[5] : 0,
    paddingTop: edgeToEdge ? 0 : insets.top + space[2],
    paddingBottom:
      insets.bottom + space[6] + (tabBarInset ? TAB_BAR_HEIGHT : 0),
  };

  const body = scroll ? (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={[pad, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? (
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={p.accent.DEFAULT}
            colors={[p.accent.DEFAULT]}
            progressBackgroundColor={p.bg.elevated}
          />
        ) : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, pad, contentStyle]}>{children}</View>
  );

  return (
    <KeyboardAvoidingView
      style={[{ flex: 1, backgroundColor: p.bg.base }, style]}
      // Android resizes the window itself; adding padding on top of that
      // double-counts the keyboard and leaves a gap above it.
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {body}
    </KeyboardAvoidingView>
  );
}
