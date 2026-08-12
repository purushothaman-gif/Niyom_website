/**
 * The launch router.
 *
 * Renders nothing. It waits for the stored session to be checked, then sends
 * the app to exactly one of four places — and holding navigation until
 * `restoring` is false is what stops a returning client seeing the sign-in
 * screen flash before their dashboard.
 */
import { useEffect } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useAuth } from '@/features/auth/AuthContext';
import { usePalette } from '@/design/ThemeProvider';

export default function LaunchRouter() {
  const { session, restoring } = useAuth();
  const p = usePalette();

  useEffect(() => {
    if (restoring) return;

    if (!session) {
      router.replace('/(auth)/welcome');
      return;
    }

    /*
     * A temporary password issued by an RM has to be changed before anything
     * else is reachable. Enforced here rather than inside each portal so there
     * is one place it can be true, and no screen can be deep-linked past it.
     */
    if (!session.passwordChanged) {
      router.replace({ pathname: '/(auth)/change-password', params: { surface: session.surface } });
      return;
    }

    router.replace(session.surface === 'client' ? '/(client)/dashboard' : '/(partner)/dashboard');
  }, [session, restoring]);

  // The splash screen is still up underneath; this only paints the brand navy
  // for the frame between it hiding and the replace() landing.
  return <View style={{ flex: 1, backgroundColor: p.bg.base }} />;
}
