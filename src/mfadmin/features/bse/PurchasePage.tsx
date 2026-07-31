/**
 * Purchase — place a real lumpsum order at BSE from the console.
 *
 * This is the console's first money-moving surface, so it is deliberately
 * defensive:
 *  - only ACTIVE (transaction-ready) UCCs can be selected; BSE silently accepts
 *    and then does nothing for a UCC that is not ready.
 *  - only schemes that are OPEN, allow PHYSICAL mode and permit Purchase are
 *    offered — a physical UCC on a demat-only scheme is rejected by BSE.
 *  - the scheme's own min/max are enforced before we submit.
 *  - the order is confirmed in a second step, showing exactly what will be sent.
 */
import { useMemo, useState } from 'react';
import { Clock, ShoppingCart } from 'lucide-react';
import { fmt } from '../../../crm/utils';
import {
  BseOpsService,
  isBseConfigured,
  type BseSchemeRow,
  type BseUccRow,
} from '../../services/BseOpsService';
import { useBseData } from '../../hooks/useBseData';
import { EnvBadge, envNote, useBseEnv } from './EnvBadge';
import {
  ConfirmBox,
  ErrorNote,
  Field,
  NotConfigured,
  SuccessCard,
  WarnNote,
  inputCls,
  selectCls,
} from './formBits';
import { PageHead, Panel, PanelHead } from '../../ui/Surface';
import { Loading } from '../../ui/controls';
import { useCallerEuin } from '../../hooks/useCallerEuin';
import { ClientLinks } from './CopyLink';

interface Placed {
  orderId: string;
  amount: number;
  schemeName: string;
  clientCode: string;
  /** BSE approval page — the order does not move until the investor completes it. */
  twoFaUrl?: string | null;
}

