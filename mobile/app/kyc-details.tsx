/**
 * KYC details — date of birth, address, bank account and (optionally) demat.
 *
 * The website's KYC wizard collects these on its Details step; the app had no
 * equivalent, so a client who onboarded on the phone was left with an account
 * nobody could raise a deal or open a mutual fund account for until an RM
 * filled the gaps. Same fields, same shared rules
 * (`validateKycDetails`), written to the same columns.
 *
 * Demat details are optional here and required only for bonds and unlisted
 * shares — the KYC screen checks that when those products are chosen.
 */
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { clientSupabase } from '@shared/lib/supabase';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import { BANK_ACCOUNT_TYPES, validateKycDetails } from '@shared/portal/onboarding/investorProfile';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { ErrorBox } from '@/features/client/profile/OtpConfirm';
import { dmyToIso, isoToDmy, maskDmy } from '@/features/client/profile/dmy';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { ErrorState, SkeletonScreen } from '@/ui/kit';

export default function KycDetails() {
  const clientId = useClientId();
  const p = usePalette();
  const { snapshot, loading, error: loadError, refreshedAt, refresh } = useClientSnapshot(clientId);
  const client = snapshot.client;

  const [ready, setReady] = useState(false);
  const [dobText, setDobText] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [pincode, setPincode] = useState('');
  const [bankName, setBankName] = useState('');
  const [bankAccount, setBankAccount] = useState('');
  const [bankIfsc, setBankIfsc] = useState('');
  const [accountType, setAccountType] = useState('');
  const [demat, setDemat] = useState('');
  const [dpName, setDpName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Start from what is already on record, once, when the client first arrives.
  useEffect(() => {
    if (ready || !client) return;
    setDobText(isoToDmy(client.dob));
    setAddress(client.address || '');
    setCity(client.city || '');
    setStateName(client.state || '');
    setPincode(client.pincode || '');
    setBankName(client.bank_name || '');
    setBankAccount(client.bank_account || '');
    setBankIfsc(client.bank_ifsc || '');
    setAccountType(client.bank_account_type || '');
    setDemat(client.demat_account || '');
    setDpName(client.dp_name || '');
    setReady(true);
  }, [client, ready]);

  const save = async () => {
    setError(null);
    if (dobText.trim() && !dmyToIso(dobText)) return setError('Enter your date of birth as DD/MM/YYYY.');
    const checked = validateKycDetails({
      dob: dmyToIso(dobText), address, city, state: stateName, pincode,
      bank_name: bankName, bank_account: bankAccount, bank_ifsc: bankIfsc, bank_account_type: accountType,
      demat_account: demat, dp_name: dpName,
    });
    if (!checked.ok) return setError(checked.error);

    setBusy(true);
    const { error: saveError } = await clientSupabase.from('nw_clients').update(checked.value).eq('id', clientId);
    setBusy(false);
    if (saveError) return setError('We could not save your details. Please try again.');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  if (loading && !refreshedAt) {
    return (
      <Screen>
        <ScreenHeader title="Your details" showBack />
        <SkeletonScreen rows={4} />
      </Screen>
    );
  }
  if (loadError) {
    return (
      <Screen>
        <ScreenHeader title="Your details" showBack />
        <ErrorState message={loadError} onRetry={refresh} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        title="Your details"
        subtitle="We need these to activate your account and process your investments."
        showBack
      />

      <View style={{ gap: space[4] }}>
        <Card padding={4} style={{ gap: space[3] }}>
          <Text variant="overline" tone="muted" caps>About you</Text>
          <Input label="Date of birth" placeholder="DD/MM/YYYY" value={dobText} keyboardType="number-pad" maxLength={10}
            onChangeText={(v) => setDobText(maskDmy(v))} />
          <Input label="Address" placeholder="Flat / house, street, area" value={address} onChangeText={setAddress}
            multiline multilineHeight={84} maxLength={300} autoCapitalize="words" />
          <View style={{ flexDirection: 'row', gap: space[3] }}>
            <Input label="City" value={city} onChangeText={setCity} autoCapitalize="words" maxLength={60} containerStyle={{ flex: 1 }} />
            <Input label="PIN code" value={pincode} keyboardType="number-pad" maxLength={6}
              onChangeText={(v) => setPincode(v.replace(/\D/g, '').slice(0, 6))} containerStyle={{ flex: 1 }} />
          </View>
          <Input label="State" value={stateName} onChangeText={setStateName} autoCapitalize="words" maxLength={60} />
        </Card>

        <Card padding={4} style={{ gap: space[3] }}>
          <Text variant="overline" tone="muted" caps>Bank account</Text>
          <Input label="Bank name" placeholder="HDFC Bank" value={bankName} onChangeText={setBankName} autoCapitalize="words" maxLength={80} />
          <Input label="Account number" value={bankAccount} keyboardType="number-pad" maxLength={20}
            onChangeText={(v) => setBankAccount(v.replace(/\D/g, '').slice(0, 20))} />
          <Input label="IFSC code" placeholder="HDFC0001234" value={bankIfsc} autoCapitalize="characters" maxLength={11}
            onChangeText={(v) => setBankIfsc(v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 11))} />
          <View>
            <Text variant="caption" tone="secondary">Account type</Text>
            <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] }}>
              {BANK_ACCOUNT_TYPES.map((o) => {
                const on = accountType === o.value;
                return (
                  <Pressable
                    key={o.value}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    onPress={() => setAccountType(o.value)}
                    style={{
                      paddingHorizontal: space[3],
                      paddingVertical: space[2],
                      borderRadius: radius.md,
                      borderWidth: 1,
                      borderColor: on ? p.accent.DEFAULT : p.border.DEFAULT,
                      backgroundColor: on ? p.accent.tint(0.14) : 'transparent',
                    }}
                  >
                    <Text variant="small" tone={on ? 'accent' : 'muted'}>{o.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </Card>

        <Card padding={4} style={{ gap: space[3] }}>
          <Text variant="overline" tone="muted" caps>Demat account (optional)</Text>
          <Text variant="caption" tone="muted">
            Needed only for bonds and unlisted shares. Leave it blank if you do not have one.
          </Text>
          <Input label="Demat account number" placeholder="16 characters" value={demat} autoCapitalize="characters" maxLength={16}
            onChangeText={(v) => setDemat(v.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 16))} />
          <Input label="DP name" placeholder="e.g. HDFC Securities" value={dpName} onChangeText={setDpName} autoCapitalize="words" maxLength={80} />
        </Card>

        <ErrorBox text={error} />
        <Button label="Save details" onPress={() => void save()} loading={busy} disabled={busy} fullWidth size="lg" />
      </View>
    </Screen>
  );
}
