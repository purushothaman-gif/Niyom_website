/**
 * Bank accounts — add one, or (with `action`) remove one / make one primary.
 *
 * Every change is confirmed with an emailed code. A NEW account is not used
 * straight away: it goes to the relationship manager for approval and shows as
 * "Awaiting RM approval" until then.
 *
 * Params: none → add. `action=bank_delete|bank_primary` + `id` + `label` → that
 * action on an existing account, straight to the code step.
 */
import { useState } from 'react';
import { Pressable, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, ShieldCheck } from 'lucide-react-native';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { ErrorBox, OtpConfirm, SummaryLine } from '@/features/client/profile/OtpConfirm';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';

export default function ProfileEditBank() {
  const params = useLocalSearchParams<{ action?: string; id?: string; label?: string }>();
  const action: { kind: 'bank_delete' | 'bank_primary'; id: string } | null =
    (params.action === 'bank_delete' || params.action === 'bank_primary') && params.id
      ? { kind: params.action, id: params.id }
      : null;

  if (action) {
    const label = params.label || 'this account';
    return (
      <Screen>
        <ScreenHeader
          title={action.kind === 'bank_delete' ? 'Remove bank account' : 'Change primary account'}
          subtitle="Confirm it is you."
          showBack
        />
        <OtpConfirm
          change={action}
          summary={
            <SummaryLine>
              {action.kind === 'bank_delete'
                ? `Remove ${label} from your profile.`
                : `Make ${label} your primary account.`}
            </SummaryLine>
          }
          onBack={() => router.back()}
          onDone={() => router.back()}
        />
      </Screen>
    );
  }
  return <AddBank />;
}

function AddBank() {
  const clientId = useClientId();
  const p = usePalette();
  const { snapshot } = useClientSnapshot(clientId);

  const [account, setAccount] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [holder, setHolder] = useState<string | null>(null);
  const [makePrimary, setMakePrimary] = useState(false);
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [error, setError] = useState<string | null>(null);

  // Prefilled with the client's name until they type their own.
  const holderName = holder ?? snapshot.client?.full_name ?? '';
  const acc = account.replace(/\s+/g, '');
  const code = ifsc.trim().toUpperCase();

  const next = () => {
    if (!/^[A-Za-z0-9]{6,40}$/.test(acc)) return setError('Enter a valid account number.');
    if (acc !== confirm.replace(/\s+/g, '')) return setError('The two account numbers don’t match.');
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(code)) return setError('Enter a valid 11-character IFSC (e.g. HDFC0001234).');
    if (holderName.trim().length < 2) return setError('Enter the account holder’s name as printed on your cheque book.');
    setError(null);
    setStep('otp');
  };

  return (
    <Screen>
      <ScreenHeader
        title="Add a bank account"
        subtitle={step === 'form' ? 'Reviewed by your relationship manager before it is used.' : 'Confirm it is you.'}
        showBack
      />

      {step === 'form' ? (
        <View style={{ gap: space[4] }}>
          <Input label="Account number" value={account} onChangeText={setAccount} keyboardType="number-pad" autoComplete="off" autoCorrect={false} />
          <Input
            label="Re-enter account number"
            value={confirm}
            onChangeText={setConfirm}
            keyboardType="number-pad"
            autoComplete="off"
            autoCorrect={false}
            contextMenuHidden
          />
          <Input label="IFSC" value={ifsc} onChangeText={(v) => setIfsc(v.toUpperCase().replace(/[^A-Z0-9]/g, ''))} autoCapitalize="characters" autoCorrect={false} maxLength={11} />
          <Input label="Account holder name" value={holderName} onChangeText={setHolder} autoCapitalize="words" />

          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: makePrimary }}
            onPress={() => setMakePrimary((v) => !v)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[1] }}
          >
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: radius.sm,
                borderWidth: 1.5,
                alignItems: 'center',
                justifyContent: 'center',
                borderColor: makePrimary ? p.accent.DEFAULT : p.border.DEFAULT,
                backgroundColor: makePrimary ? p.accent.DEFAULT : 'transparent',
              }}
            >
              {makePrimary ? <Check size={15} color={p.text.onAccent} strokeWidth={3} /> : null}
            </View>
            <Text variant="small" tone="secondary">
              Make this my primary account
            </Text>
          </Pressable>

          <Card padding={4} weight="surface">
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <ShieldCheck size={15} color={p.accent.DEFAULT} style={{ marginTop: 1 }} />
              <Text variant="caption" tone="muted" style={{ flex: 1 }}>
                Your relationship manager reviews and approves new bank accounts — usually within one
                working day. Until then the account shows as “Awaiting approval” and isn’t used for
                payouts.
              </Text>
            </View>
          </Card>

          <ErrorBox text={error} />
          <Button label="Continue" onPress={next} fullWidth size="lg" />
        </View>
      ) : (
        <OtpConfirm
          change={{
            kind: 'bank_add',
            account_number: acc,
            ifsc: code,
            holder_name: holderName.trim(),
            make_primary: makePrimary,
          }}
          doneNote="Sent to your relationship manager for approval."
          summary={
            <SummaryLine>
              Add account ending {acc.slice(-4)} · IFSC {code}
              {makePrimary ? ' · as primary' : ''} — sent to your RM for approval
            </SummaryLine>
          }
          onBack={() => setStep('form')}
          onDone={() => router.back()}
        />
      )}
    </Screen>
  );
}
