/**
 * The offer to set a PIN, made once, just after signing in.
 *
 * Buried in Profile it is never found — and the PIN is what makes the
 * five-minute idle timeout tolerable, so nobody finding it means everybody
 * retyping a password several times a day. It is offered where the value is
 * obvious: immediately after the friction it removes.
 *
 * Asked at most three times, then never again. The first sign-in is often a
 * hurried one and a second and third ask catch the person who meant to and
 * forgot; beyond that it is nagging, and Profile is always there.
 */
import { useEffect, useState } from 'react';
import { Modal, View } from 'react-native';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import { Fingerprint, KeyRound, ScanFace, X } from 'lucide-react-native';
import { Pressable } from 'react-native';
import Animated, { FadeIn, FadeInUp } from 'react-native-reanimated';
import {
  hasProfile,
  PIN_PROMPT_LIMIT,
  pinPromptSkips,
  recordPinPromptSkip,
  type PinSurface,
} from '@/platform/device';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';

export function SetPinPrompt({ surface, id }: { surface: PinSurface; id: string }) {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  const [biometric, setBiometric] = useState<'face' | 'fingerprint' | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [already, skips, hasHardware, enrolled, types] = await Promise.all([
        hasProfile(surface, id),
        pinPromptSkips(surface, id),
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
        LocalAuthentication.supportedAuthenticationTypesAsync(),
      ]);
      if (!alive || already || skips >= PIN_PROMPT_LIMIT) return;

      if (hasHardware && enrolled) {
        setBiometric(
          types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
            ? 'face'
            : 'fingerprint',
        );
      }
      // Decided once on mount, never watched — it must not appear mid-session
      // while someone is reading their portfolio.
      setOpen(true);
    })();
    return () => {
      alive = false;
    };
  }, [surface, id]);

  const dismiss = () => {
    void recordPinPromptSkip(surface, id);
    setOpen(false);
  };

  if (!open) return null;

  const Icon = biometric === 'face' ? ScanFace : biometric === 'fingerprint' ? Fingerprint : KeyRound;
  const headline =
    biometric === 'face'
      ? 'Unlock with Face ID'
      : biometric === 'fingerprint'
        ? 'Unlock with your fingerprint'
        : 'Set a 4-digit PIN';

  return (
    <Modal transparent animationType="fade" visible onRequestClose={dismiss}>
      <Animated.View
        entering={FadeIn.duration(200)}
        style={{ flex: 1, backgroundColor: p.bg.overlay, justifyContent: 'flex-end' }}
      >
        <Animated.View
          entering={FadeInUp.duration(320)}
          style={{
            backgroundColor: p.bg.elevated,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            padding: space[6],
            paddingBottom: space[8],
            gap: space[4],
          }}
        >
          <Pressable onPress={dismiss} hitSlop={12} style={{ alignSelf: 'flex-end' }}>
            <X size={20} color={p.text.muted} />
          </Pressable>

          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: radius.full,
              alignSelf: 'center',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: p.accent.tint(0.14),
            }}
          >
            <Icon size={30} color={p.accent.DEFAULT} strokeWidth={1.7} />
          </View>

          <Text variant="h2" center>
            {headline}
          </Text>

          <Text variant="small" tone="muted" center>
            Niyom signs you out after five minutes of inactivity, which keeps your portfolio safe on
            a shared or mislaid phone. A PIN makes getting back in take a second
            {biometric ? ' — or no typing at all' : ''}.
          </Text>

          <View style={{ gap: space[3], marginTop: space[2] }}>
            <Button
              label={biometric ? 'Set up PIN & biometrics' : 'Set up my PIN'}
              onPress={() => {
                setOpen(false);
                router.push(surface === 'partner' ? '/partner-set-pin' : '/set-pin');
              }}
              fullWidth
              size="lg"
            />
            <Button label="Not now" variant="ghost" onPress={dismiss} fullWidth />
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}
