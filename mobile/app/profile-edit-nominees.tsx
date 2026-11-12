/**
 * Nominees — add, edit or remove who receives the investments.
 *
 * The whole list is saved as one change (shares must total 100%), confirmed
 * with an emailed code. A minor nominee needs a guardian. Saving an empty list
 * removes every nominee, and says so.
 */
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { Plus, Trash2 } from 'lucide-react-native';
import { ProfileEditService, type Nominee } from '@shared/portal/services/ProfileEditService';
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
import { SkeletonScreen } from '@/ui/kit';

import { NOMINEE_RELATIONSHIPS } from '@shared/portal/onboarding/investorProfile';

// The exchange's own relationship list, shared with onboarding and the
// website, so a nominee added here can be sent on as is.
const RELATIONSHIPS: readonly string[] = NOMINEE_RELATIONSHIPS;

/** The form keeps DOB as DD/MM/YYYY text and share as text; both convert on save. */
interface Row {
  nominee: Nominee;
  dobText: string;
  shareText: string;
}

const toRow = (n: Nominee): Row => ({
  nominee: { ...n },
  dobText: n.dob ? isoToDmy(n.dob) : '',
  shareText: String(n.share_percent),
});

const blankRow = (share: number): Row =>
  toRow({
    full_name: '',
    relationship: '',
    dob: null,
    share_percent: share,
    guardian_name: null,
    mobile: null,
    email: null,
    address: null,
  });

function isoToDmy(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return y && m && d ? `${d}/${m}/${y}` : '';
}

/** "DD/MM/YYYY" → "YYYY-MM-DD"; null when blank; undefined when not a real date. */
function dmyToIso(text: string): string | null | undefined {
  const t = text.trim();
  if (!t) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(t);
  if (!m) return undefined;
  const [, d, mo, y] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) return undefined;
  if (date.getTime() > Date.now() || Number(y) < 1900) return undefined;
  return `${y}-${mo}-${d}`;
}

/** Typing digits fills the slashes in. */
function maskDmy(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter(Boolean).join('/');
}

function isMinor(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  const t = new Date();
  let age = t.getFullYear() - d.getFullYear();
  if (t.getMonth() < d.getMonth() || (t.getMonth() === d.getMonth() && t.getDate() < d.getDate())) age--;
  return age < 18;
}

