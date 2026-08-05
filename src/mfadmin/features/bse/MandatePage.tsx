/**
 * Mandates — the standing debit authority behind every recurring SIP.
 *
 * This was the largest hole in the console: the proxy has had /mandate and
 * /mandates since the mandate path went live, but nothing called them. Without
 * a mandate there is no auto-debit, and BSE requires `exch_mandate_id` on an
 * XSIP registration — so recurring SIPs could not be set up by anyone.
 *
 * Two BSE rules are enforced here rather than discovered as a rejection:
 *
 *  - type and mode are STRICTLY PAIRED. E-NACH is type N / mode ACH, UPI is
 *    type U / mode DD. Mismatching them returns `not_allowed`.
 *  - `vpa` is UPI-only. Sending it on an E-NACH mandate is rejected outright,
 *    so the field only exists when UPI is selected.
 *
 * A registered mandate is not a usable one. It stays is_verified false and
 * is_active false until the investor authorises it — E-NACH returns a
 * BSE-hosted link, UPI sends a collect request to their UPI app and returns no
 * link at all. The screen says which, because "registered" looks like "done".
 */
import { useMemo, useState } from 'react';
import { ExternalLink, Landmark } from 'lucide-react';
import {
  BseOpsService,
  isBseConfigured,
  type BseMandateRow,
  type BseUccRow,
  type MandateType,
} from '../../services/BseOpsService';
import { useBseData } from '../../hooks/useBseData';
import { Chip, PageHead, Panel, PanelHead, StatTile } from '../../ui/Surface';
import { DataTable, type Column } from '../../ui/DataTable';
import { ErrorBlock, Loading, fieldCls } from '../../ui/controls';
import { ConfirmBox, ErrorNote, Field, NotConfigured, SuccessCard, WarnNote } from './formBits';
import { EnvBadge, envNote, useBseEnv } from './EnvBadge';
import { inr, inrCompact, num, shortDate } from '../../../lib/money';

interface Registered {
  mandateId: string;
  clientCode: string;
  amount: number;
  type: MandateType;
  authUrl?: string;
}

