/**
 * Step 2 of every profile change: a code goes to the registered email, the
 * client types it, and `client-profile-update` applies the change, logs it and
 * alerts the RM. The same step the website's ProfileEdit modals end on.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { CheckCircle2, Mail } from 'lucide-react-native';
import {
  ProfileEditService,
  type ProfileChange,
} from '@shared/portal/services/ProfileEditService';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { OtpInput } from '@/ui/OtpInput';

export function ErrorBox({ text }: { text: string | null }) {
  const p = usePalette();
  if (!text) return null;
  return (
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
        {text}
      </Text>
    </View>
  );
}

export function OtpConfirm({
  summary,
  change,
  doneNote = 'Your relationship manager has been notified.',
  onBack,
  onDone,
}: {
  summary: ReactNode;
  change: ProfileChange;
  doneNote?: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const p = usePalette();
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState<'send' | 'apply' | null>('send');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const send = async () => {
    setBusy('send');
    setError(null);
    const r = await ProfileEditService.requestOtp();
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setSentTo(r.email_masked ?? 'your registered email');
  };

  useEffect(() => {
    void send();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = async (code: string) => {
    if (busy) return;
    setBusy('apply');
    setError(null);
    const r = await ProfileEditService.apply(code.trim(), change);
    setBusy(null);
    if (!r.ok) {
      setOtp('');
      return setError(r.error);
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setDone(true);
    setTimeout(onDone, 1400);
  };

  if (done) {
    return (
      <Card padding={5} style={{ alignItems: 'center', gap: space[3] }}>
        <CheckCircle2 size={42} color={p.state.successSoft} strokeWidth={1.7} />
        <Text variant="h3">Saved</Text>
        <Text variant="small" tone="muted" center>
          {doneNote}
        </Text>
      </Card>
    );
  }

  return (
    <View style={{ gap: space[4] }}>
      <Card padding={4} weight="surface">
        {summary}
      </Card>

      <View style={{ flexDirection: 'row', gap: space[2], alignItems: 'flex-start' }}>
        <Mail size={16} color={p.accent.DEFAULT} style={{ marginTop: 2 }} />
        <Text variant="small" tone="muted" style={{ flex: 1 }}>
          {busy === 'send'
            ? 'Sending a code…'
            : sentTo
              ? `We sent a 6-digit code to ${sentTo}.`
              : 'We’ll email a code to your registered address.'}
        </Text>
      </View>

      <OtpInput
        value={otp}
        onChange={setOtp}
        onComplete={(code) => void apply(code)}
        disabled={busy === 'apply'}
      />

      <ErrorBox text={error} />

      <Button
        label={busy === 'apply' ? 'Saving…' : 'Confirm & save'}
        onPress={() => void apply(otp)}
        loading={busy === 'apply'}
        disabled={otp.length !== 6 || !!busy}
        fullWidth
        size="lg"
      />
      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <Button label="Back" variant="secondary" onPress={onBack} style={{ flex: 1 }} />
        <Button
          label="Resend code"
          variant="ghost"
          onPress={() => void send()}
          disabled={!!busy}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

/** One "Label: old → new" style line inside an OtpConfirm summary. */
export function SummaryLine({ children }: { children: ReactNode }) {
  return (
    <Text variant="small" tone="secondary" style={{ marginVertical: 2 }}>
      {children}
    </Text>
  );
}