export default function ProfileEditNominees() {
  const clientId = useClientId();
  const p = usePalette();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [step, setStep] = useState<'form' | 'otp'>('form');
  const [error, setError] = useState<string | null>(null);
  const [toSave, setToSave] = useState<Nominee[]>([]);

  useEffect(() => {
    ProfileEditService.getNominees(clientId)
      .then((list) => setRows(list.length ? list.map(toRow) : [blankRow(100)]))
      .catch(() => setRows([blankRow(100)]));
  }, [clientId]);

  const list = rows ?? [];
  const total = Math.round(list.reduce((s, r) => s + (Number(r.shareText) || 0), 0) * 100) / 100;
  const upd = (i: number, patch: Partial<Row>) =>
    setRows((l) => (l ?? []).map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const updN = (i: number, patch: Partial<Nominee>) =>
    setRows((l) => (l ?? []).map((r, j) => (j === i ? { ...r, nominee: { ...r.nominee, ...patch } } : r)));

  const next = () => {
    const out: Nominee[] = [];
    for (const r of list) {
      const dob = dmyToIso(r.dobText);
      if (r.nominee.full_name.trim().length < 2) return setError('Enter every nominee’s full name.');
      if (!r.nominee.relationship) return setError('Choose each nominee’s relationship to you.');
      if (dob === undefined) return setError('Enter each date of birth as DD/MM/YYYY.');
      if (isMinor(dob) && !(r.nominee.guardian_name ?? '').trim()) return setError('A minor nominee needs a guardian’s name.');
      const share = Number(r.shareText);
      if (!(share > 0 && share <= 100)) return setError('Each share must be between 1 and 100%.');
      out.push({
        ...r.nominee,
        full_name: r.nominee.full_name.trim(),
        dob,
        share_percent: share,
        guardian_name: isMinor(dob) ? (r.nominee.guardian_name ?? '').trim() : r.nominee.guardian_name,
      });
    }
    if (out.length && Math.abs(total - 100) > 0.001) return setError(`Shares must add up to 100% (now ${total}%).`);
    setError(null);
    setToSave(out);
    setStep('otp');
  };

  return (
    <Screen>
      <ScreenHeader
        title="Nominees"
        subtitle={step === 'form' ? 'Who should receive your investments.' : 'Confirm it is you.'}
        showBack
      />

      {!rows ? (
        <SkeletonScreen rows={2} />
      ) : step === 'form' ? (
        <View style={{ gap: space[4] }}>
          {list.map((r, i) => {
            const iso = dmyToIso(r.dobText);
            return (
              <Card key={i} padding={4} style={{ gap: space[3] }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Text variant="overline" tone="muted" caps>
                    Nominee {i + 1}
                  </Text>
                  <Pressable
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove nominee ${i + 1}`}
                    onPress={() => setRows((l) => (l ?? []).filter((_, j) => j !== i))}
                  >
                    <Trash2 size={18} color={p.text.faint} />
                  </Pressable>
                </View>
                <Input label="Full name" value={r.nominee.full_name} onChangeText={(v) => updN(i, { full_name: v })} autoCapitalize="words" />
                <View>
                  <Text variant="caption" tone="secondary" style={{ marginBottom: space[2] }}>
                    Relationship
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
                    {RELATIONSHIPS.map((rel) => {
                      const on = r.nominee.relationship === rel;
                      return (
                        <Pressable
                          key={rel}
                          accessibilityRole="button"
                          accessibilityState={{ selected: on }}
                          onPress={() => updN(i, { relationship: rel })}
                          style={{
                            paddingHorizontal: space[3],
                            paddingVertical: space[2],
                            borderRadius: radius.md,
                            borderWidth: 1,
                            borderColor: on ? p.accent.DEFAULT : p.border.DEFAULT,
                            backgroundColor: on ? p.accent.tint(0.14) : 'transparent',
                          }}
                        >
                          <Text variant="small" tone={on ? 'accent' : 'muted'}>
                            {rel}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
                <View style={{ flexDirection: 'row', gap: space[3] }}>
                  <Input
                    label="Date of birth"
                    placeholder="DD/MM/YYYY"
                    value={r.dobText}
                    onChangeText={(v) => upd(i, { dobText: maskDmy(v) })}
                    keyboardType="number-pad"
                    maxLength={10}
                    containerStyle={{ flex: 3 }}
                  />
                  <Input
                    label="Share %"
                    value={r.shareText}
                    onChangeText={(v) => upd(i, { shareText: v.replace(/[^0-9.]/g, '').slice(0, 6) })}
                    keyboardType="decimal-pad"
                    containerStyle={{ flex: 2 }}
                  />
                </View>
                {isMinor(iso) ? (
                  <Input
                    label="Guardian’s name (nominee is a minor)"
                    value={r.nominee.guardian_name ?? ''}
                    onChangeText={(v) => updN(i, { guardian_name: v })}
                    autoCapitalize="words"
                  />
                ) : null}
              </Card>
            );
          })}

          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <Button
              label="Add nominee"
              icon={Plus}
              variant="ghost"
              size="sm"
              disabled={list.length >= 10}
              onPress={() => setRows((l) => [...(l ?? []), blankRow(Math.max(0, 100 - total))])}
            />
            <Text variant="caption" tone={Math.abs(total - 100) < 0.001 || !list.length ? 'success' : 'warning'}>
              Total {total}%
            </Text>
          </View>
          {!list.length ? (
            <Text variant="caption" tone="muted">
              Saving with no nominees removes all nominees from your profile.
            </Text>
          ) : null}
          <ErrorBox text={error} />
          <Button label="Continue" onPress={next} fullWidth size="lg" />
        </View>
      ) : (
        <OtpConfirm
          change={{ kind: 'nominees', nominees: toSave }}
          summary={
            toSave.length ? (
              <View>
                {toSave.map((n, i) => (
                  <SummaryLine key={i}>
                    <Text variant="small">{n.full_name}</Text> · {n.relationship} · {n.share_percent}%
                  </SummaryLine>
                ))}
              </View>
            ) : (
              <SummaryLine>Remove all nominees</SummaryLine>
            )
          }
          onBack={() => setStep('form')}
          onDone={() => router.back()}
        />
      )}
    </Screen>
  );
}
