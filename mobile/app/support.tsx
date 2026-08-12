/**
 * Support — raise a ticket, and track the ones already open.
 *
 * Raising one goes through `raise-support-ticket`, which also alerts the
 * client's RM. The direct routes (call, WhatsApp) sit above the form rather
 * than below it: someone whose payment has failed wants a person, and burying
 * the phone number under a category picker serves the queue, not them.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import {
  CheckCircle2,
  LifeBuoy,
  MessageCircle,
  PhoneCall,
  Send,
} from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import {
  SUPPORT_EMAIL,
  SUPPORT_PHONE,
  SUPPORT_PHONE_HREF,
  SUPPORT_WHATSAPP_HREF,
} from '@shared/support/contact';
import {
  SupportService,
  type SupportTicket,
  type TicketCategory,
} from '@shared/portal/services/SupportService';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { EmptyState, ListRow, SkeletonScreen, StatusPill, type PillTone } from '@/ui/kit';

const CATEGORIES: { value: TicketCategory; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'transaction', label: 'Transaction' },
  { value: 'kyc', label: 'KYC' },
  { value: 'bank', label: 'Bank details' },
  { value: 'technical', label: 'App issue' },
  { value: 'feedback', label: 'Feedback' },
];

const STATUS_TONE: Record<SupportTicket['status'], PillTone> = {
  open: 'info',
  in_progress: 'warning',
  resolved: 'success',
  closed: 'neutral',
};

const STATUS_LABEL: Record<SupportTicket['status'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
};

export default function Support() {
  const clientId = useClientId();
  const p = usePalette();

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);

  const [category, setCategory] = useState<TicketCategory>('general');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [raised, setRaised] = useState<SupportTicket | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTickets(await SupportService.listTickets(clientId));
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const openLink = async (url: string, label: string) => {
    try {
      if (!(await Linking.canOpenURL(url))) throw new Error('unsupported');
      await Linking.openURL(url);
    } catch {
      Alert.alert(`Could not open ${label}`, `Please reach us on ${SUPPORT_PHONE} or ${SUPPORT_EMAIL}.`);
    }
  };

  const submit = async () => {
    setError('');
    if (subject.trim().length < 3) {
      setError('Give your ticket a short subject.');
      return;
    }
    if (message.trim().length < 10) {
      setError('Tell us a little more so we can help properly.');
      return;
    }
    setBusy(true);
    try {
      const ticket = await SupportService.createTicket(clientId, {
        category,
        subject: subject.trim(),
        message: message.trim(),
      });
      setRaised(ticket);
      setSubject('');
      setMessage('');
      setCategory('general');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not raise your ticket. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen onRefresh={load} refreshing={loading && tickets.length > 0}>
      <ScreenHeader
        title="Support"
        subtitle="Raise a ticket and track the ones you have open."
        showBack
      />

      <View style={{ gap: space[6] }}>
        {/* --------------------------- direct routes --------------------- */}
        <View style={{ flexDirection: 'row', gap: space[3] }}>
          <Card
            weight="surface"
            padding={4}
            onPress={() => void openLink(SUPPORT_PHONE_HREF, 'the dialler')}
            style={{ flex: 1, alignItems: 'center', gap: space[2] }}
          >
            <PhoneCall size={20} color={p.accent.DEFAULT} strokeWidth={1.9} />
            <Text variant="smallMedium">Call us</Text>
            <Text variant="caption" tone="faint" numberOfLines={1}>
              {SUPPORT_PHONE}
            </Text>
          </Card>
          <Card
            weight="surface"
            padding={4}
            onPress={() => void openLink(SUPPORT_WHATSAPP_HREF, 'WhatsApp')}
            style={{ flex: 1, alignItems: 'center', gap: space[2] }}
          >
            <MessageCircle size={20} color={p.accent.DEFAULT} strokeWidth={1.9} />
            <Text variant="smallMedium">WhatsApp</Text>
            <Text variant="caption" tone="faint">
              Usually quickest
            </Text>
          </Card>
        </View>

        {/* ------------------------------ raise -------------------------- */}
        {raised ? (
          <Animated.View entering={FadeIn.duration(280)}>
            <Card padding={5} style={{ alignItems: 'center', gap: space[3] }}>
              <CheckCircle2 size={38} color={p.state.successSoft} strokeWidth={1.7} />
              <Text variant="h3" center>
                Ticket {raised.ref} raised
              </Text>
              <Text variant="small" tone="muted" center>
                Your relationship manager has been alerted and will come back to you.
              </Text>
              <Button label="Raise another" variant="secondary" onPress={() => setRaised(null)} />
            </Card>
          </Animated.View>
        ) : (
          <View>
            <Text variant="overline" tone="muted" caps style={{ marginBottom: space[3] }}>
              Raise a ticket
            </Text>
            <Card padding={4}>
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

                <View>
                  <Text variant="overline" tone="muted" caps style={{ marginBottom: space[2] }}>
                    What is it about?
                  </Text>
                  {/* A wrapping chip row rather than a picker: six options fit,
                      and a picker hides them behind a tap for no gain. */}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
                    {CATEGORIES.map((c) => {
                      const active = c.value === category;
                      return (
                        <Text
                          key={c.value}
                          variant="smallMedium"
                          onPress={() => setCategory(c.value)}
                          accessibilityRole="button"
                          accessibilityState={{ selected: active }}
                          style={{
                            paddingHorizontal: space[3],
                            paddingVertical: space[2],
                            borderRadius: radius.full,
                            overflow: 'hidden',
                            borderWidth: 1,
                            borderColor: active ? p.accent.DEFAULT : p.border.DEFAULT,
                            backgroundColor: active ? p.accent.tint(0.14) : 'transparent',
                            color: active ? p.accent.DEFAULT : p.text.secondary,
                          }}
                        >
                          {c.label}
                        </Text>
                      );
                    })}
                  </View>
                </View>

                <Input
                  label="Subject"
                  placeholder="A one-line summary"
                  value={subject}
                  onChangeText={setSubject}
                  maxLength={120}
                  editable={!busy}
                />

                <Input
                  label="Details"
                  placeholder="What happened, and what you expected"
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  multilineHeight={120}
                  maxLength={2000}
                  editable={!busy}
                />

                <Button
                  label="Raise ticket"
                  icon={Send}
                  onPress={() => void submit()}
                  loading={busy}
                  fullWidth
                />
              </View>
            </Card>
          </View>
        )}

        {/* ------------------------------ history ------------------------ */}
        <View>
          <Text variant="overline" tone="muted" caps style={{ marginBottom: space[3] }}>
            Your tickets
          </Text>

          {loading && tickets.length === 0 ? (
            <SkeletonScreen rows={2} />
          ) : tickets.length === 0 ? (
            <EmptyState
              icon={LifeBuoy}
              title="No tickets yet"
              message="Anything you raise will be tracked here until it is resolved."
            />
          ) : (
            <Card padding={4}>
              {tickets.map((t, i) => (
                <Animated.View key={t.id} entering={FadeInDown.duration(320).delay(Math.min(i, 8) * 40)}>
                  <ListRow
                    title={t.subject}
                    subtitle={`${t.ref} · ${formatDate(t.created_at)}`}
                    last={i === tickets.length - 1}
                  />
                  <View style={{ marginTop: -space[2], marginBottom: space[3] }}>
                    <StatusPill dot tone={STATUS_TONE[t.status]} label={STATUS_LABEL[t.status]} />
                  </View>
                </Animated.View>
              ))}
            </Card>
          )}
        </View>
      </View>
    </Screen>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
