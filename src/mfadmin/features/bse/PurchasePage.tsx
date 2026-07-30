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
import { AlertTriangle, CheckCircle2, Clock, ShoppingCart } from 'lucide-react';
import { fmt } from '../../../crm/utils';
import { Card } from '../../../portal/components/Card';
import { SectionHeader } from '../../../portal/components/SectionHeader';
import { StatusPill } from '../../../portal/components/StatusPill';
import { LogoLoader } from '../../../components/LogoLoader';
import {
  BseOpsService,
  isBseConfigured,
  type BseSchemeRow,
  type BseUccRow,
} from '../../services/BseOpsService';
import { useBseData } from '../../hooks/useBseData';

interface Placed {
  orderId: string;
  amount: number;
  schemeName: string;
  clientCode: string;
}

export function PurchasePage() {
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
    if (scheme?.purchase && amt < scheme.purchase.min)
      return `Minimum for this scheme is ${fmt(scheme.purchase.min)}.`;
    if (scheme?.purchase && scheme.purchase.max > 0 && amt > scheme.purchase.max)
      return `Maximum for this scheme is ${fmt(scheme.purchase.max)}.`;
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

  if (!isBseConfigured()) {
    return (
      <Card padding="lg" className="mx-auto max-w-lg text-center">
        <h2 className="font-display text-xl font-bold text-text-primary">Purchase</h2>
        <p className="mt-2 text-sm text-text-secondary">
          Live ordering isn’t connected in this environment. Set{' '}
          <code className="rounded bg-bg-base px-1 py-0.5 text-[11px]">VITE_BSE_PROXY_URL</code>.
        </p>
      </Card>
    );
  }

  const loading = uccs.loading || schemes.loading;
  const loadError = uccs.error ?? schemes.error;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {placed && (
        <Card padding="lg" className="border-success/30 bg-success/5">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <div className="min-w-0">
              <p className="font-semibold text-text-primary">Order placed at BSE</p>
              <p className="mt-1 text-sm text-text-secondary">
                {fmt(placed.amount)} into {placed.schemeName} for {placed.clientCode}.
              </p>
              <p className="mt-2 text-xs text-text-secondary">
                Order ID <span className="font-mono font-semibold">{placed.orderId}</span> — track it
                in the Order Book.
              </p>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <SectionHeader title="New Purchase" icon={ShoppingCart} />

        {loading && (
          <div className="flex min-h-[200px] items-center justify-center">
            <LogoLoader size={44} />
          </div>
        )}

        {!loading && loadError && (
          <div className="flex items-start gap-2 rounded-token-md border border-danger-soft/20 bg-danger-soft/10 p-3 text-xs text-danger-soft">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {!loading && !loadError && (
          <div className="space-y-4">
            {activeUccs.length === 0 && (
              <div className="flex items-start gap-2 rounded-token-md border border-warning/20 bg-warning/10 p-3 text-xs text-warning">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  No transaction-ready clients. A UCC must reach <strong>ACTIVE</strong> at BSE
                  (KYC, PAN and investor 2FA complete) before it can transact.
                </span>
              </div>
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

            {error && (
              <div className="flex items-start gap-2 rounded-token-md border border-danger-soft/20 bg-danger-soft/10 p-3 text-xs text-danger-soft">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <div>
                  <p className="font-semibold">The order was not placed.</p>
                  <p className="mt-0.5 opacity-90">{error}</p>
                </div>
              </div>
            )}

            {!confirming ? (
              <button
                type="button"
                disabled={!ready}
                onClick={() => {
                  setError(null);
                  setPlaced(null);
                  setConfirming(true);
                }}
                className="w-full rounded-token-md py-3 text-sm font-bold text-on-accent disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
              >
                Review Order
              </button>
            ) : (
              <div className="rounded-token-md border border-accent/30 bg-accent/5 p-4">
                <p className="text-sm font-semibold text-text-primary">Confirm this order</p>
                <dl className="mt-3 space-y-1.5 text-xs">
                  <Row label="Client" value={`${client?.name?.trim() || ''} (${clientCode})`} />
                  <Row label="Scheme" value={scheme?.name ?? ''} />
                  <Row label="Amount" value={fmt(amt)} />
                  <Row label="Type" value="Lumpsum purchase · Physical" />
                </dl>
                <p className="mt-3 text-[11px] text-text-secondary">
                  This places a real order with BSE StAR MF. It can be cancelled from the Order Book
                  before settlement, subject to the investor’s approval.
                </p>
                <div className="mt-4 flex gap-2">
                  <button
                    type="button"
                    onClick={() => setConfirming(false)}
                    disabled={submitting}
                    className="flex-1 rounded-token-md border border-border bg-bg-surface py-2.5 text-xs font-semibold text-text-primary disabled:opacity-50"
                  >
                    Back
                  </button>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={submitting}
                    className="flex-1 rounded-token-md py-2.5 text-xs font-bold text-on-accent disabled:opacity-60"
                    style={{
                      background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))',
                    }}
                  >
                    {submitting ? 'Placing…' : 'Place Order'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      <p className="text-center text-[11px] text-text-faint">
        <StatusPill tone="success">Live</StatusPill> Orders are placed directly with BSE StAR MF.
      </p>
    </div>
  );
}

const selectCls =
  'w-full rounded-token-md border border-border bg-bg-base px-3 py-2.5 text-sm text-text-primary outline-none focus:border-accent disabled:opacity-50';
const inputCls = selectCls;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-text-primary">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium text-text-primary">{value}</dd>
    </div>
  );
}
