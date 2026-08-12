/**
 * Profile — the client's own details, and how the app behaves.
 *
 * ## What is shown and what is not
 *
 * PAN and bank account numbers are MASKED here, even though the client owns
 * them and the record is already theirs. The reason is the screen, not the
 * data: a profile page is the one people hold up to show someone something
 * else, and it is read over shoulders on trains. The full value is never a tap
 * away either — changing either is an RM's job, which is also why nothing on
 * this screen is editable.
 *
 * ## The PIN section is the part that earns its place
 *
 * Setting a PIN is what makes the five-minute idle timeout tolerable: getting
 * back in becomes four digits and a glance instead of a password. So it is
 * offered here permanently, not only in the prompt after signing in.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import * as LocalAuthentication from 'expo-local-authentication';
import {
  Building2,
  CreditCard,
  Fingerprint,
  KeyRound,
  LogOut,
  Mail,
  MapPin,
  Moon,
  Phone,
  ScanFace,
  ShieldCheck,
  Smartphone,
  Sun,
  SunMoon,
  UserRound,
} from 'lucide-react-native';
import { fmtDate } from '@shared/crm/utils';
import { ProfileService } from '@shared/portal/services/ProfileService';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import type { NWClientBankAccount } from '@shared/crm/types';
import { space } from '@/design/tokens';
import { useTheme, type ThemePreference } from '@/design/ThemeProvider';
import { useAuth, useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { forgetBiometricPin, hasBiometricPin, hasProfile } from '@/platform/device';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { ErrorState, ListRow, Segmented, SkeletonScreen, StatusPill } from '@/ui/kit';

export default function Profile() {
  const clientId = useClientId();
  const { signOut } = useAuth();
  const { theme: p, preference, setPreference } = useTheme();
  const { snapshot, loading, error, refreshedAt, refresh } = useClientSnapshot(clientId);

  const [banks, setBanks] = useState<NWClientBankAccount[]>([]);
  const [pinSet, setPinSet] = useState(false);
  const [bioSet, setBioSet] = useState(false);
  const [bioKind, setBioKind] = useState<'face' | 'fingerprint'>('fingerprint');

  const client = snapshot.client;
  const hasData = !!refreshedAt;

  useEffect(() => {
    void ProfileService.getBankAccounts(clientId).then(setBanks).catch(() => setBanks([]));
  }, [clientId]);

  const refreshDeviceState = useCallback(async () => {
    const [pin, bio, types] = await Promise.all([
      hasProfile('client', clientId),
      hasBiometricPin('client', clientId),
      LocalAuthentication.supportedAuthenticationTypesAsync(),
    ]);
    setPinSet(pin);
    setBioSet(bio);
    setBioKind(
      types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)
        ? 'face'
        : 'fingerprint',
    );
  }, [clientId]);

  useEffect(() => {
    void refreshDeviceState();
  }, [refreshDeviceState]);

  const disableBiometric = () => {
    Alert.alert(
      bioKind === 'face' ? 'Turn off Face ID?' : 'Turn off fingerprint unlock?',
      'Your PIN keeps working — you will just type it instead.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Turn off',
          style: 'destructive',
          onPress: () => {
            void forgetBiometricPin('client', clientId).then(refreshDeviceState);
          },
        },
      ],
    );
  };

  const confirmSignOut = () => {
    Alert.alert('Sign out?', 'You will need your PIN or password to get back in.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: () => void signOut('user').then(() => router.replace('/')),
      },
    ]);
  };

  const primaryBank = banks.find((b) => b.is_primary) ?? banks[0];

  return (
    <Screen onRefresh={refresh} refreshing={loading && hasData}>
      <ScreenHeader
        title="Profile"
        subtitle="Your personal, bank and KYC details — and how the app behaves."
        showBack
      />

      {!hasData && loading ? (
        <SkeletonScreen rows={3} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : client ? (
        <View style={{ gap: space[6] }}>
          {/* ------------------------------ identity ----------------------- */}
          <Card padding={5}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[4] }}>
              <View
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 999,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: p.accent.tint(0.16),
                }}
              >
                <Text variant="h2" tone="accent">
                  {initials(client.full_name)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="h3" numberOfLines={2}>
                  {client.full_name}
                </Text>
                <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                  {client.client_code}
                </Text>
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: space[2], marginTop: space[4], flexWrap: 'wrap' }}>
              <StatusPill
                dot
                tone={client.onboarding_status === 'active' ? 'success' : 'warning'}
                label={
                  client.onboarding_status === 'active'
                    ? 'Account active'
                    : humanise(client.onboarding_status)
                }
              />
              <StatusPill
                dot
                tone={client.verification_status === 'verified' ? 'success' : 'warning'}
                label={`KYC ${client.verification_status}`}
              />
            </View>

            {client.onboarding_status !== 'active' ? (
              <View style={{ marginTop: space[4] }}>
                <Button
                  label="Complete your KYC"
                  icon={ShieldCheck}
                  onPress={() => router.push('/onboarding')}
                  fullWidth
                />
              </View>
            ) : null}
          </Card>

          {/* ------------------------------ contact ------------------------ */}
          <Section title="Contact">
            <Card padding={4}>
              <ListRow icon={Mail} title="Email" subtitle={client.email || '—'} />
              <ListRow icon={Phone} title="Mobile" subtitle={client.phone || '—'} />
              <ListRow
                icon={MapPin}
                title="Address"
                subtitle={[client.address, client.city, client.state].filter(Boolean).join(', ') || '—'}
                last
              />
            </Card>
            <Text variant="caption" tone="faint" style={{ marginTop: space[2] }}>
              Your relationship manager updates these — contact them to change anything.
            </Text>
          </Section>

          {/* ------------------------------- KYC --------------------------- */}
          <Section title="KYC">
            <Card padding={4}>
              <ListRow icon={CreditCard} title="PAN" subtitle={maskPan(client.pan)} />
              <ListRow
                icon={UserRound}
                title="Date of birth"
                subtitle={client.dob ? fmtDate(client.dob) : '—'}
                last={!primaryBank}
              />
              {primaryBank ? (
                <ListRow
                  icon={Building2}
                  title={primaryBank.bank_name || 'Bank account'}
                  subtitle={`${maskAccount(primaryBank.account_number)} · ${primaryBank.ifsc}`}
                  last
                />
              ) : null}
            </Card>
          </Section>

          {/* ---------------------------- security ------------------------- */}
          <Section title="Security">
            <Card padding={4}>
              <ListRow
                icon={KeyRound}
                title="Sign-in PIN"
                subtitle={
                  pinSet
                    ? 'A 4-digit PIN unlocks this device'
                    : 'Set one to sign in without your password'
                }
                showChevron
                onPress={() => router.push('/set-pin')}
              />
              <ListRow
                icon={bioKind === 'face' ? ScanFace : Fingerprint}
                title={bioKind === 'face' ? 'Face ID' : 'Fingerprint unlock'}
                subtitle={
                  bioSet
                    ? 'On — unlocks with your saved PIN'
                    : pinSet
                      ? 'Off — turn on from the PIN screen'
                      : 'Set a PIN first'
                }
                showChevron={bioSet}
                onPress={bioSet ? disableBiometric : undefined}
              />
              <ListRow
                icon={Smartphone}
                title="Change password"
                subtitle="Choose a new password for your account"
                showChevron
                onPress={() => router.push('/change-my-password')}
                last
              />
            </Card>
          </Section>

          {/* --------------------------- appearance ------------------------ */}
          <Section title="Appearance">
            <Segmented<ThemePreference>
              value={preference}
              onChange={setPreference}
              options={[
                { value: 'system', label: 'System' },
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
              ]}
            />
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space[2],
                marginTop: space[3],
              }}
            >
              {preference === 'system' ? (
                <SunMoon size={14} color={p.text.faint} />
              ) : preference === 'light' ? (
                <Sun size={14} color={p.text.faint} />
              ) : (
                <Moon size={14} color={p.text.faint} />
              )}
              <Text variant="caption" tone="faint">
                {preference === 'system'
                  ? 'Following your phone’s appearance setting.'
                  : `Always ${preference}, whatever your phone is set to.`}
              </Text>
            </View>
          </Section>

          <Button label="Sign out" variant="danger" icon={LogOut} onPress={confirmSignOut} fullWidth />
        </View>
      ) : null}
    </Screen>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View>
      <Text variant="overline" tone="muted" caps style={{ marginBottom: space[3] }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

/** "ANAND KRISHNAMURTHY" → "AK". */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** "ABCDE1234F" → "ABCDE••••F" — recognisable, not readable over a shoulder. */
function maskPan(pan: string): string {
  if (!pan || pan.length < 10) return pan || '—';
  return `${pan.slice(0, 5)}••••${pan.slice(9)}`;
}

/** Last four only, which is all anyone needs to tell two accounts apart. */
function maskAccount(account: string): string {
  if (!account) return '—';
  return account.length <= 4 ? account : `••••${account.slice(-4)}`;
}

function humanise(status: string): string {
  return status.replace(/_/g, ' ').replace(/^kyc/i, 'KYC').replace(/^./, (c) => c.toUpperCase());
}