export function MandatePage() {
  const env = useBseEnv();
  const uccs = useBseData<BseUccRow[]>(() => BseOpsService.uccs());
  const mandates = useBseData<BseMandateRow[]>(() => BseOpsService.mandates());

  const [clientCode, setClientCode] = useState('');
  const [type, setType] = useState<MandateType>('ENACH');
  const [amount, setAmount] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifsc, setIfsc] = useState('');
  const [vpa, setVpa] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Registered | null>(null);

  const activeUccs = useMemo(
    () => (uccs.data ?? []).filter((u) => u.status.toUpperCase() === 'ACTIVE'),
    [uccs.data],
  );

  const amt = Number(amount);
  const amountError = (() => {
    if (!amount.trim()) return null;
    if (!Number.isFinite(amt) || amt <= 0) return 'Enter a valid amount.';
    return null;
  })();
  const ifscError =
    ifsc.trim() && !/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(ifsc.trim())
      ? 'IFSC format, e.g. HDFC0000123.'
      : null;
  const vpaError =
    type === 'UPI' && vpa.trim() && !/^[\w.-]+@[\w.-]+$/.test(vpa.trim())
      ? 'VPA format, e.g. name@okicici.'
      : null;

  const ready = Boolean(
    clientCode &&
      amount.trim() &&
      !amountError &&
      /^\d{9,20}$/.test(accountNumber.trim()) &&
      ifsc.trim() &&
      !ifscError &&
      (type !== 'UPI' || (vpa.trim() && !vpaError)),
  );

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await BseOpsService.registerMandate({
        clientCode,
        amount: amt,
        type,
        bank: { accountNumber: accountNumber.trim(), ifsc: ifsc.trim().toUpperCase() },
        // Only ever sent for UPI — BSE rejects a VPA on an E-NACH mandate.
        ...(type === 'UPI' ? { vpa: vpa.trim() } : {}),
      });
      setDone({ mandateId: res.mandateId, clientCode, amount: amt, type, authUrl: res.authUrl });
      setConfirming(false);
      setAmount('');
      setAccountNumber('');
      setIfsc('');
      setVpa('');
      mandates.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The mandate could not be registered.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  const rows = mandates.data ?? [];
  const stats = useMemo(
    () => ({
      total: rows.length,
      active: rows.filter((m) => m.isActive && m.isVerified).length,
      awaiting: rows.filter((m) => !m.isVerified).length,
      limit: rows.filter((m) => m.isActive && m.isVerified).reduce((s, m) => s + (m.amount || 0), 0),
    }),
    [rows],
  );

  const cols: Column<BseMandateRow>[] = [
    {
      key: 'mandateId',
      header: 'Mandate',
      value: (r) => r.mandateId,
      render: (r) => (
        <div className="min-w-0">
          <p className="font-mono text-text-primary">{r.mandateId}</p>
          {r.umrn && <p className="font-mono text-[10px] text-text-faint">UMRN {r.umrn}</p>}
        </div>
      ),
    },
    {
      key: 'client',
      header: 'Client',
      value: (r) => r.clientCode,
      render: (r) => <span className="font-mono">{r.clientCode || '—'}</span>,
    },
    {
      key: 'bank',
      header: 'Bank',
      value: (r) => `${r.bank.name} ${r.bank.ifsc}`,
      render: (r) => (
        <div className="min-w-0">
          <p className="truncate text-text-secondary">{r.bank.name || '—'}</p>
          <p className="truncate font-mono text-[10px] text-text-faint">
            {r.bank.ifsc} · {r.bank.accountNumber}
          </p>
        </div>
      ),
    },
    {
      key: 'mode',
      header: 'Mode',
      value: (r) => r.mode,
      render: (r) => <Chip>{r.mode || '—'}</Chip>,
    },
    {
      key: 'amount',
      header: 'Limit',
      numeric: true,
      value: (r) => r.amount,
      render: (r) => <span className="font-semibold text-text-primary">{inr(r.amount)}</span>,
    },
    {
      key: 'validTill',
      header: 'Valid till',
      value: (r) => r.validTill,
      render: (r) => <span className="whitespace-nowrap">{shortDate(r.validTill)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      align: 'right',
      value: (r) => (r.isActive && r.isVerified ? 'active' : r.isVerified ? 'verified' : 'awaiting'),
      render: (r) =>
        r.isActive && r.isVerified ? (
          <Chip tone="success">Active</Chip>
        ) : (
          <Chip tone="warning">Awaiting investor</Chip>
        ),
    },
  ];

  if (!isBseConfigured()) return <NotConfigured title="Mandates" />;

  return (
    <>
      <PageHead
        title="Mandates"
        subtitle="Standing debit authority. A recurring SIP cannot be registered at BSE without one."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Mandates" value={num(stats.total)} icon={Landmark} />
        <StatTile
          label="Active"
          value={num(stats.active)}
          tone={stats.active > 0 ? 'positive' : 'default'}
        />
        <StatTile
          label="Awaiting investor"
          value={num(stats.awaiting)}
          tone={stats.awaiting > 0 ? 'warning' : 'default'}
          sub={stats.awaiting > 0 ? 'Not usable until authorised' : undefined}
        />
        <StatTile label="Authorised limit" value={inrCompact(stats.limit)} sub="active mandates" />
      </div>

      {done && (
        <div className="mb-5">
          <SuccessCard title="Mandate registered at BSE">
            <p className="mt-1 text-sm text-text-secondary">
              {inr(done.amount)} limit for {done.clientCode} — mandate{' '}
              <span className="font-mono font-semibold">{done.mandateId}</span>.
            </p>
            {/* Registered is not authorised. Say what still has to happen. */}
            {done.type === 'UPI' ? (
              <p className="mt-2 text-xs text-warning">
                The client will receive a collect request in their UPI app. The mandate stays
                inactive until they approve it there — BSE issues no link for UPI.
              </p>
            ) : done.authUrl ? (
              <p className="mt-2 text-xs text-text-secondary">
                Send the client this authorisation link — the mandate is not usable until they
                complete it:{' '}
                <a
                  href={done.authUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"
                >
                  Open authorisation <ExternalLink className="h-3 w-3" />
                </a>
              </p>
            ) : (
              <p className="mt-2 text-xs text-warning">
                BSE returned no authorisation link. Check the mandate in the list below before
                relying on it.
              </p>
            )}
          </SuccessCard>
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        <Panel>
          <PanelHead title="Register a mandate" icon={Landmark} />

          {uccs.loading && <Loading />}
          {!uccs.loading && uccs.error && <ErrorNote title="Couldn’t load clients." message={uccs.error} />}

          {!uccs.loading && !uccs.error && (
            <div className="space-y-4">
              {activeUccs.length === 0 && (
                <WarnNote>
                  No transaction-ready clients. A UCC must be <strong>ACTIVE</strong> at BSE before a
                  mandate can be registered against it.
                </WarnNote>
              )}

              <Field label="Client (UCC)">
                <select
                  value={clientCode}
                  onChange={(e) => setClientCode(e.target.value)}
                  disabled={activeUccs.length === 0}
                  className={fieldCls}
                >
                  <option value="">Select a client…</option>
                  {activeUccs.map((u) => (
                    <option key={u.clientCode} value={u.clientCode}>
                      {u.name?.trim() || u.clientCode} — {u.clientCode}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Mandate type">
                <select
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value as MandateType);
                    setVpa('');
                  }}
                  className={fieldCls}
                >
                  <option value="ENACH">E-NACH — investor authorises on a bank page</option>
                  <option value="UPI">UPI Autopay — collect request to their UPI app</option>
                  <option value="NACH">NACH — physical form</option>
                </select>
              </Field>

              <Field label="Maximum debit per instalment (₹)">
                <input
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  inputMode="decimal"
                  placeholder="25000"
                  className={fieldCls}
                />
                {amountError && <p className="mt-1 text-[11px] text-danger">{amountError}</p>}
                <p className="mt-1 text-[11px] text-text-faint">
                  A ceiling, not a debit. Set it above the SIP amount so instalments never fail.
                </p>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Bank account">
                  <input
                    value={accountNumber}
                    onChange={(e) => setAccountNumber(e.target.value)}
                    className={fieldCls}
                  />
                </Field>
                <Field label="IFSC">
                  <input
                    value={ifsc}
                    onChange={(e) => setIfsc(e.target.value.toUpperCase())}
                    placeholder="HDFC0000123"
                    className={`${fieldCls} font-mono`}
                  />
                  {ifscError && <p className="mt-1 text-[11px] text-danger">{ifscError}</p>}
                </Field>
              </div>

              {/* UPI only — BSE rejects a VPA sent on an E-NACH mandate. */}
              {type === 'UPI' && (
                <Field label="UPI ID (VPA)">
                  <input
                    value={vpa}
                    onChange={(e) => setVpa(e.target.value)}
                    placeholder="name@okicici"
                    className={fieldCls}
                  />
                  {vpaError && <p className="mt-1 text-[11px] text-danger">{vpaError}</p>}
                </Field>
              )}

              {error && <ErrorNote title="The mandate was not registered." message={error} />}

              {!confirming ? (
                <button
                  type="button"
                  disabled={!ready}
                  onClick={() => {
                    setError(null);
                    setDone(null);
                    setConfirming(true);
                  }}
                  className="w-full rounded-token-md bg-accent py-2.5 text-sm font-bold text-on-accent transition-colors hover:bg-accent-strong disabled:opacity-50"
                >
                  Review Mandate
                </button>
              ) : (
                <ConfirmBox
                  rows={[
                    { label: 'Client', value: clientCode },
                    { label: 'Type', value: type },
                    { label: 'Limit', value: inr(amt) },
                    { label: 'Bank', value: `${ifsc.toUpperCase()} · ${accountNumber}` },
                    ...(type === 'UPI' ? [{ label: 'UPI ID', value: vpa }] : []),
                  ]}
                  note="Registers a real mandate with BSE StAR MF. It authorises nothing until the investor approves it, and no money moves at registration."
                  busy={busy}
                  submitLabel="Register Mandate"
                  onBack={() => setConfirming(false)}
                  onConfirm={submit}
                />
              )}

              <p className="text-center text-[11px] text-text-faint">
                <EnvBadge env={env} /> {envNote(env)}
              </p>
            </div>
          )}
        </Panel>

        <div className="min-w-0">
          <h2 className="mb-3 font-display text-sm font-bold text-text-primary">
            Registered mandates
          </h2>
          {mandates.loading && <Loading label="Loading mandates from BSE…" />}
          {!mandates.loading && mandates.error && (
            <ErrorBlock message={mandates.error} onRetry={mandates.refresh} />
          )}
          {!mandates.loading && !mandates.error && (
            <DataTable
              rows={rows}
              columns={cols}
              rowKey={(r) => r.mandateId}
              searchPlaceholder="Search by mandate, client, bank or UMRN…"
              empty={{
                title: 'No mandates registered yet',
                hint: 'Register one on the left. Until a client has an authorised mandate they can only invest as lumpsum — a recurring SIP needs one.',
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}
