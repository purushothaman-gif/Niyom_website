/**
 * Partner Account — the DSA's own details, referral link and settings.
 *
 * PAN and bank account arrive ALREADY MASKED from `nw_partner_profile`. That is
 * server-side, not a display choice here: the RPC never sends the raw values,
 * so there is nothing on this device that could reveal them.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Share, View } from 'react-native';
import { router } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import {
  Building2,
  Check,
  Copy,
  CreditCard,
  KeyRound,
  LogOut,
  Mail,
  MapPin,
  Moon,
  Phone,
  Share2,
  Sun,
  SunMoon,
  UserPlus,
} from 'lucide-react-native';
import { PartnerService } from '@shared/partner/services/PartnerService';
import { buildReferralUrl } from '@shared/marketing/marketingConstants';
import { space } from '@/design/tokens';
import { useTheme, type ThemePreference } from '@/design/ThemeProvider';
import { useAuth } from '@/features/auth/AuthContext';
import { usePartnerQuery } from '@/features/partner/usePartnerData';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { ErrorState, ListRow, Segmented, SkeletonScreen, StatusPill } from '@/ui/kit';

export default function PartnerAccount() {
  const { signOut } = useAuth();
  const { theme: p, preference, setPreference } = useTheme();

  const load = useCallback(
    () => Promise.all([PartnerService.getProfile(), PartnerService.getReferral()]),
    [],
  );
  const { data, loading, error, refresh } = usePartnerQuery(load);
  const [profile, referral] = data ?? [null, null];

  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1800);
    return () => clearTimeout(t);
  }, [copied]);

  /*
   * The link is BUILT from the opaque 8-character code, not stored — the same
   * `buildReferralUrl` the CRM uses, so the app cannot drift into pointing at a
   * different origin or a different landing path.
   */
  const link = referral?.ref_code ? buildReferralUrl(referral.ref_code) : null;

  const copyLink = async () => {
    if (!link) return;
    await Clipboard.setStringAsync(link);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setCopied(true);
  };

  const shareLink = async () => {
    if (!link) return;
    try {
      await Share.share({
        message: `Open a free investment account with Niyom Wealth: ${link}`,
      });
    } catch {
      /* the user dismissed the sheet */
    }
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

  return (
    <Screen onRefresh={refresh} refreshing={loading && !!data} tabBarInset>
      <ScreenHeader title="Account" subtitle="Your details, referral link and settings." />

      {loading && !data ? (
        <SkeletonScreen rows={3} />
      ) : error ? (
        <ErrorState message={error} onRetry={refresh} />
      ) : profile ? (
        <View style={{ gap: space[6] }}>
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
                  {initials(profile.full_name)}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="h3" numberOfLines={2}>
                  {profile.full_name}
                </Text>
                <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                  {profile.dsa_code}
                </Text>
              </View>
            </View>
            <View style={{ marginTop: space[4] }}>
              <StatusPill
                dot
                tone={profile.status === 'active' ? 'success' : 'warning'}
                label={`Partner status: ${profile.status}`}
              />
            </View>
          </Card>

          {/* ---------------------------- referral ------------------------ */}
          <View>
            <Text variant="overline" tone="muted" caps style={{ marginBottom: space[3] }}>
              Referral link
            </Text>
            <Card padding={4}>
              {link ? (
                <>
                  <Text variant="small" tone="secondary" selectable numberOfLines={2}>
                    {link}
                  </Text>
                  <View style={{ flexDirection: 'row', gap: space[3], marginTop: space[4] }}>
                    <Button
                      label={copied ? 'Copied' : 'Copy'}
                      icon={copied ? Check : Copy}
                      variant="secondary"
                      size="sm"
                      onPress={() => void copyLink()}
                      style={{ flex: 1 }}
                      fullWidth
                    />
                    <Button
                      label="Share"
                      icon={Share2}
                      size="sm"
                      onPress={() => void shareLink()}
                      style={{ flex: 1 }}
                      fullWidth
                    />
                  </View>
                  <Text variant="caption" tone="faint" style={{ marginTop: space[3] }}>
                    Anyone who opens an account through this link is attributed to you.
                  </Text>
                </>
              ) : (
                <Text variant="small" tone="muted">
                  Your referral link is being set up. Check back shortly, or ask your relationship
                  manager.
                </Text>
              )}
            </Card>
          </View>

          {/* ----------------------------- contact ------------------------ */}
          <View>
            <Text variant="overline" tone="muted" caps style={{ marginBottom: space[3] }}>
              Your details
            </Text>
            <Card padding={4}>
              <ListRow icon={Mail} title="Email" subtitle={profile.email || '—'} />
              <ListRow icon={Phone} title="Mobile" subtitle={profile.mobile || '—'} />
              <ListRow icon={CreditCard} title="PAN" subtitle={profile.pan_masked || '—'} />
              <ListRow icon={MapPin} title="Address" subtitle={profile.address || '—'} />
              <ListRow
                icon={Building2}
                title={profile.bank_name || 'Bank account'}
                subtitle={[profile.bank_account_masked, profile.bank_ifsc].filter(Boolean).join(' · ') || '—'}
                last
              />
            </Card>
            <Text variant="caption" tone="faint" style={{ marginTop: space[2] }}>
              Contact your relationship manager to change any of these.
            </Text>
          </View>

          {/* ------------------------------ actions ----------------------- */}
          <View>
            <Text variant="overline" tone="muted" caps style={{ marginBottom: space[3] }}>
              Business
            </Text>
            <Card padding={4}>
              <ListRow
                icon={UserPlus}
                title="Submit a lead"
                subtitle="Pass a prospect to Niyom"
                showChevron
                onPress={() => router.push('/partner-submit-lead')}
              />
              <ListRow
                icon={KeyRound}
                title="Sign-in PIN"
                subtitle="Unlock this device with 4 digits"
                showChevron
                onPress={() => router.push('/partner-set-pin')}
                last
              />
            </Card>
          </View>

          {/* --------------------------- appearance ----------------------- */}
          <View>
            <Text variant="overline" tone="muted" caps style={{ marginBottom: space[3] }}>
              Appearance
            </Text>
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
              style={{ flexDirection: 'row', alignItems: 'center', gap: space[2], marginTop: space[3] }}
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
          </View>

          <Button label="Sign out" variant="danger" icon={LogOut} onPress={confirmSignOut} fullWidth />
        </View>
      ) : null}
    </Screen>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}
