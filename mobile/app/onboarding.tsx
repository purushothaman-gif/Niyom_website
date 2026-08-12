/**
 * Completing KYC.
 *
 * The checklist and every "is this step done" decision come from
 * `shared/portal/onboarding/onboardingSteps.ts`, derived entirely from fields on
 * the client record — clients cannot read `nw_documents`, so completion is not
 * something this screen can work out for itself.
 *
 * ## Why the order is fixed and the steps are not skippable
 *
 * PAN verification returns the name held against the PAN, and the bank and
 * demat proofs are checked against THAT name by a person. Letting someone
 * upload a bank proof before the PAN is verified produces a mismatch nobody can
 * resolve without starting again.
 *
 * ## Why the CML step appears and disappears
 *
 * A CML (demat holding statement) is only required for bonds and unlisted
 * shares. Choosing those products at the last step is what makes it required —
 * so the step is shown conditionally, and choosing them later triggers the same
 * requirement through Activate Products.
 */
import { useCallback, useMemo, useState } from 'react';
import { Alert, View } from 'react-native';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { File } from 'expo-file-system';
import * as Haptics from 'expo-haptics';
import {
  Building2,
  Camera,
  Check,
  CheckCircle2,
  ClipboardCheck,
  CreditCard,
  FileText,
  Landmark,
  ShieldCheck,
  Upload,
} from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import {
  buildChecklist,
  checklistProgress,
  cmlRequiredFor,
  kycUnderReview,
  PRODUCTS,
} from '@shared/portal/onboarding/onboardingSteps';
import { OnboardingService } from '@shared/portal/onboarding/onboardingService';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { ErrorState, SkeletonScreen, StatusPill } from '@/ui/kit';

type DocType = 'PAN' | 'BANK' | 'CML';

