/**
 * Changing your own password while signed in.
 *
 * Distinct from `(auth)/change-password`, which is the FORCED first-login
 * screen someone cannot leave. This one is voluntary, reached from Profile, and
 * asks for the current password first.
 *
 * ## Why re-authenticate
 *
 * Supabase's `updateUser` accepts a new password on the strength of the session
 * alone. On a phone that session can be five minutes old and in someone else's
 * hands, so the current password is checked first — a sign-in against the same
 * account, which fails harmlessly if it is wrong.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { CheckCircle2, Lock } from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { passwordChecks, passwordError } from '@shared/lib/passwordPolicy';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import { clientSupabase } from '@/platform/supabase';
import { useClientId } from '@/features/auth/AuthContext';
import { PasswordChecklist } from '@/features/auth/PasswordChecklist';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';

export default function ChangeMyPassword() {
  const clientId = useClientId();
  const p = usePalette();
  const { snapshot } = useClientSnapshot(clientId);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const submit = async () => {
    setError('');
    if (!current) {
      setError('Enter your current password.');
      return;
    }
    const policy = passwordError(next);
    if (policy) {
      setError(policy);
      return;
    }
    if (next !== confirm) {
      setError('The new passwords do not match.');
      return;
    }
    if (next === current) {
      setError('Your new password must be different from the current one.');
      return;
    }

    const email = snapshot.client?.email;
    if (!email) {
      setError('Could not confirm your account. Pull to refresh and try again.');
      return;
    }

    setBusy(true);

    // Re-authenticate. A wrong password fails here and changes nothing.
    const { error: authError } = await clientSupabase.auth.signInWithPassword({
      email,
      password: current,
    });
    if (authError) {
      setBusy(false);
      setError('That is not your current password.');
      return;
    }

    const { error: updateError } = await clientSupabase.auth.updateUser({ password: next });
    setBusy(false);

    if (updateError) {
      setError(updateError.message || 'Could not update your password. Please try again.');
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <Screen>
        <ScreenHeader title="Password changed" />
        <Animated.View entering={FadeIn.duration(280)} style={{ gap: space[5] }}>
          <Card padding={5} style={{ alignItems: 'center', gap: space[3] }}>
            <CheckCircle2 size={42} color={p.state.successSoft} strokeWidth={1.7} />
            <Text variant="h3" center>
              All done
            </Text>
            <Text variant="small" tone="muted" center>
              Use your new password next time you sign in. Your PIN is unaffected.
            </Text>
          </Card>
          <Button label="Back to profile" onPress={() => router.back()} fullWidth size="lg" />
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        title="Change password"
        subtitle="Choose a new password for your Niyom account."
        showBack
      />

      <View style={{ gap: space[4] }}>
        {error ? (
          <View
            accessibilityLiveRegion="polite"
            style={{
              backgroundColor: `${p.state.dangerSoft}1A`,
              borderColor: `${p.state.dangerSoft}40`,
              borderWidth: 1,
              borderRadius: radius.md,
              paddingHorizontal: space[4],
              paddingVertical: space[3],
            }}
          >
            <Text variant="small" tone="danger">
              {error}
            </Text>
          </View>
        ) : null}

        <Input
          label="Current password"
          icon={Lock}
          secure
          placeholder="Your current password"
          value={current}
          onChangeText={setCurrent}
          autoComplete="current-password"
          textContentType="password"
          editable={!busy}
        />

        <Input
          label="New password"
          icon={Lock}
          secure
          placeholder="Choose a strong password"
          value={next}
          onChangeText={setNext}
          autoComplete="new-password"
          textContentType="newPassword"
          editable={!busy}
        />

        <PasswordChecklist checks={passwordChecks(next)} />

        <Input
          label="Confirm new password"
          icon={Lock}
          secure
          placeholder="Type it again"
          value={confirm}
          onChangeText={setConfirm}
          editable={!busy}
          returnKeyType="go"
          onSubmitEditing={() => void submit()}
        />

        <Button
          label="Update password"
          onPress={() => void submit()}
          loading={busy}
          fullWidth
          size="lg"
        />
      </View>
    </Screen>
  );
}
