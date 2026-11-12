/**
 * Investor profile — what a mutual fund account needs beyond PAN and bank.
 *
 * The same declaration the website's KYC wizard asks for, checked by the same
 * shared rules (`@shared/portal/onboarding/investorProfile`) and saved through
 * the same edge function, so a client who onboards on the phone ends up with
 * exactly the record a client on the website does.
 *
 * Nothing is pre-selected: these are the investor's own regulatory answers
 * (occupation, income, political exposure, tax residency), the nomination and
 * how they want SIP auto-debit set up. The only default is "India" as the
 * country of birth, which the client can change.
 */
import { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Plus, Trash2 } from 'lucide-react-native';
import { clientSupabase } from '@shared/lib/supabase';
import { OnboardingService } from '@shared/portal/onboarding/onboardingService';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import {
  CONTACT_OWNERS, COUNTRIES, GENDERS, GUARDIAN_RELATIONSHIPS, INCOME_SLABS, MANDATE_PREFERENCES, MAX_MF_NOMINEES,
  MAX_PARENT_NAME, NOMINEE_ID_TYPES, NOMINEE_RELATIONSHIPS, OCCUPATIONS, PEP_STATUSES, WEALTH_SOURCES, ageOn,
  countryName, isCountryCode, validateInvestorProfile, validateMandatePreference, validateNomination,
  type MandatePreferenceInput, type MfNomineeInput, type NominationInput, type Option,
} from '@shared/portal/onboarding/investorProfile';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { ErrorBox } from '@/features/client/profile/OtpConfirm';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { ErrorState, SkeletonScreen } from '@/ui/kit';

interface NomineeRow {
  full_name: string;
  relationship: string;
  dobText: string;
  shareText: string;
  id_type: string;
  id_number: string;
  guardian_name: string;
  guardianDobText: string;
  guardian_pan: string;
  guardian_relationship: string;
}

const blankNominee = (share: string): NomineeRow => ({
  full_name: '', relationship: '', dobText: '', shareText: share, id_type: 'pan', id_number: '',
  guardian_name: '', guardianDobText: '', guardian_pan: '', guardian_relationship: '',
});

function isoToDmy(iso: string | null | undefined): string {
  const [y, m, d] = String(iso ?? '').slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}

/** "DD/MM/YYYY" → "YYYY-MM-DD"; null when blank or not a real past date. */
function dmyToIso(text: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [, d, mo, y] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) return null;
  if (date.getTime() > Date.now() || Number(y) < 1900) return null;
  return `${y}-${mo}-${d}`;
}

/** Typing digits fills the slashes in. */
function maskDmy(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter(Boolean).join('/');
}

