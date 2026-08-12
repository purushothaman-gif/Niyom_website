/**
 * The line at the top of the dashboard.
 *
 * A greeting rather than a page title, because "Wealth Dashboard" tells someone
 * nothing they did not know from tapping Home. The freshness stamp beside it is
 * the part that earns its place: it says whether what is on screen is current,
 * which on a portfolio screen is the difference between a figure and a guess.
 */
import { Pressable, View } from 'react-native';
import { Bell } from 'lucide-react-native';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Text } from '@/ui/Text';

export function GreetingHeader({
  name,
  refreshedAt,
  onNotifications,
}: {
  name: string;
  refreshedAt: Date | null;
  onNotifications?: () => void;
}) {
  const p = usePalette();

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        marginBottom: space[6],
      }}
    >
      <View style={{ flex: 1 }}>
        <Text variant="small" tone="muted">
          {timeOfDay()}
        </Text>
        <Text variant="h1" numberOfLines={1} style={{ marginTop: 2 }}>
          {firstName(name) || 'Welcome'}
        </Text>
        {refreshedAt ? (
          <Text variant="caption" tone="faint" style={{ marginTop: 3 }}>
            Updated {refreshedAt.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
          </Text>
        ) : null}
      </View>

      {onNotifications ? (
        <Pressable
          onPress={onNotifications}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Notifications"
          style={{
            width: 42,
            height: 42,
            borderRadius: radius.full,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: p.bg.surface,
            borderWidth: 1,
            borderColor: p.border.subtle,
          }}
        >
          <Bell size={19} color={p.text.secondary} strokeWidth={1.9} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** Indian Standard Time is the only clock this matters in. */
function timeOfDay(): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-IN', {
      hour: 'numeric',
      hour12: false,
      timeZone: 'Asia/Kolkata',
    }).format(new Date()),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/** "ANAND KRISHNAMURTHY" → "Anand". A greeting, not a record. */
function firstName(full: string): string {
  const first = full.trim().split(/\s+/)[0] ?? '';
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}