export default function Onboarding() {
  const clientId = useClientId();
  const p = usePalette();
  const { snapshot, loading, error, refreshedAt, refresh } = useClientSnapshot(clientId);
  const client = snapshot.client;

  const [pan, setPan] = useState('');
  const [prefs, setPrefs] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [panName, setPanName] = useState<string | null>(null);

  const steps = useMemo(() => buildChecklist(client), [client]);
  const progress = checklistProgress(steps);
  const underReview = kycUnderReview(client);
  const cmlNeeded = !!client?.cml_required || cmlRequiredFor(prefs);

  /* ------------------------------- actions -------------------------------- */

  const verifyPan = async () => {
    setMessage('');
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
      setMessage('Enter a valid PAN (e.g. ABCDE1234F).');
      return;
    }
    setBusy('pan');
    const result = await OnboardingService.verifyPan(clientId, pan);
    setBusy(null);
    if (!result.ok) {
      setMessage(result.error ?? 'PAN could not be verified.');
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setPanName(result.name ?? null);
    await refresh();
  };

  const pickAndUpload = useCallback(
    async (docType: DocType, source: 'camera' | 'library' | 'file') => {
      if (!client) return;
      setMessage('');

      let asset: { uri: string; name: string; size: number; mimeType: string } | null = null;

      if (source === 'file') {
        const result = await DocumentPicker.getDocumentAsync({
          type: ['application/pdf', 'image/*'],
          copyToCacheDirectory: true,
        });
        if (result.canceled || !result.assets?.[0]) return;
        const a = result.assets[0];
        asset = {
          uri: a.uri,
          name: a.name,
          size: a.size ?? 0,
          mimeType: a.mimeType ?? 'application/octet-stream',
        };
      } else {
        const permission =
          source === 'camera'
            ? await ImagePicker.requestCameraPermissionsAsync()
            : await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
          Alert.alert(
            source === 'camera' ? 'Camera access needed' : 'Photo access needed',
            'Niyom needs this to attach your KYC document. You can change it in Settings.',
          );
          return;
        }
        const result =
          source === 'camera'
            ? await ImagePicker.launchCameraAsync({ quality: 0.7 })
            : await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                quality: 0.7,
              });
        if (result.canceled || !result.assets?.[0]) return;
        const a = result.assets[0];
        asset = {
          uri: a.uri,
          name: a.fileName ?? `${docType}_${Date.now()}.jpg`,
          size: a.fileSize ?? 0,
          mimeType: a.mimeType ?? 'image/jpeg',
        };
      }

      setBusy(docType);
      try {
        /*
         * Supabase storage in React Native cannot take a `File` or a `Blob` —
         * it needs the raw bytes, which is what `.bytes()` returns.
         */
        const body = await new File(asset.uri).bytes();
        const result = await OnboardingService.uploadDocBytes(
          clientId,
          client.client_code,
          docType,
          {
            name: asset.name,
            size: asset.size,
            mimeType: asset.mimeType,
            body: body.buffer as ArrayBuffer,
          },
        );
        if (!result.ok) {
          setMessage(result.error ?? 'Could not upload that document.');
          return;
        }
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await refresh();
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Could not read that file.');
      } finally {
        setBusy(null);
      }
    },
    [client, clientId, refresh],
  );

  const chooseSource = (docType: DocType) => {
    Alert.alert('Add document', 'How would you like to attach it?', [
      { text: 'Take a photo', onPress: () => void pickAndUpload(docType, 'camera') },
      { text: 'Choose a photo', onPress: () => void pickAndUpload(docType, 'library') },
      { text: 'Choose a file', onPress: () => void pickAndUpload(docType, 'file') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const submit = async () => {
    setMessage('');
    if (prefs.length === 0) {
      setMessage('Choose at least one product you are interested in.');
      return;
    }
    setBusy('submit');
    const result = await OnboardingService.submit(clientId, prefs);
    setBusy(null);
    if (!result.ok) {
      setMessage(result.error ?? 'Could not submit your KYC.');
      return;
    }
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await refresh();
  };

  /* ------------------------------- rendering ------------------------------ */

  if (loading && !refreshedAt) {
    return (
      <Screen>
        <ScreenHeader title="Complete your KYC" showBack />
        <SkeletonScreen rows={4} />
      </Screen>
    );
  }

  if (error) {
    return (
      <Screen>
        <ScreenHeader title="Complete your KYC" showBack />
        <ErrorState message={error} onRetry={refresh} />
      </Screen>
    );
  }

  if (client?.onboarding_status === 'active') {
    return (
      <Screen>
        <ScreenHeader title="You’re all set" showBack />
        <Animated.View entering={FadeIn.duration(280)} style={{ gap: space[5] }}>
          <Card padding={5} style={{ alignItems: 'center', gap: space[3] }}>
            <CheckCircle2 size={44} color={p.state.successSoft} strokeWidth={1.7} />
            <Text variant="h3" center>
              Your account is active
            </Text>
            <Text variant="small" tone="muted" center>
              KYC is complete and verified. You can invest whenever you are ready.
            </Text>
          </Card>
          <Button
            label="Explore funds"
            onPress={() => router.replace('/(client)/invest')}
            fullWidth
            size="lg"
          />
        </Animated.View>
      </Screen>
    );
  }

  return (
    <Screen onRefresh={refresh} refreshing={loading}>
      <ScreenHeader
        title="Complete your KYC"
        subtitle="A few details and documents, and you can start investing."
        showBack
      />

      <View style={{ gap: space[5] }}>
        {message ? (
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
              {message}
            </Text>
          </View>
        ) : null}

        {/* ------------------------------ progress ----------------------- */}
        <Card padding={5}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space[3] }}>
            <Text variant="overline" tone="muted" caps style={{ flex: 1 }}>
              Progress
            </Text>
            <Text variant="moneySmall" tone="accent">
              {progress.percent}%
            </Text>
          </View>
          <View
            style={{
              height: 6,
              borderRadius: radius.full,
              backgroundColor: p.bg.raised,
              overflow: 'hidden',
              marginTop: space[3],
            }}
          >
            <View
              style={{
                width: `${Math.max(progress.percent, 2)}%`,
                height: '100%',
                borderRadius: radius.full,
                backgroundColor: p.accent.DEFAULT,
              }}
            />
          </View>

          <View style={{ marginTop: space[4], gap: space[3] }}>
            {steps
              .filter((s) => s.applicable)
              .map((s) => (
                <View key={s.key} style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
                  <View
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: radius.full,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: s.done ? p.state.successSoft : 'transparent',
                      borderWidth: s.done ? 0 : 1.5,
                      borderColor: p.border.strong,
                    }}
                  >
                    {s.done ? <Check size={11} color={p.bg.base} strokeWidth={3.5} /> : null}
                  </View>
                  <Text variant="small" tone={s.done ? 'secondary' : 'muted'} style={{ flex: 1 }}>
                    {s.label}
                  </Text>
                </View>
              ))}
          </View>
        </Card>

        {underReview ? (
          <Card padding={5} style={{ alignItems: 'center', gap: space[3] }}>
            <ClipboardCheck size={36} color={p.accent.DEFAULT} strokeWidth={1.7} />
            <Text variant="h3" center>
              With your relationship manager
            </Text>
            <Text variant="small" tone="muted" center>
              Everything is submitted. Your RM checks the documents against your PAN record and
              activates the account — usually within a working day.
            </Text>
          </Card>
        ) : (
          <>
            {/* ------------------------------ PAN --------------------------- */}
            <StepCard
              icon={CreditCard}
              title="Verify your PAN"
              body="We fetch the name registered against it, so your documents can be matched to it."
              done={!!client?.pan_verified}
            >
              {client?.pan_verified ? (
                <Text variant="small" tone="secondary">
                  Verified as {client.pan_name ?? client.full_name}.
                </Text>
              ) : (
                <View style={{ gap: space[3] }}>
                  {panName ? (
                    <Text variant="small" tone="success">
                      Registered as {panName}.
                    </Text>
                  ) : null}
                  <Input
                    format="pan"
                    icon={CreditCard}
                    placeholder="ABCDE1234F"
                    value={pan}
                    onChangeText={setPan}
                    maxLength={10}
                    editable={busy === null}
                  />
                  <Button
                    label="Verify PAN"
                    onPress={() => void verifyPan()}
                    loading={busy === 'pan'}
                    disabled={busy !== null}
                    fullWidth
                  />
                </View>
              )}
            </StepCard>

            {/* --------------------------- PAN copy ------------------------- */}
            <StepCard
              icon={FileText}
              title="Upload your PAN card"
              body="A photo or scan of the card itself."
              done={!!client?.pan_doc_uploaded}
            >
              <UploadButton
                done={!!client?.pan_doc_uploaded}
                loading={busy === 'PAN'}
                disabled={busy !== null || !client?.pan_verified}
                hint={!client?.pan_verified ? 'Verify your PAN first.' : undefined}
                onPress={() => chooseSource('PAN')}
              />
            </StepCard>

            {/* ------------------------------ bank -------------------------- */}
            <StepCard
              icon={Building2}
              title="Bank proof"
              body="A cancelled cheque or a bank statement showing your name, account number and IFSC."
              done={!!client?.bank_verified}
            >
              <UploadButton
                done={!!client?.bank_verified}
                loading={busy === 'BANK'}
                disabled={busy !== null || !client?.pan_verified}
                hint={!client?.pan_verified ? 'Verify your PAN first.' : undefined}
                onPress={() => chooseSource('BANK')}
              />
            </StepCard>

            {/* ------------------------------- CML -------------------------- */}
            {cmlNeeded ? (
              <StepCard
                icon={Landmark}
                title="Demat proof (CML)"
                body="Your Client Master List, from your depository. Needed only for bonds and unlisted shares."
                done={!!client?.cml_uploaded}
              >
                <UploadButton
                  done={!!client?.cml_uploaded}
                  loading={busy === 'CML'}
                  disabled={busy !== null}
                  onPress={() => chooseSource('CML')}
                />
              </StepCard>
            ) : null}

            {/* ---------------------------- products ------------------------ */}
            <StepCard
              icon={ShieldCheck}
              title="What would you like to invest in?"
              body="You can add more later — this only decides what we set up now."
              done={false}
            >
              <View style={{ gap: space[4] }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
                  {PRODUCTS.map((product) => {
                    const active = prefs.includes(product.value);
                    return (
                      <Text
                        key={product.value}
                        variant="smallMedium"
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        onPress={() =>
                          setPrefs((current) =>
                            active
                              ? current.filter((v) => v !== product.value)
                              : [...current, product.value],
                          )
                        }
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
                        {product.label}
                      </Text>
                    );
                  })}
                </View>

                {cmlRequiredFor(prefs) && !client?.cml_uploaded ? (
                  <Text variant="caption" tone="warning">
                    Bonds and unlisted shares need a demat proof — the CML step above.
                  </Text>
                ) : null}

                <Button
                  label="Submit for review"
                  icon={ClipboardCheck}
                  onPress={() => void submit()}
                  loading={busy === 'submit'}
                  disabled={busy !== null || prefs.length === 0}
                  fullWidth
                  size="lg"
                />
              </View>
            </StepCard>
          </>
        )}
      </View>
    </Screen>
  );
}