export default function InvestorProfile() {
  const clientId = useClientId();
  const p = usePalette();
  const { snapshot, loading, error: loadError, refreshedAt, refresh } = useClientSnapshot(clientId);
  const client = snapshot.client;

  const [ready, setReady] = useState(false);
  const [gender, setGender] = useState('');
  const [occupation, setOccupation] = useState('');
  const [incomeSlab, setIncomeSlab] = useState('');
  const [wealthSource, setWealthSource] = useState('');
  const [pep, setPep] = useState('');
  const [fatherName, setFatherName] = useState('');
  const [spouseName, setSpouseName] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [birthCountry, setBirthCountry] = useState('IND');
  const [taxAbroad, setTaxAbroad] = useState('');
  const [foreignCountry, setForeignCountry] = useState('');
  const [foreignTaxId, setForeignTaxId] = useState('');
  const [mobileOwner, setMobileOwner] = useState('');
  const [emailOwner, setEmailOwner] = useState('');
  const [nomination, setNomination] = useState('');
  const [nominees, setNominees] = useState<NomineeRow[]>([blankNominee('100')]);
  const [mandatePref, setMandatePref] = useState('');
  const [mandateAmount, setMandateAmount] = useState('');
  const [mandateUpi, setMandateUpi] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Start from whatever is already on record — an earlier visit, or details an
  // RM recorded — once, when the client record first arrives.
  useEffect(() => {
    if (ready || !client) return;
    setGender(client.gender || '');
    setOccupation(client.occupation || '');
    setIncomeSlab(client.income_slab || '');
    setWealthSource(client.wealth_source || '');
    setPep(client.pep_status || '');
    setFatherName(client.father_name || '');
    setSpouseName(client.spouse_name || '');
    setBirthPlace(client.birth_place || '');
    setBirthCountry(isCountryCode(client.birth_country) ? client.birth_country : 'IND');
    setTaxAbroad(client.tax_resident_outside_india == null ? '' : client.tax_resident_outside_india ? 'yes' : 'no');
    setForeignCountry(isCountryCode(client.foreign_tax_country) ? client.foreign_tax_country : '');
    setForeignTaxId(client.foreign_tax_id || '');
    setMobileOwner(client.mobile_belongs_to || '');
    setEmailOwner(client.email_belongs_to || '');
    setNomination(client.nomination_choice || '');
    setMandatePref(client.mandate_preference || '');
    setMandateAmount(client.mandate_max_amount ? String(Math.round(Number(client.mandate_max_amount))) : '');
    setMandateUpi(client.mandate_upi_id || '');
    setReady(true);

    void clientSupabase
      .from('nw_client_nominees')
      .select('full_name, relationship, dob, share_percent, id_type, id_number, guardian_name, guardian_dob, guardian_pan, guardian_relationship')
      .eq('client_id', clientId)
      .order('created_at')
      .then(({ data }) => {
        if (!data?.length) return;
        setNominees(data.slice(0, MAX_MF_NOMINEES).map((n) => ({
          full_name: n.full_name || '',
          // An older free-text relationship ("Spouse") has no exchange code — ask again.
          relationship: (NOMINEE_RELATIONSHIPS as readonly string[]).includes(n.relationship ?? '') ? n.relationship! : '',
          dobText: isoToDmy(n.dob),
          shareText: String(Math.round(Number(n.share_percent) || 0) || ''),
          id_type: n.id_type || 'pan',
          id_number: n.id_number || '',
          guardian_name: n.guardian_name || '',
          guardianDobText: isoToDmy(n.guardian_dob),
          guardian_pan: n.guardian_pan || '',
          guardian_relationship: (GUARDIAN_RELATIONSHIPS as readonly string[]).includes(n.guardian_relationship ?? '') ? n.guardian_relationship! : '',
        })));
        setNomination((cur) => cur || 'nominate');
      });
  }, [client, clientId, ready]);

  const upd = (i: number, patch: Partial<NomineeRow>) =>
    setNominees((list) => list.map((n, j) => (j === i ? { ...n, ...patch } : n)));
  const shareTotal = nominees.reduce((sum, n) => sum + (Number(n.shareText) || 0), 0);

  const save = async () => {
    setError(null);
    const profile = {
      gender, occupation, income_slab: incomeSlab, wealth_source: wealthSource, pep_status: pep,
      birth_place: birthPlace, birth_country: birthCountry,
      tax_resident_outside_india: taxAbroad === '' ? null : taxAbroad === 'yes',
      foreign_tax_country: foreignCountry, foreign_tax_id: foreignTaxId,
      father_name: fatherName, spouse_name: spouseName,
      mobile_belongs_to: mobileOwner, email_belongs_to: emailOwner,
    };
    const checkedProfile = validateInvestorProfile(profile);
    if (!checkedProfile.ok) return setError(checkedProfile.error);

    const nominationInput = (nomination === 'opt_out'
      ? { choice: 'opt_out' }
      : {
          choice: nomination,
          nominees: nominees.map((n): MfNomineeInput => ({
            full_name: n.full_name,
            relationship: n.relationship,
            dob: dmyToIso(n.dobText),
            share_percent: Number(n.shareText),
            id_type: n.id_type,
            id_number: n.id_number,
            guardian_name: n.guardian_name,
            guardian_dob: dmyToIso(n.guardianDobText),
            guardian_pan: n.guardian_pan,
            guardian_relationship: n.guardian_relationship,
          })),
        }) as NominationInput;
    const checkedNomination = validateNomination(nominationInput);
    if (!checkedNomination.ok) return setError(checkedNomination.error);

    const mandate: MandatePreferenceInput = { preference: mandatePref, max_amount: mandateAmount, upi_id: mandateUpi };
    const checkedMandate = validateMandatePreference(mandate);
    if (!checkedMandate.ok) return setError(checkedMandate.error);

    setBusy(true);
    const result = await OnboardingService.saveInvestorProfile(clientId, profile, nominationInput, mandate);
    setBusy(false);
    if (!result.ok) return setError(result.error ?? 'We could not save your profile. Please try again.');
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    router.back();
  };

  if (loading && !refreshedAt) {
    return (
      <Screen>
        <ScreenHeader title="Investor profile" showBack />
        <SkeletonScreen rows={4} />
      </Screen>
    );
  }
  if (loadError) {
    return (
      <Screen>
        <ScreenHeader title="Investor profile" showBack />
        <ErrorState message={loadError} onRetry={refresh} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScreenHeader
        title="Investor profile"
        subtitle="Mutual fund regulations ask every investor for these. They are your own declaration, so please answer each one."
        showBack
      />

      <View style={{ gap: space[4] }}>
        <Card padding={4} style={{ gap: space[4] }}>
          <ChipField label="Gender" value={gender} onChange={setGender} options={GENDERS} />
          <ChipField label="Occupation" value={occupation} onChange={setOccupation} options={OCCUPATIONS} />
          <ChipField label="Annual income" value={incomeSlab} onChange={setIncomeSlab} options={INCOME_SLABS} />
          <ChipField label="Main source of wealth" value={wealthSource} onChange={setWealthSource} options={WEALTH_SOURCES} />
        </Card>

        <Card padding={4} style={{ gap: space[3] }}>
          <Input label="Father’s name (optional)" value={fatherName} onChangeText={setFatherName} autoCapitalize="words" maxLength={MAX_PARENT_NAME} />
          <Input label="Spouse’s name (optional)" value={spouseName} onChangeText={setSpouseName} autoCapitalize="words" maxLength={MAX_PARENT_NAME} />
          <Input label="Place of birth" placeholder="City or town" value={birthPlace} onChangeText={setBirthPlace} autoCapitalize="words" maxLength={60} />
          <CountryField label="Country of birth" value={birthCountry} onChange={setBirthCountry} allowIndia />
        </Card>

        <Card padding={4} style={{ gap: space[4] }}>
          <ChipField
            label="Are you a politically exposed person?"
            hint="Someone who holds, or has held, a prominent public position — or is closely related to such a person."
            value={pep} onChange={setPep} options={PEP_STATUSES}
          />
          <ChipField
            label="Do you pay tax in any country other than India?"
            value={taxAbroad} onChange={setTaxAbroad}
            options={[{ value: 'no', label: 'No, only in India' }, { value: 'yes', label: 'Yes' }]}
          />
          {taxAbroad === 'yes' ? (
            <View style={{ gap: space[3] }}>
              <CountryField label="Other country of tax residence" value={foreignCountry} onChange={setForeignCountry} />
              <Input label="Tax identification number there" value={foreignTaxId} onChangeText={setForeignTaxId} autoCapitalize="characters" maxLength={40} />
            </View>
          ) : null}
          <ChipField
            label={`The mobile ${client?.phone ? `ending ${String(client.phone).slice(-4)}` : 'number'} is`}
            value={mobileOwner} onChange={setMobileOwner} options={CONTACT_OWNERS}
          />
          <ChipField label="The email address is" value={emailOwner} onChange={setEmailOwner} options={CONTACT_OWNERS} />
        </Card>

        <Card padding={4} style={{ gap: space[4] }}>
          <ChipField
            label="Nomination"
            hint={`A nominee receives your investments if something happens to you. You can add up to ${MAX_MF_NOMINEES}, or choose not to nominate.`}
            value={nomination} onChange={setNomination}
            options={[{ value: 'nominate', label: 'Add a nominee' }, { value: 'opt_out', label: 'I do not wish to nominate' }]}
          />
          {nomination === 'opt_out' ? (
            <Text variant="caption" tone="warning">
              Without a nominee, your legal heirs will need court or succession documents to claim your investments. You can add a nominee later.
            </Text>
          ) : null}
        </Card>

        {nomination === 'nominate' ? (
          <>
            {nominees.map((n, i) => {
              const iso = dmyToIso(n.dobText);
              const age = iso ? ageOn(iso) : null;
              const minor = age !== null && age < 18;
              return (
                <Card key={i} padding={4} style={{ gap: space[3] }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text variant="overline" tone="muted" caps>Nominee {i + 1}</Text>
                    {nominees.length > 1 ? (
                      <Pressable hitSlop={12} accessibilityRole="button" accessibilityLabel={`Remove nominee ${i + 1}`}
                        onPress={() => setNominees((l) => l.filter((_, j) => j !== i))}>
                        <Trash2 size={18} color={p.text.faint} />
                      </Pressable>
                    ) : null}
                  </View>
                  <Input label="Full name" value={n.full_name} onChangeText={(v) => upd(i, { full_name: v })} autoCapitalize="words" />
                  <ChipField label="Relationship to you" value={n.relationship} onChange={(v) => upd(i, { relationship: v })}
                    options={NOMINEE_RELATIONSHIPS.map((r) => ({ value: r, label: r }))} />
                  <View style={{ flexDirection: 'row', gap: space[3] }}>
                    <Input label="Date of birth" placeholder="DD/MM/YYYY" value={n.dobText} keyboardType="number-pad" maxLength={10}
                      onChangeText={(v) => upd(i, { dobText: maskDmy(v) })} containerStyle={{ flex: 3 }} />
                    <Input label="Share %" value={n.shareText} keyboardType="number-pad"
                      onChangeText={(v) => upd(i, { shareText: v.replace(/\D/g, '').slice(0, 3) })} containerStyle={{ flex: 2 }} />
                  </View>
                  <ChipField label="Identity document" value={n.id_type} onChange={(v) => upd(i, { id_type: v, id_number: '' })} options={NOMINEE_ID_TYPES} />
                  <Input
                    label={n.id_type === 'aadhaar_last4' ? 'Last 4 digits of Aadhaar' : 'Document number'}
                    hint={n.id_type === 'aadhaar_last4' ? 'Only the last four digits — we never store the full number.' : undefined}
                    value={n.id_number}
                    keyboardType={n.id_type === 'aadhaar_last4' ? 'number-pad' : 'default'}
                    autoCapitalize="characters"
                    maxLength={n.id_type === 'aadhaar_last4' ? 4 : n.id_type === 'pan' ? 10 : 20}
                    onChangeText={(v) => upd(i, {
                      id_number: n.id_type === 'aadhaar_last4' ? v.replace(/\D/g, '').slice(0, 4) : v.toUpperCase().replace(/[^A-Z0-9-]/g, ''),
                    })}
                  />
                  {minor ? (
                    <View style={{ gap: space[3], borderTopWidth: 1, borderTopColor: p.border.DEFAULT, paddingTop: space[3] }}>
                      <Text variant="caption" tone="muted">This nominee is under 18, so a guardian is needed.</Text>
                      <Input label="Guardian’s full name" value={n.guardian_name} onChangeText={(v) => upd(i, { guardian_name: v })} autoCapitalize="words" />
                      <ChipField label="Guardian is the nominee’s" value={n.guardian_relationship} onChange={(v) => upd(i, { guardian_relationship: v })}
                        options={GUARDIAN_RELATIONSHIPS.map((g) => ({ value: g, label: g }))} />
                      <Input label="Guardian’s date of birth" placeholder="DD/MM/YYYY" value={n.guardianDobText} keyboardType="number-pad" maxLength={10}
                        onChangeText={(v) => upd(i, { guardianDobText: maskDmy(v) })} />
                      <Input label="Guardian’s PAN" format="pan" placeholder="ABCDE1234F" value={n.guardian_pan} maxLength={10}
                        onChangeText={(v) => upd(i, { guardian_pan: v })} />
                    </View>
                  ) : null}
                </Card>
              );
            })}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Button label="Add nominee" icon={Plus} variant="ghost" size="sm" disabled={nominees.length >= MAX_MF_NOMINEES}
                onPress={() => setNominees((l) => [...l, blankNominee('')])} />
              <Text variant="caption" tone={shareTotal === 100 ? 'success' : 'warning'}>
                Shares total {shareTotal}%{shareTotal === 100 ? '' : ' — must be 100%'}
              </Text>
            </View>
          </>
        ) : null}

        <Card padding={4} style={{ gap: space[4] }}>
          <ChipField
            label="Auto-debit for SIPs"
            hint={`A SIP is paid by an auto-debit from ${client?.bank_account ? `the bank account ending ${String(client.bank_account).slice(-4)}` : 'the bank account on record'}. Nothing is debited until a SIP is started and the mandate is approved with the bank.`}
            value={mandatePref} onChange={setMandatePref} options={MANDATE_PREFERENCES}
          />
          {mandatePref === 'enach' || mandatePref === 'upi' ? (
            <View style={{ gap: space[3] }}>
              <Input label="Maximum per debit (₹)" placeholder="e.g. 25000" value={mandateAmount} keyboardType="number-pad"
                hint="The most that may be debited at one time — set it above the largest SIP planned."
                onChangeText={(v) => setMandateAmount(v.replace(/\D/g, '').slice(0, 8))} />
              {mandatePref === 'upi' ? (
                <Input label="UPI ID" placeholder="name@bank" value={mandateUpi} autoCapitalize="none" keyboardType="email-address"
                  onChangeText={(v) => setMandateUpi(v.trim())} />
              ) : null}
            </View>
          ) : null}
        </Card>

        <ErrorBox text={error} />
        <Button label="Save investor profile" onPress={() => void save()} loading={busy} disabled={busy} fullWidth size="lg" />
      </View>
    </Screen>
  );
}

/** One question answered by tapping a chip. Nothing is selected until tapped. */
function ChipField({ label, hint, value, onChange, options }:
  { label: string; hint?: string; value: string; onChange: (v: string) => void; options: Option[] }) {
  const p = usePalette();
  return (
    <View>
      <Text variant="caption" tone="secondary">{label}</Text>
      {hint ? <Text variant="caption" tone="faint" style={{ marginTop: space[1] }}>{hint}</Text> : null}
      <View accessibilityRole="radiogroup" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[2] }}>
        {options.map((o) => {
          const on = value === o.value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => onChange(o.value)}
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
  );
}

/**
 * A country, stored as its three-letter code. A list of 249 is no good as
 * chips, so the choice is shown and changed by typing a few letters.
 */
function CountryField({ label, value, onChange, allowIndia }:
  { label: string; value: string; onChange: (code: string) => void; allowIndia?: boolean }) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(!value);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return COUNTRIES.filter((c) => (allowIndia || c.code !== 'IND') && c.name.toLowerCase().includes(q)).slice(0, 6);
  }, [query, allowIndia]);

  if (value && !searching) {
    return (
      <View>
        <Text variant="caption" tone="secondary">{label}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space[2] }}>
          <Text variant="smallMedium">{countryName(value)}</Text>
          <Button label="Change" variant="ghost" size="sm" onPress={() => { setQuery(''); setSearching(true); }} />
        </View>
      </View>
    );
  }
  return (
    <View style={{ gap: space[2] }}>
      <Input label={label} placeholder="Type the first letters" value={query} onChangeText={setQuery} autoCapitalize="words" />
      <ChipField label="" value={value} options={matches.map((c) => ({ value: c.code, label: c.name }))}
        onChange={(code) => { onChange(code); setSearching(false); }} />
    </View>
  );
}
