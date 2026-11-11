/**
 * Profile — the client's own details, and how the app behaves.
 *
 * ## What is shown and what is not
 *
 * PAN and bank account numbers are MASKED here, even though the client owns
 * them and the record is already theirs. The reason is the screen, not the
 * data: a profile page is the one people hold up to show someone something
 * else, and it is read over shoulders on trains. The full value is never a tap
 * away either.
 *
 * ## What can be changed here
 *
 * Contact details, nominees and bank accounts — each on its own screen, each
 * confirmed with a code emailed to the registered address and applied by the
 * `client-profile-update` edge function (which logs it and alerts the RM). A
 * NEW bank account waits for the RM's approval before it is used. PAN, name
 * and date of birth stay read-only: those are KYC facts, not preferences.
 *
 * ## The PIN section is the part that earns its place
 *
 * Setting a PIN is what makes the five-minute idle timeout tolerable: getting
 * back in becomes four digits and a glance instead of a password. So it is
 * offered here permanently, not only in the prompt after signing in.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
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
  Pencil,
  Phone,
  Plus,
  ScanFace,
  ShieldCheck,
  Smartphone,
  Sun,
  SunMoon,
  UserRound,
  Users,
} from 'lucide-react-native';
import { fmtDate } from '@shared/crm/utils';
import { ProfileService } from '@shared/portal/services/ProfileService';
import { ProfileEditService, type Nominee } from '@shared/portal/services/ProfileEditService';
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
  const [nominees, setNominees] = useState<Nominee[] | null>(null);
  const [pinSet, setPinSet] = useState(false);
  const [bioSet, setBioSet] = useState(false);
  const [bioKind, setBioKind] = useState<'face' | 'fingerprint'>('fingerprint');

  const client = snapshot.client;
  const hasData = !!refreshedAt;

  // Reloaded every time the screen regains focus, so a change made on one of
  // the edit screens is showing by the time the client lands back here.
  useFocusEffect(
    useCallback(() => {
      void ProfileService.getBankAccounts(clientId).then(setBanks).catch(() => setBanks([]));
      void ProfileEditService.getNominees(clientId).then(setNominees).catch(() => setNominees([]));
      refresh();
    }, [clientId, refresh]),
  );

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

  // Fall back to the primary-bank mirror on the client record if the table is empty.
  const bankList: NWClientBankAccount[] =
    banks.length === 0 && client?.bank_account
      ? [
          {
            id: 'primary',
            client_id: clientId,
            account_number: client.bank_account,
            ifsc: client.bank_ifsc ?? '',
            bank_name: client.bank_name ?? '',
            holder_name: client.full_name,
            label: '',
            is_primary: true,
            created_at: '',
            updated_at: '',
          },
        ]
      : banks;
  const usableCount = bankList.filter(isUsable).length;

  const bankAction = (kind: 'bank_delete' | 'bank_primary', a: NWClientBankAccount) =>
    router.push({
      pathname: '/profile-edit-bank',
      params: { action: kind, id: a.id, label: `${a.bank_name || 'Bank'} ${maskAccount(a.account_number)}` },
    } as never);

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
            <View style={{ marginTop: space[3] }}>
              <Button
                label="Edit mobile, email & address"
                icon={Pencil}
                variant="secondary"
                size="sm"
                onPress={() => router.push('/profile-edit-contact' as never)}
              />
            </View>
          </Section>

          {/* ------------------------------- KYC --------------------------- */}
          <Section title="KYC">
            <Card padding={4}>
              <ListRow icon={CreditCard} title="PAN" subtitle={maskPan(client.pan)} />
              <ListRow
                icon={UserRound}
                title="Date of birth"
                subtitle={client.dob ? fmtDate(client.dob) : '—'}
                last
              />
            </Card>
          </Section>

          {/* ----------------------------- nominees ------------------------ */}
          <Section title="Nominees">
            <Card padding={4}>
              {nominees === null ? (
                <ListRow icon={Users} title="Loading…" last />
              ) : nominees.length === 0 ? (
                <ListRow
                  icon={Users}
                  title="No nominees yet"
                  subtitle="Add who should receive your investments — it takes a minute."
                  last
                />
              ) : (
                nominees.map((n, i) => (
                  <ListRow
                    key={n.id ?? i}
                    icon={UserRound}
                    title={n.full_name}
                    subtitle={[n.relationship, n.dob ? fmtDate(n.dob) : null].filter(Boolean).join(' · ')}
                    value={`${n.share_percent}%`}
                    last={i === nominees.length - 1}
                  />
                ))
              )}
            </Card>
            <View style={{ marginTop: space[3] }}>
              <Button
                label={nominees?.length ? 'Edit nominees' : 'Add nominees'}
                icon={nominees?.length ? Pencil : Plus}
                variant="secondary"
                size="sm"
                onPress={() => router.push('/profile-edit-nominees' as never)}
              />
            </View>
          </Section>

          {/* ------------------------------- bank -------------------------- */}
          <Section title="Bank accounts">
            {bankList.length === 0 ? (
              <Card padding={4}>
                <ListRow icon={Building2} title="No bank account on file" last />
              </Card>
            ) : (
              <View style={{ gap: space[3] }}>
                {bankList.map((a) => {
                  const st = statusOf(a);
                  const note = (a as { review_note?: string | null }).review_note;
                  const lastUsable = isUsable(a) && usableCount <= 1;
                  return (
                    <Card key={a.id} padding={4}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
                        <Building2 size={20} color={p.text.muted} />
                        <View style={{ flex: 1 }}>
                          <Text variant="bodyMedium" numberOfLines={1}>
                            {a.bank_name || 'Bank account'}
                          </Text>
                          <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                            {maskAccount(a.account_number)} · {a.ifsc || '—'}
                          </Text>
                        </View>
                      </View>
                      <View style={{ flexDirection: 'row', gap: space[2], marginTop: space[3], flexWrap: 'wrap' }}>
                        {a.is_primary ? <StatusPill tone="accent" label="Primary" /> : null}
                        {st === 'pending' ? <StatusPill tone="warning" label="Awaiting RM approval" /> : null}
                        {st === 'rejected' ? <StatusPill tone="danger" label="Not approved" /> : null}
                        {st === 'verified' ? <StatusPill tone="success" label="Approved" /> : null}
                      </View>
                      {st === 'rejected' && note ? (
                        <Text variant="caption" tone="danger" style={{ marginTop: space[2] }}>
                          Reason: {note}
                        </Text>
                      ) : null}
                      {a.id !== 'primary' ? (
                        <View style={{ flexDirection: 'row', gap: space[2], marginTop: space[3] }}>
                          {!a.is_primary && isUsable(a) ? (
                            <Button
                              label="Make primary"
                              variant="secondary"
                              size="sm"
                              onPress={() => bankAction('bank_primary', a)}
                            />
                          ) : null}
                          <Button
                            label={st === 'pending' ? 'Withdraw' : 'Remove'}
                            variant="ghost"
                            size="sm"
                            disabled={lastUsable}
                            onPress={() => bankAction('bank_delete', a)}
                          />
                        </View>
                      ) : null}
                      {a.id !== 'primary' && lastUsable ? (
                        <Text variant="caption" tone="faint" style={{ marginTop: space[2] }}>
                          At least one approved bank account must stay on your profile.
                        </Text>
                      ) : null}
                    </Card>
                  );
                })}
              </View>
            )}
            <View style={{ marginTop: space[3] }}>
              <Button
                label="Add bank account"
                icon={Plus}
                variant="secondary"
                size="sm"
                onPress={() => router.push('/profile-edit-bank' as never)}
              />
            </View>
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

const statusOf = (a: unknown) =>
  String((a as { verification_status?: string }).verification_status ?? '');
/** In use: not awaiting approval and not rejected. */
const isUsable = (a: unknown) => !['pending', 'rejected', 'failed'].includes(statusOf(a));

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
