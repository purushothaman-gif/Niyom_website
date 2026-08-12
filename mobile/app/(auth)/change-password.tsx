/**
 * The forced first-login password change.
 *
 * An RM provisions a temporary password when they enable a login. Until it is
 * replaced, `password_changed` is false and the launch router sends the person
 * here instead of into the portal — so there is exactly one place this rule
 * lives and no screen can be deep-linked around it.
 *
 * There is no "skip". The only way out is a password meeting the shared policy,
 * or signing out.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Lock } from 'lucide-react-native';
import { passwordChecks, passwordError } from '@shared/lib/passwordPolicy';
import { clientSupabase, partnerSupabase } from '@/platform/supabase';
import { useAuth } from '@/features/auth/AuthContext';
import { AuthLayout, AuthNotice } from '@/features/auth/AuthLayout';
import { PasswordChecklist } from '@/features/auth/PasswordChecklist';
import { space } from '@/design/tokens';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { Text } from '@/ui/Text';

export default function ChangePassword() {
  const params = useLocalSearchParams<{ surface?: string }>();
  const surface = params.surface === 'partner' ? 'partner' : 'client';
  const { markPasswordChanged, signOut } = useAuth();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const policy = passwordError(password);
    if (policy) {
      setError(policy);
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }

    setError('');
    setBusy(true);
    /*
     * Updated through the surface's OWN Supabase client. Using the wrong one
     * would change the wrong person's password when a client and a partner are
     * both signed in on this handset.
     */
    const db = surface === 'partner' ? partnerSupabase : clientSupabase;
    const { error: updateError } = await db.auth.updateUser({ password });
    setBusy(false);

    if (updateError) {
      setError(updateError.message || 'Could not update your password. Please try again.');
      return;
    }

    /*
     * The `password_changed` column is set by a database trigger on the auth
     * user's password update, so nothing has to write it here — the app only
     * needs to stop routing them back to this screen.
     */
    await markPasswordChanged();
    router.replace('/');
  };

  return (
    <AuthLayout
      eyebrow={surface === 'partner' ? 'Partner Portal' : 'Client Portal'}
      title="Choose your password"
      subtitle="You are signed in with a temporary password. Set your own to continue."
      footer={
        <Pressable onPress={() => void signOut('user').then(() => router.replace('/'))} hitSlop={8}>
          <Text variant="small" tone="onBrandMuted" center>
            Sign out instead
          </Text>
        </Pressable>
      }
    >
      <View style={{ gap: space[4] }}>
        {error ? <AuthNotice message={error} /> : null}

        <Input
          label="New password"
          icon={Lock}
          secure
          placeholder="Choose a strong password"
          value={password}
          onChangeText={setPassword}
          autoComplete="new-password"
          textContentType="newPassword"
          editable={!busy}
        />

        <PasswordChecklist checks={passwordChecks(password)} onBrand />

        <Input
          label="Confirm password"
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
          label="Set password and continue"
          onPress={() => void submit()}
          loading={busy}
          fullWidth
          size="lg"
        />
      </View>
    </AuthLayout>
  );
}
