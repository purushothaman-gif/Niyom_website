/**
 * The app's root.
 *
 * Order matters here. `@/platform/supabase` is imported for its side effect —
 * building the three Supabase clients and handing them to `shared/` — and it is
 * imported at the top of the ROOT layout so it has run before any screen can
 * mount and call a service.
 */
import '@/platform/supabase';

import { useCallback, useEffect } from 'react';
import { AppState, View, type AppStateStatus } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  SpaceGrotesk_500Medium,
  SpaceGrotesk_600SemiBold,
  SpaceGrotesk_700Bold,
} from '@expo-google-fonts/space-grotesk';

import { ThemeProvider, useTheme } from '@/design/ThemeProvider';
import { AuthProvider, useAuth } from '@/features/auth/AuthContext';
import { clientSupabase, partnerSupabase, supabase } from '@/platform/supabase';

/*
 * Hold the splash until the fonts are in. Space Grotesk decides the width of
 * every number on the dashboard, so rendering before it loads means the first
 * frame is laid out in the system font and then jumps.
 */
void SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A phone loses its network constantly. One retry absorbs a tunnel; more
      // than that just delays telling the client something is wrong.
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
  });

  /*
   * Supabase's token refresh runs on a timer. Left going while the app is
   * backgrounded it fires against a suspended network stack, fails, and can
   * spend the refresh token for nothing — so it follows the foreground state.
   * All three clients, because a client and a partner may both be signed in.
   */
  useEffect(() => {
    const apply = (status: AppStateStatus) => {
      const active = status === 'active';
      for (const client of [supabase, clientSupabase, partnerSupabase]) {
        if (active) client.auth.startAutoRefresh();
        else client.auth.stopAutoRefresh();
      }
    };
    apply(AppState.currentState);
    const sub = AppState.addEventListener('change', apply);
    return () => sub.remove();
  }, []);

  const onReady = useCallback(() => {
    // Font loading can fail offline on a first run; showing the app in the
    // fallback face beats holding a splash screen forever.
    if (fontsLoaded || fontError) void SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    onReady();
  }, [onReady]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <ThemedShell />
            </AuthProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/**
 * Inside the provider so it can read the resolved theme: the native window
 * background has to be painted too, or a fast scroll past the end of a list
 * shows white behind the navy.
 */
function ThemedShell() {
  const { theme, name } = useTheme();
  const { noteActivity } = useAuth();

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.bg.base);
  }, [theme.bg.base]);

  return (
    /*
     * The whole app sits under one touch listener so the idle clock resets on
     * any interaction. `onStartShouldSetResponderCapture` observes the touch on
     * its way DOWN and returns false, so it never becomes the responder and no
     * button, scroll or gesture below it is affected.
     */
    <View
      style={{ flex: 1 }}
      onStartShouldSetResponderCapture={() => {
        noteActivity();
        return false;
      }}
    >
      <StatusBar style={name === 'dark' ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: theme.bg.base },
          animation: 'slide_from_right',
        }}
      />
    </View>
  );
}
