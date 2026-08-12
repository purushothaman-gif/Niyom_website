/**
 * The title block on a pushed screen.
 *
 * Title and one line saying what the screen is FOR — the same pairing the
 * website uses in `VIEW_TITLES` / `VIEW_SUBTITLES`, because a title alone
 * leaves the reader to infer the purpose from the contents.
 *
 * The back control is drawn here rather than in a native header bar so the
 * whole screen can scroll as one surface, which is what makes a large title
 * collapse feel right.
 */
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Text } from '@/ui/Text';

export function ScreenHeader({
  title,
  subtitle,
  showBack,
  action,
}: {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  action?: ReactNode;
}) {
  const p = usePalette();

  return (
    <View style={{ marginBottom: space[6] }}>
      {showBack ? (
        <Pressable
          onPress={() => router.back()}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: p.bg.surface,
            borderWidth: 1,
            borderColor: p.border.subtle,
            marginBottom: space[4],
          }}
        >
          <ChevronLeft size={20} color={p.text.primary} />
        </Pressable>
      ) : null}

      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
        <View style={{ flex: 1 }}>
          <Text variant="h1">{title}</Text>
          {subtitle ? (
            <Text variant="small" tone="muted" style={{ marginTop: space[2] }}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        {action}
      </View>
    </View>
  );
}
