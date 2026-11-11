/**
 * The import hub's other routes — what the website's "Import my portfolio"
 * offers beyond a mutual fund CAS:
 *
 *   - Stocks & demat by CDSL OTP (shares, bonds, G-secs, ETFs, NPS)
 *   - Forward a statement to a private address
 *
 * Both talk to the same droplet endpoints as the website, through
 * `DematImportService` and `InboundEmailService` in `shared/`. Each card asks
 * the server whether its route is switched on and renders NOTHING when it is
 * not, so the screen never offers a door that does not open.
 *
 * Not here, deliberately: "connect my inbox". Its OAuth consent returns to a
 * niyomwealth.com page, not to the app, so it stays on the website.
 */
import { useEffect, useState } from 'react';
import { View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Check, CheckCircle2, Copy, Forward, Landmark } from 'lucide-react-native';
import { fmtFull } from '@shared/crm/utils';
import { DematImportService, type DematImportSummary } from '@shared/portal/services/DematImportService';
import { InboundEmailService, type InboundCheck } from '@shared/portal/services/InboundEmailService';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';

function IconTile({ icon: Icon }: { icon: typeof Landmark }) {
  const p = usePalette();
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: radius.md,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: `${p.accent.DEFAULT}24`,
      }}
    >
      <Icon size={19} color={p.accent.DEFAULT} />
    </View>
  );
}

function Problem({ message }: { message: string }) {
  return message ? (
    <Text variant="small" tone="danger" style={{ marginTop: space[3] }}>
      {message}
    </Text>
  ) : null;
}

/* -------------------------------------------------------------------------- */
/*  Demat by CDSL OTP                                                         */
/* -------------------------------------------------------------------------- */

type DematStep = 'intro' | 'otp' | 'needsEmail' | 'done';

/**
 * Everything the depository needs (PAN, demat account, date of birth) is
 * already on the client's record and is read server-side, so there is nothing
 * to type but the OTP. The statement is fetched, read and stored on our own
 * servers; the app only carries an opaque session id between the two steps.
 */