export function PurchasePage() {
  // Display only — the proxy resolves the real EUIN from the session.
  const euin = useCallerEuin();
  const env = useBseEnv();
  const uccs = useBseData<BseUccRow[]>(() => BseOpsService.uccs());
  const schemes = useBseData<BseSchemeRow[]>(() => BseOpsService.schemes());

  const [clientCode, setClientCode] = useState('');
  const [schemeCode, setSchemeCode] = useState('');
  const [amount, setAmount] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placed, setPlaced] = useState<Placed | null>(null);

  // Only UCCs BSE will actually transact on.
  const activeUccs = useMemo(
    () => (uccs.data ?? []).filter((u) => u.status.toUpperCase() === 'ACTIVE'),
    [uccs.data],
  );

  // Physical UCCs need physical-capable, open schemes that allow Purchase.
  const buyableSchemes = useMemo(
    () =>
      (schemes.data ?? [])
        .filter((s) => s.allowsPhysical && s.isOpen && s.purchase && s.schemeCode)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [schemes.data],
  );

  const scheme = buyableSchemes.find((s) => s.schemeCode === schemeCode) ?? null;
  const client = activeUccs.find((u) => u.clientCode === clientCode) ?? null;
  const amt = Number(amount);

  const amountError = (() => {
    if (!amount.trim()) return null;
    if (!Number.isFinite(amt) || amt <= 0) return 'Enter a valid amount.';
    const rule = scheme?.purchase;
    if (!rule) return null;
    if (amt < rule.min) return `Minimum for this scheme is ${fmt(rule.min)}.`;
    if (rule.max > 0 && amt > rule.max) return `Maximum for this scheme is ${fmt(rule.max)}.`;
    // BSE also requires the amount to be a MULTIPLE of the scheme's step
    // (errcode amt_not_multiple_of_min_amt) — e.g. a Rs 500 scheme rejects 800.
    const step = rule.minAdditional > 0 ? rule.minAdditional : rule.min;
    if (step > 0 && amt % step !== 0)
      return `Must be a multiple of ${fmt(step)} — try ${fmt(Math.round(amt / step) * step || step)}.`;
    return null;
  })();

  const ready = Boolean(client && scheme && amount.trim() && !amountError);

  const submit = async () => {
    if (!ready || !scheme || !client) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await BseOpsService.placeOrder({
        clientCode: client.clientCode,
        schemeCode: scheme.schemeCode,
        schemeName: scheme.name,
        amount: amt,
      });
      setPlaced({
        orderId: result.orderId,
        amount: amt,
        schemeName: scheme.name,
        clientCode: client.clientCode,
        twoFaUrl: result.twoFaUrl,
      });
      setConfirming(false);
      setAmount('');
      setSchemeCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The order could not be placed.');
      setConfirming(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (!isBseConfigured()) return <NotConfigured title="Purchase" />;

  const loading = uccs.loading || schemes.loading;
  const loadError = uccs.error ?? schemes.error;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHead title="Lumpsum Purchase" subtitle="Place a real lumpsum order at BSE. Gated on ACTIVE clients and schemes open for physical purchase." />
      <div className="space-y-5">
      {placed && (
        <SuccessCard title="Order placed at BSE">
          <p className="mt-1 text-sm text-text-secondary">
            {fmt(placed.amount)} into {placed.schemeName} for {placed.clientCode}.
          </p>
          <p className="mt-2 text-xs text-text-secondary">
            Order ID <span className="font-mono font-semibold">{placed.orderId}</span> — track it in
            the Order Book.
          </p>
          {/* Placing the order is only the first of three steps. Staff need both
              links to send the client, or the order sits unfunded forever. */}
          <ClientLinks placed={placed} />
        </SuccessCard>
      )}

      <Panel>
        <PanelHead title="New Purchase" icon={ShoppingCart} />

        {loading && <Loading />}

        {!loading && loadError && (
          <ErrorNote title="Couldn’t load from BSE." message={loadError} />
        )}

        {!loading && !loadError && (
          <div className="space-y-4">
            {activeUccs.length === 0 && (
              <WarnNote>
                No transaction-ready clients. A UCC must reach <strong>ACTIVE</strong> at BSE (KYC,
                PAN and investor 2FA complete) before it can transact.
              </WarnNote>
            )}

            <Field label="Client (UCC)">
              <select
                value={clientCode}
                onChange={(e) => setClientCode(e.target.value)}
                disabled={activeUccs.length === 0}
                className={selectCls}
              >
                <option value="">Select a client…</option>
                {activeUccs.map((u) => (
                  <option key={u.clientCode} value={u.clientCode}>
                    {u.name?.trim() || u.clientCode} — {u.clientCode}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-text-faint">
                {activeUccs.length} of {uccs.data?.length ?? 0} UCCs are able to transact.
              </p>
            </Field>

            <Field label="Scheme">
              <select
                value={schemeCode}
                onChange={(e) => setSchemeCode(e.target.value)}
                className={selectCls}
              >
                <option value="">Select a scheme…</option>
                {buyableSchemes.map((s) => (
                  <option key={s.schemeCode} value={s.schemeCode}>
                    {s.name} ({s.schemeCode})
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-text-faint">
                {buyableSchemes.length} schemes open for physical purchase.
              </p>
            </Field>

            {scheme?.purchase && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-token-md bg-bg-base px-3 py-2 text-[11px] text-text-secondary">
                <span>
                  Min <strong className="text-text-primary">{fmt(scheme.purchase.min)}</strong>
                </span>
                {scheme.purchase.cutoffTime && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Cut-off {scheme.purchase.cutoffTime}
                  </span>
                )}
                <span>{scheme.amc}</span>
              </div>
            )}

            <Field label="Amount (₹)">
              <input
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={scheme?.purchase ? String(scheme.purchase.min) : '5000'}
                className={inputCls}
              />
              {amountError && <p className="mt-1 text-[11px] text-danger">{amountError}</p>}
            </Field>

            {error && <ErrorNote title="The order was not placed." message={error} />}

            {!confirming ? (
              <button
                type="button"
                disabled={!ready}
                onClick={() => {
                  setError(null);
                  setPlaced(null);
                  setConfirming(true);
                }}
                className="w-full rounded-token-md bg-accent py-2.5 text-sm font-bold text-on-accent transition-colors hover:bg-accent-strong disabled:opacity-50"
              >
                Review Order
              </button>
            ) : (
              <ConfirmBox
                rows={[
                  { label: 'Client', value: `${client?.name?.trim() || ''} (${clientCode})` },
                  { label: 'Scheme', value: scheme?.name ?? '' },
                  { label: 'Amount', value: fmt(amt) },
                  { label: 'Type', value: 'Lumpsum purchase · Physical' },
                  { label: 'EUIN', value: euin },
                ]}
                note="This places a real order with BSE StAR MF. It can be cancelled from the Order Book before settlement, subject to the investor’s approval."
                busy={submitting}
                submitLabel="Place Order"
                onBack={() => setConfirming(false)}
                onConfirm={submit}
              />
            )}
          </div>
        )}
      </Panel>

      <p className="text-center text-[11px] text-text-faint">
        <EnvBadge env={env} /> {envNote(env)}
      </p>
      </div>
    </div>
  );
}



