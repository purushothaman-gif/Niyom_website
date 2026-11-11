/**
 * Edit contact details — mobile, email and address.
 *
 * Two steps, as on the website: change the fields, then confirm with a code
 * emailed to the registered address. Only the fields that actually changed are
 * sent. The email here is the one statements and alerts go to; sign-in is
 * unaffected.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import { space } from '@/design/tokens';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { ErrorBox, OtpConfirm, SummaryLine } from '@/features/client/profile/OtpConfirm';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { SkeletonScreen } from '@/ui/kit';

type Key = 'phone' | 'email' | 'address' | 'city' | 'state' | 'pincode';
const KEYS: Key[] = ['phone', 'email', 'address', 'city', 'state', 'pincode'];
const LABELS: Record<Key, string> = {
  phone: 'Mobile',
  email: 'Email',
  address: 'Address',
  city: 'City',
  state: 'State',
  pincode: 'PIN code',
};
const BLANK: Record<Key, string> = { phone: '', email: '', address: '', city: '', state: '', pincode: '' };

export default function ProfileEditContact() {
  const clientId = useClientId();
  const { snapshot, refreshedAt, refresh } = useClientSnapshot(clientId);
  const client = snapshot.client;

  const [original, setOriginal] = useState<Record<Key, string> | null>(null);
  const [form, setForm] = useState<Record<Key, string>>(BLANK);
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [error, setError] = useState<string | null>(null);

  // Seed once, from the first loaded record — a background refresh must not
  // overwrite what the client is typing.
  useEffect(() => {
    if (original || !client || !refreshedAt) return;
    const o: Record<Key, string> = {
      phone: client.phone ?? '',
      email: client.email ?? '',
      address: client.address ?? '',
      city: client.city ?? '',
      state: client.state ?? '',
      pincode: client.pincode ?? '',
    };
    setOriginal(o);
    setForm(o);
  }, [client, refreshedAt, original]);

  const changed: Partial<Record<Key, string>> = {};
  if (original) {
    for (const k of KEYS) if (form[k].trim() !== original[k].trim()) changed[k] = form[k].trim();
  }
  const changedKeys = Object.keys(changed) as Key[];
  const set = (k: Key) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const next = () => {
    if (!changedKeys.length) return setError('Change at least one detail first.');
    if (changed.email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changed.email)) {
      return setError('Enter a valid email address.');
    }
    if (changed.phone !== undefined && changed.phone.replace(/\D/g, '').length < 10) {
      return setError('Enter a valid mobile number.');
    }
    if (changed.pincode !== undefined && changed.pincode && !/^\d{6}$/.test(changed.pincode)) {
      return setError('Enter a 6-digit PIN code.');
    }
    setError(null);
    setStep('otp');
  };

  return (
    <Screen>
      <ScreenHeader
        title="Edit contact details"
        subtitle={step === 'form' ? 'Confirmed with a code sent to your registered email.' : 'Confirm it is you.'}
        showBack
      />

      {!original ? (
        <SkeletonScreen rows={3} />
      ) : step === 'form' ? (
        <View style={{ gap: space[4] }}>
          <Input label="Mobile number" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" maxLength={14} />
          <Input
            label="Email"
            value={form.email}
            onChangeText={set('email')}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            hint="Used for statements and alerts. Your sign-in stays the same."
          />
          <Input label="Address" value={form.address} onChangeText={set('address')} multiline multilineHeight={84} />
          <Input label="City" value={form.city} onChangeText={set('city')} />
          <Input label="State" value={form.state} onChangeText={set('state')} />
          <Input label="PIN code" value={form.pincode} onChangeText={set('pincode')} format="digits" keyboardType="number-pad" maxLength={6} />
          <ErrorBox text={error} />
          <Button label="Continue" onPress={next} fullWidth size="lg" />
        </View>
      ) : (
        <OtpConfirm
          change={{ kind: 'contact', ...changed }}
          summary={
            <View>
              {changedKeys.map((k) => (
                <SummaryLine key={k}>
                  <Text variant="small">{LABELS[k]}: </Text>
                  {original[k] || '—'} → <Text variant="small">{changed[k] || '—'}</Text>
                </SummaryLine>
              ))}
            </View>
          }
          onBack={() => setStep('form')}
          onDone={() => {
            refresh();
            router.back();
          }}
        />
      )}
    </Screen>
  );
}