export function DematFetchCard({ onImported }: { onImported: () => void }) {
  const p = usePalette();
  const [ready, setReady] = useState(false);
  const [step, setStep] = useState<DematStep>('intro');
  const [sessionId, setSessionId] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<DematImportSummary | null>(null);

  useEffect(() => {
    let alive = true;
    void DematImportService.enabled().then((on) => {
      if (alive) setReady(on);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!ready) return null;

  const sendOtp = async () => {
    setError('');
    setBusy(true);
    const r = await DematImportService.start();
    setBusy(false);
    if (!r.ok) {
      // NSDL-first client: no OTP rail exists — point them at the email route.
      if (r.needsEmail) return setStep('needsEmail');
      return setError(r.error);
    }
    setSessionId(r.sessionId);
    setStep('otp');
  };

  const verify = async () => {
    if (otp.trim().length < 4) return setError('Enter the OTP from your phone.');
    setError('');
    setBusy(true);
    const r = await DematImportService.verify(sessionId, otp.trim());
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setSummary(r.summary);
    setStep('done');
    onImported();
  };

  return (
    <Card padding={5}>
      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <IconTile icon={Landmark} />
        <View style={{ flex: 1 }}>
          <Text variant="h3">Stocks & demat</Text>
          <Text variant="small" tone="muted" style={{ marginTop: 2 }}>
            Shares, bonds, G-Secs, ETFs and NPS from your depository.
          </Text>
        </View>
      </View>

      {step === 'intro' ? (
        <View style={{ marginTop: space[4], gap: space[3] }}>
          <Text variant="small" tone="secondary">
            CDSL will text a one-time password to the mobile registered with your demat account. That is all you
            enter — your PAN and account details are already on file. The statement is read on our own servers and
            the file itself is never stored.
          </Text>
          <Button label="Send me the OTP" onPress={() => void sendOtp()} loading={busy} fullWidth />
        </View>
      ) : null}

      {step === 'otp' ? (
        <View style={{ marginTop: space[4], gap: space[3] }}>
          <Input
            label="OTP from CDSL"
            hint="Sent to your demat-registered mobile. Valid for a few minutes."
            format="digits"
            keyboardType="number-pad"
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            maxLength={8}
            value={otp}
            onChangeText={(v) => setOtp(v.replace(/\D/g, '').slice(0, 8))}
          />
          <Button
            label={busy ? 'Reading your statement…' : 'Import holdings'}
            onPress={() => void verify()}
            loading={busy}
            disabled={otp.trim().length < 4}
            fullWidth
          />
          <Button
            label="Resend OTP"
            variant="ghost"
            size="sm"
            onPress={() => {
              setOtp('');
              setError('');
              setStep('intro');
            }}
          />
        </View>
      ) : null}

      {step === 'needsEmail' ? (
        <Text variant="small" tone="secondary" style={{ marginTop: space[4] }}>
          Your demat account is with NSDL, which has no instant fetch. Forward your NSDL statement to your private
          import address below and we will bring it in the same way.
        </Text>
      ) : null}

      {step === 'done' && summary ? (
        <View style={{ marginTop: space[4], flexDirection: 'row', gap: space[3] }}>
          <CheckCircle2 size={20} color={p.state.successSoft} />
          <View style={{ flex: 1 }}>
            <Text variant="smallMedium">
              {summary.duplicate ? 'Already up to date' : 'Demat holdings imported'}
            </Text>
            <Text variant="small" tone="muted" style={{ marginTop: 2 }}>
              {summary.holdings} holding{summary.holdings === 1 ? '' : 's'} across {summary.accounts} account
              {summary.accounts === 1 ? '' : 's'}
              {summary.totalValue != null ? ` · ${fmtFull(summary.totalValue)}` : ''}
              {summary.statementDate ? ` · as of ${summary.statementDate}` : ''}
            </Text>
          </View>
        </View>
      ) : null}

      <Problem message={error} />
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/*  Forward to a private address                                              */
/* -------------------------------------------------------------------------- */

export function ForwardCasCard({ onImported }: { onImported: () => void }) {
  const p = usePalette();
  const [ready, setReady] = useState(false);
  const [address, setAddress] = useState<string | null>(null);
  const [lastReceivedAt, setLastReceivedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState<'create' | 'check' | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<InboundCheck | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const on = await InboundEmailService.enabled();
      if (!alive || !on) return;
      const s = await InboundEmailService.status();
      if (!alive) return;
      setAddress(s.address);
      setLastReceivedAt(s.lastReceivedAt ?? null);
      setReady(true);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  if (!ready) return null;

  const create = async () => {
    setError('');
    setBusy('create');
    const r = await InboundEmailService.ensure();
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setAddress(r.address);
  };

  const check = async () => {
    setError('');
    setResult(null);
    setBusy('check');
    const r = await InboundEmailService.check();
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setResult(r.result);
    if (r.result.imported + r.result.mfImported > 0) {
      setLastReceivedAt(new Date().toISOString());
      onImported();
    }
  };

  const total = result ? result.imported + result.mfImported : 0;

  return (
    <Card padding={5}>
      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <IconTile icon={Forward} />
        <View style={{ flex: 1 }}>
          <Text variant="h3">Forward a statement</Text>
          <Text variant="small" tone="muted" style={{ marginTop: 2 }}>
            {address
              ? 'Forward any CAS email here and we import it — no sign-in needed.'
              : 'Get a private address to forward your CAS statements to.'}
          </Text>
        </View>
      </View>

      {address ? (
        <View style={{ marginTop: space[4], gap: space[3] }}>
          <View
            style={{
              padding: space[3],
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: p.border.DEFAULT,
              backgroundColor: p.bg.surface,
            }}
          >
            <Text variant="smallMedium" selectable>
              {address}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: space[3] }}>
            <Button
              label={copied ? 'Copied' : 'Copy address'}
              icon={copied ? Check : Copy}
              variant="secondary"
              size="sm"
              onPress={() => {
                void Clipboard.setStringAsync(address).then(() => setCopied(true));
              }}
              style={{ flex: 1 }}
            />
            <Button
              label={busy === 'check' ? 'Checking…' : 'Check now'}
              size="sm"
              loading={busy === 'check'}
              onPress={() => void check()}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      ) : (
        <View style={{ marginTop: space[4] }}>
          <Button label="Get my address" loading={busy === 'create'} onPress={() => void create()} fullWidth />
        </View>
      )}

      <Problem message={error} />

      {result && !error ? (
        <Text variant="small" tone="secondary" style={{ marginTop: space[3] }}>
          {total > 0
            ? `Imported ${total} statement${total === 1 ? '' : 's'}.`
            : 'Nothing new yet — forward a statement and check again in a moment.'}
          {result.mfManual > 0
            ? ` ${result.mfManual} statement${result.mfManual === 1 ? '' : 's'} could not be opened automatically — upload those above with their password.`
            : ''}
        </Text>
      ) : null}

      {address && lastReceivedAt && !result ? (
        <Text variant="caption" tone="faint" style={{ marginTop: space[3] }}>
          Last statement received {new Date(lastReceivedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
        </Text>
      ) : null}
    </Card>
  );
}
