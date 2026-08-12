/**
 * The sign-in stack.
 *
 * Its own group so every screen in it gets the navy brand panel and no tab bar,
 * and so the launch router can `replace()` into and out of authentication
 * without leaving a signed-out screen underneath the portal.
 */
import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        // The panel is full-bleed navy on every screen here, so a fade reads
        // better than a slide — there is no edge for a slide to reveal.
        animation: 'fade',
        animationDuration: 220,
      }}
    />
  );
}
