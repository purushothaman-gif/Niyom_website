/**
 * Importing an existing mutual fund portfolio from a CAS.
 *
 * ## Why this is two steps and not one
 *
 * The statement does not exist yet when a client decides they want this. It is
 * requested from CAMS, who email it to the investor roughly five minutes later.
 * A single upload screen would be a dead end for everyone who has not already
 * been through that — so the first step exists to get the REQUEST right, and the
 * client comes back to the second when the mail arrives.
 *
 * Four choices on the CAMS form decide whether the resulting file is any use,
 * and all four have a plausible-looking wrong answer. Those are spelled out
 * rather than summarised.
 *
 * ## The password is not the PAN
 *
 * It is the one the investor chose on the CAMS request form. Assuming it is the
 * PAN is the single most common reason an import fails, so the field says so.
 *
 * ## Where the file goes
 *
 * Straight to the `cas-import` edge function and nowhere else — not into the
 * app's storage, not into Supabase storage. It is parsed in memory, the
 * extracted rows are kept, and the file is discarded.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Linking, View } from 'react-native';
import { router } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  FileText,
  Lock,
  Upload,
} from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { fmt, fmtDate } from '@shared/crm/utils';
import {
  CasImportService,
  MAX_CAS_BYTES,
  type CasImportOutcome,
  type CasImportRecord,
} from '@shared/portal/services/CasImportService';
import {
  CasRequestService,
  isOpenRequest,
  type CasFormGuidance,
  type CasRequest,
} from '@shared/portal/services/CasRequestService';
import { requiredConsents } from '@shared/portal/types/consent';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientSnapshot } from '@shared/portal/hooks/useClientSnapshot';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { ListRow, SkeletonScreen, StatusPill } from '@/ui/kit';

type Step = 'request' | 'upload' | 'done';

export default function ImportPortfolio() {
  const clientId = useClientId();
  const p = usePalette();
  const { snapshot } = useClientSnapshot(clientId);

  const [request, setRequest] = useState<CasRequest | null>(null);
  const [imports, setImports] = useState<CasImportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<Step>('request');

  const [picked, setPicked] = useState<{ name: string; size: number; uri: string } | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<CasImportOutcome | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  /*
   * The CAMS field guidance comes back only when a request is CREATED — the
   * `latest()` poll does not carry it. So it is held here for the session, and
   * a client returning later simply uploads without the walkthrough.
   */
  const [guidance, setGuidance] = useState<CasFormGuidance | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [latest, list] = await Promise.all([
      CasRequestService.latest().catch(() => null),
      CasImportService.listImports().catch(() => []),
    ]);
    setRequest(latest);
    setImports(list);
    // Someone with a request already in flight came back for the upload.
    if (latest && isOpenRequest(latest.status)) setStep('upload');
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(t);
  }, [copied]);

  const copy = async (value: string, key: string) => {
    await Clipboard.setStringAsync(value);
    void Haptics.selectionAsync();
    setCopied(key);
  };

  const startRequest = async () => {
    setError('');
    const email = snapshot.client?.email;
    if (!email) {
      setError('We do not have an email on your account. Please contact your relationship manager.');
      return;
    }
    setBusy(true);
    /*
     * The consents are recorded server-side with the request. `requiredConsents`
     * is the same list the website submits — accepting them is what authorises
     * Niyom to read the statement CAMS sends.
     */
    const result = await CasRequestService.start({ email, consents: requiredConsents() });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setGuidance(result.request.form);
    await load();
    setStep('upload');
  };

  const pick = async () => {
    setError('');
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/pdf',
      copyToCacheDirectory: true,
      multiple: false,
    });
    if (result.canceled || !result.assets?.[0]) return;

    const asset = result.assets[0];
    const size = asset.size ?? 0;
    if (size > MAX_CAS_BYTES) {
      setError('That file is larger than 6 MB. Please upload the CAS as the registrar emailed it.');
      return;
    }
    setPicked({ name: asset.name, size, uri: asset.uri });
  };

  const upload = async () => {
    if (!picked) return;
    if (!password) {
      setError('Enter the password you chose on the CAMS form.');
      return;
    }
    setError('');
    setBusy(true);
    try {
      /*
       * Read as base64 rather than as bytes: the edge function takes base64, and
       * decoding here only to re-encode would double the memory for a file that
       * can be six megabytes.
       */
      const base64 = await new File(picked.uri).base64();
      const result = await CasImportService.importStatementBytes(
        { fileName: picked.name, fileSize: picked.size, base64 },
        password,
        request?.requestId ?? null,
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setOutcome(result.outcome);
      setPassword('');
      setPicked(null);
      setStep('done');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read that file. Please try again.');
    } finally {
      setBusy(false);
    }
  };



  /* --------------------------------- done --------------------------------- */

  if (step === 'done' && outcome) {
    const good = outcome.status === 'reconciled';
    return (
      <Screen>
        <ScreenHeader title={good ? 'Statement imported' : 'Imported with a mismatch'} />
        <Animated.View entering={FadeIn.duration(280)} style={{ gap: space[5] }}>
          <Card padding={5} style={{ alignItems: 'center', gap: space[3] }}>
            {good ? (
              <CheckCircle2 size={42} color={p.state.successSoft} strokeWidth={1.7} />
            ) : (
              <AlertTriangle size={42} color={p.state.warningSoft} strokeWidth={1.7} />
            )}
            <Text variant="h3" center>
              {good
                ? 'Checked against your statement’s own totals'
                : 'The totals did not quite agree'}
            </Text>
            {outcome.counts ? (
              <Text variant="small" tone="muted" center>
                {outcome.counts.schemes} scheme{outcome.counts.schemes === 1 ? '' : 's'} across{' '}
                {outcome.counts.folios} folio{outcome.counts.folios === 1 ? '' : 's'}
                {outcome.counts.transactions
                  ? `, ${outcome.counts.transactions} transactions`
                  : ''}
                .
              </Text>
            ) : null}
            {outcome.totals?.parsedMarketValue != null ? (
              <Text variant="money" tone="accent">
                {fmt(outcome.totals.parsedMarketValue)}
              </Text>
            ) : null}
          </Card>

          {!good ? (
            <Card padding={4} weight="surface">
              <Text variant="small" tone="secondary">
                Your portfolio has been updated, but the value we read does not match the total
                printed on the statement. Your relationship manager has been told and will check it.
              </Text>
            </Card>
          ) : null}

          {outcome.variant === 'summary' ? (
            <Card padding={4} weight="surface">
              <Text variant="smallMedium">This was a summary statement</Text>
              <Text variant="small" tone="secondary" style={{ marginTop: space[2] }}>
                It gives your holdings but not the transactions behind them, so capital gains
                cannot be worked out from it. Request a DETAILED statement for that.
              </Text>
            </Card>
          ) : null}

          <Button
            label="See my portfolio"
            onPress={() => router.replace('/(client)/portfolio')}
            fullWidth
            size="lg"
          />
        </Animated.View>
      </Screen>
    );
  }

  /* ------------------------------- the flow -------------------------------- */

  return (
    <Screen>
      <ScreenHeader
        title="Import your portfolio"
        subtitle="Bring in funds you hold elsewhere from your Consolidated Account Statement."
        showBack
      />

      {loading ? (
        <SkeletonScreen rows={3} />
      ) : (
        <View style={{ gap: space[5] }}>
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

          {step === 'request' ? (
            <Animated.View entering={FadeInDown.duration(400)} style={{ gap: space[4] }}>
              <Card padding={5}>
                <Text variant="h3">First, request your statement</Text>
                <Text variant="small" tone="muted" style={{ marginTop: space[2] }}>
                  CAMS emails it to you in about five minutes. We will show you exactly what to
                  choose on their form — four of the options matter and all four have a
                  plausible-looking wrong answer.
                </Text>
                <View style={{ marginTop: space[4] }}>
                  <Button
                    label="Show me what to fill in"
                    onPress={() => void startRequest()}
                    loading={busy}
                    fullWidth
                  />
                </View>
              </Card>

              <Card padding={4} weight="surface">
                <Text variant="smallMedium">Already have the PDF?</Text>
                <Text variant="small" tone="secondary" style={{ marginTop: space[2] }}>
                  If CAMS has already emailed you a statement, you can go straight to uploading it.
                </Text>
                <View style={{ marginTop: space[3], alignSelf: 'flex-start' }}>
                  <Button
                    label="I have it already"
                    variant="secondary"
                    size="sm"
                    onPress={() => setStep('upload')}
                  />
                </View>
              </Card>
            </Animated.View>
          ) : null}

          {step === 'upload' ? (
            <Animated.View entering={FadeInDown.duration(400)} style={{ gap: space[5] }}>
              {guidance ? (
                <Card padding={5}>
                  <Text variant="h3">On the CAMS form</Text>
                  <Text variant="small" tone="muted" style={{ marginTop: space[2] }}>
                    Copy each of these across exactly. Anything else produces a file we cannot use.
                  </Text>

                  <View style={{ marginTop: space[4] }}>
                    <Field
                      label="Statement type"
                      value={guidance.statementType}
                      onCopy={() => void copy(guidance.statementType, 'type')}
                      copied={copied === 'type'}
                    />
                    <Field label="Period" value={guidance.period} />
                    <Field label="From" value={guidance.fromDate} />
                    <Field label="To" value={guidance.toDate} />
                    <Field label="Folio listing" value={guidance.folioListing} />
                    <Field
                      label="Email"
                      value={guidance.email}
                      onCopy={() => void copy(guidance.email, 'email')}
                      copied={copied === 'email'}
                    />
                    {guidance.pan ? (
                      <Field
                        label="PAN (optional)"
                        value={guidance.pan}
                        onCopy={() => void copy(guidance.pan, 'pan')}
                        copied={copied === 'pan'}
                        last
                      />
                    ) : null}
                  </View>

                  <View style={{ marginTop: space[4] }}>
                    <Button
                      label="Open the CAMS form"
                      icon={ExternalLink}
                      variant="secondary"
                      onPress={() => void Linking.openURL(guidance.url)}
                      fullWidth
                    />
                  </View>
                </Card>
              ) : null}

              <Card padding={5}>
                <Text variant="h3">Then upload it here</Text>

                <View style={{ marginTop: space[4], gap: space[4] }}>
                  <Button
                    label={picked ? 'Choose a different file' : 'Choose the PDF'}
                    icon={FileText}
                    variant={picked ? 'secondary' : 'primary'}
                    onPress={() => void pick()}
                    disabled={busy}
                    fullWidth
                  />

                  {picked ? (
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: space[3],
                        padding: space[3],
                        borderRadius: radius.md,
                        backgroundColor: p.bg.surface,
                      }}
                    >
                      <FileText size={17} color={p.accent.DEFAULT} />
                      <View style={{ flex: 1 }}>
                        <Text variant="smallMedium" numberOfLines={1}>
                          {picked.name}
                        </Text>
                        <Text variant="caption" tone="faint">
                          {(picked.size / 1024 / 1024).toFixed(2)} MB
                        </Text>
                      </View>
                    </View>
                  ) : null}

                  <Input
                    label="Statement password"
                    icon={Lock}
                    secure
                    placeholder="The password you chose on the form"
                    value={password}
                    onChangeText={setPassword}
                    editable={!busy}
                    hint="Not your PAN — the password you set on the CAMS request form."
                  />

                  <Button
                    label="Import statement"
                    icon={Upload}
                    onPress={() => void upload()}
                    loading={busy}
                    disabled={!picked || !password}
                    fullWidth
                    size="lg"
                  />
                </View>

                <Text variant="caption" tone="faint" style={{ marginTop: space[4] }}>
                  The file is read once and discarded — it is never stored on this phone or in our
                  systems.
                </Text>
              </Card>
            </Animated.View>
          ) : null}

          {/* ------------------------ previous imports --------------------- */}
          {imports.length > 0 ? (
            <View>
              <Text variant="overline" tone="muted" caps style={{ marginBottom: space[3] }}>
                Statements you have imported
              </Text>
              <Card padding={4}>
                {imports.map((record, i) => (
                  <View key={record.id}>
                    <ListRow
                      title={
                        record.statement_from && record.statement_to
                          ? `${fmtDate(record.statement_from)} – ${fmtDate(record.statement_to)}`
                          : fmtDate(record.created_at)
                      }
                      subtitle={[
                        record.scheme_count ? `${record.scheme_count} schemes` : null,
                        record.transaction_count ? `${record.transaction_count} transactions` : null,
                        record.parsed_total ? fmt(record.parsed_total) : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                      last={i === imports.length - 1}
                    />
                    <View style={{ marginTop: -space[2], marginBottom: space[3] }}>
                      <StatusPill
                        dot
                        tone={record.status === 'reconciled' ? 'success' : 'warning'}
                        label={record.status === 'reconciled' ? 'Reconciled' : record.status}
                      />
                    </View>
                  </View>
                ))}
              </Card>
            </View>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

function Field({
  label,
  value,
  onCopy,
  copied,
  last,
}: {
  label: string;
  value: string;
  onCopy?: () => void;
  copied?: boolean;
  last?: boolean;
}) {
  const p = usePalette();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space[3],
        paddingVertical: space[3],
        borderBottomWidth: last ? 0 : 1,
        borderBottomColor: p.border.subtle,
      }}
    >
      <Text variant="caption" tone="muted" caps style={{ width: 110 }}>
        {label}
      </Text>
      <Text variant="smallMedium" style={{ flex: 1 }} selectable>
        {value}
      </Text>
      {onCopy ? (
        copied ? (
          <Check size={16} color={p.state.successSoft} />
        ) : (
          <Copy size={16} color={p.text.muted} onPress={onCopy} />
        )
      ) : null}
    </View>
  );
}
