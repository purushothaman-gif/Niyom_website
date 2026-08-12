/**
 * The live password-strength rows.
 *
 * Driven by `passwordChecks` from `shared/lib/passwordPolicy` — the same
 * function the website's change-password screens use, so the rules cannot drift
 * between the two and a password accepted here is accepted there.
 *
 * Shown while typing rather than as an error afterwards: a client composing a
 * password should be able to see it become acceptable, not be told after the
 * fact that it was not.
 */
import { View } from 'react-native';
import { Check, Circle } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Text } from '@/ui/Text';

export function PasswordChecklist({
  checks,
  onBrand,
}: {
  checks: { text: string; met: boolean }[];
  onBrand?: boolean;
}) {
  const p = usePalette();
  const dim = onBrand ? p.onBrand.textMuted : p.text.muted;

  return (
    <View
      style={{ gap: space[2] }}
      accessibilityRole="list"
      accessibilityLabel="Password requirements"
    >
      {checks.map((c) => (
        <Animated.View
          key={c.text}
          entering={FadeIn.duration(180)}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}
          accessibilityRole="text"
          accessibilityLabel={`${c.text}: ${c.met ? 'met' : 'not met'}`}
        >
          {c.met ? (
            <Check size={14} color={p.state.successSoft} strokeWidth={3} />
          ) : (
            <Circle size={14} color={dim} strokeWidth={2} />
          )}
          <Text variant="small" style={{ color: c.met ? p.state.successSoft : dim }}>
            {c.text}
          </Text>
        </Animated.View>
      ))}
    </View>
  );
}