function StepCard({
  icon: Icon,
  title,
  body,
  done,
  children,
}: {
  icon: typeof CreditCard;
  title: string;
  body: string;
  done: boolean;
  children: React.ReactNode;
}) {
  const p = usePalette();
  return (
    <Animated.View entering={FadeInDown.duration(380)}>
      <Card padding={5}>
        <View style={{ flexDirection: 'row', gap: space[3] }}>
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: radius.md,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: done ? `${p.state.successSoft}1F` : p.accent.tint(0.14),
            }}
          >
            <Icon
              size={18}
              color={done ? p.state.successSoft : p.accent.DEFAULT}
              strokeWidth={2}
            />
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[2] }}>
              <Text variant="h3" style={{ flex: 1 }}>
                {title}
              </Text>
              {done ? <StatusPill tone="success" label="Done" /> : null}
            </View>
            <Text variant="small" tone="muted" style={{ marginTop: space[1] }}>
              {body}
            </Text>
          </View>
        </View>
        <View style={{ marginTop: space[4] }}>{children}</View>
      </Card>
    </Animated.View>
  );
}

function UploadButton({
  done,
  loading,
  disabled,
  hint,
  onPress,
}: {
  done: boolean;
  loading: boolean;
  disabled: boolean;
  hint?: string;
  onPress: () => void;
}) {
  return (
    <View style={{ gap: space[2] }}>
      <Button
        label={done ? 'Replace document' : 'Add document'}
        icon={done ? Upload : Camera}
        variant={done ? 'secondary' : 'primary'}
        onPress={onPress}
        loading={loading}
        disabled={disabled}
        fullWidth
      />
      {hint ? (
        <Text variant="caption" tone="faint">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}
