/**
 * Over-the-air (JS) updates, picked up while the app is in use.
 * -----------------------------------------------------------------------------
 * expo-updates on its own only checks at a cold start, and applies what it
 * finds at the NEXT cold start — on a phone that is rarely killed, that can be
 * days. This checks again whenever the app comes back to the foreground (at
 * most every 10 minutes), downloads in the background, and then:
 *
 *  - if the app was away for 10+ minutes, restarts into the update straight
 *    away — nobody is mid-task after ten minutes in the background;
 *  - otherwise shows a small "Update ready · Restart" bar, so a half-filled
 *    CRM form is never thrown away by surprise.
 *
 * Only JS updates. A new native build still goes through the CRM's update
 * pop-up and the in-app installer.
 */
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, View, type AppStateStatus } from 'react-native';
import * as Updates from 'expo-updates';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RefreshCw, X } from 'lucide-react-native';
import { usePalette } from '@/design/ThemeProvider';
import { radius, space } from '@/design/tokens';
import { Text } from '@/ui/Text';

const CHECK_EVERY_MS = 10 * 60 * 1000;
const AUTO_APPLY_AFTER_AWAY_MS = 10 * 60 * 1000;

export function OtaUpdater() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const [ready, setReady] = useState(false);
  const [hidden, setHidden] = useState(false);
  const lastCheck = useRef(0);
  const checking = useRef(false);
  const backgroundedAt = useRef<number | null>(null);
  const readyRef = useRef(false);

  useEffect(() => {
    if (__DEV__ || !Updates.isEnabled) return;

    const check = async () => {
      if (checking.current || readyRef.current) return;
      if (Date.now() - lastCheck.current < CHECK_EVERY_MS) return;
      checking.current = true;
      lastCheck.current = Date.now();
      try {
        const res = await Updates.checkForUpdateAsync();
        if (res.isAvailable) {
          const fetched = await Updates.fetchUpdateAsync();
          if (fetched.isNew) {
            readyRef.current = true;
            setReady(true);
          }
        }
      } catch {
        /* offline or server hiccup — try again next time */
      } finally {
        checking.current = false;
      }
    };

    const onChange = (status: AppStateStatus) => {
      if (status === 'background') {
        backgroundedAt.current = Date.now();
        return;
      }
      if (status !== 'active') return;
      const away = backgroundedAt.current ? Date.now() - backgroundedAt.current : 0;
      backgroundedAt.current = null;
      if (readyRef.current && away >= AUTO_APPLY_AFTER_AWAY_MS) {
        void Updates.reloadAsync();
        return;
      }
      void check();
    };

    // The launch already ran its own check; look again a little later.
    lastCheck.current = Date.now();
    const sub = AppState.addEventListener('change', onChange);
    return () => sub.remove();
  }, []);

  if (!ready || hidden) return null;

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: insets.bottom + space[4], alignItems: 'center' }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: space[3],
          paddingVertical: space[2],
          paddingLeft: space[4],
          paddingRight: space[2],
          borderRadius: radius.lg,
          backgroundColor: p.bg.elevated,
          borderWidth: 1,
          borderColor: p.border.DEFAULT,
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 12,
          elevation: 6,
        }}
      >
        <Text variant="small" tone="secondary">
          App update ready
        </Text>
        <Pressable
          onPress={() => void Updates.reloadAsync()}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: space[1],
            paddingVertical: space[2],
            paddingHorizontal: space[3],
            borderRadius: radius.md,
            backgroundColor: p.accent.DEFAULT,
            opacity: pressed ? 0.8 : 1,
          })}
        >
          <RefreshCw size={14} color={p.text.onAccent} />
          <Text variant="small" style={{ color: p.text.onAccent, fontWeight: '600' }}>
            Restart
          </Text>
        </Pressable>
        <Pressable onPress={() => setHidden(true)} hitSlop={10} accessibilityLabel="Dismiss">
          <X size={16} color={p.text.muted} />
        </Pressable>
      </View>
    </View>
  );
}
