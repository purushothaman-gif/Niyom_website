/**
 * Redeem — sell units from a client's folio at BSE.
 *
 * A redemption needs a FOLIO, and a folio only exists once a purchase has been
 * allotted. Positions therefore come from the proxy's /holdings (netted from
 * settled orders), and the form stays disabled until a client actually holds
 * something — rather than offering a redemption BSE would reject.
 */
import { useMemo, useState } from 'react';
import { Undo2 } from 'lucide-react';
import { fmt } from '../../../crm/utils';
import { Card } from '../../../portal/components/Card';
import { SectionHeader } from '../../../portal/components/SectionHeader';
import { LogoLoader } from '../../../components/LogoLoader';
import {
  BseOpsService,
  isBseConfigured,
  type BseHoldingRow,
  type BseUccRow,
  type RedeemMode,
} from '../../services/BseOpsService';
import { useBseData } from '../../hooks/useBseData';
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
import { NIYOM_ARN, useCallerEuin } from '../../hooks/useCallerEuin';

export function RedeemPage() {
  // Display only — the proxy resolves the real EUIN from the session.
  const euin = useCallerEuin();
  const uccs = useBseData<BseUccRow[]>(() => BseOpsService.uccs());
  const holdings = useBseData<BseHoldingRow[]>(() => BseOpsService.holdings());

  const [clientCode, setClientCode] = useState('');
  const [key, setKey] = useState(''); // folio|scheme
  const [mode, setMode] = useState<RedeemMode>('amount');
  const [value, setValue] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ orderId: string; detail: string } | null>(null);

  const activeUccs = useMemo(
    () => (uccs.data ?? []).filter((u) => u.status.toUpperCase() === 'ACTIVE'),
    [uccs.data],
  );
  const clientHoldings = useMemo(
    () => (holdings.data ?? []).filter((h) => !clientCode || h.clientCode === clientCode),
    [holdings.data, clientCode],
  );
  const holding = clientHoldings.find((h) => `${h.folio}|${h.schemeCode}` === key) ?? null;

  const num = Number(value);
  const valueError = (() => {
    if (mode === 'all' || !value.trim()) return null;
    if (!Number.isFinite(num) || num <= 0) return 'Enter a valid number.';
    if (mode === 'units' && holding && num > holding.units)
      return `Only ${holding.units} units held.`;
    if (mode === 'amount' && holding && holding.value > 0 && num > holding.value)
      return `Position is worth about ${fmt(holding.value)}.`;
    return null;
  })();

  const ready = Boolean(holding && (mode === 'all' || (value.trim() && !valueError)));

  const submit = async () => {
    if (!holding) return;
    setBusy(true);
    setError(null);
    try {
      const res = await BseOpsService.redeem({
        clientCode: holding.clientCode,
        schemeCode: holding.schemeCode,
        schemeName: holding.schemeName,
        folio: holding.folio,
        mode,
        amount: mode === 'amount' ? num : mode === 'all' ? holding.value : 0,
        units: mode === 'units' ? num : mode === 'all' ? holding.units : 0,
      });
      setDone({ orderId: res.orderId, detail: res.detail });
      setConfirming(false);
      setValue('');
      setKey('');
      holdings.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The redemption could not be placed.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  if (!isBseConfigured()) return <NotConfigured title="Redeem" />;

  const loading = uccs.loading || holdings.loading;
  const loadError = uccs.error ?? holdings.error;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {done && (
        <SuccessCard title="Redemption placed at BSE">
          <p className="mt-1 text-sm text-text-secondary">{done.detail}</p>
          <p className="mt-2 text-xs text-text-secondary">
            Order ID <span className="font-mono font-semibold">{done.orderId}</span> — track it in
            the Order Book.
          </p>
        </SuccessCard>
      )}

      <Card>
        <SectionHeader title="Redeem Units" icon={Undo2} />

        {loading && (
          <div className="flex min-h-[200px] items-center justify-center">
            <LogoLoader size={44} />
          </div>
        )}

        {!loading && loadError && <ErrorNote title="Couldn’t load from BSE." message={loadError} />}

        {!loading && !loadError && (
          <div className="space-y-4">
            {(holdings.data ?? []).length === 0 && (
              <WarnNote>
                No redeemable holdings yet. A folio is created only once a purchase is{' '}
                <strong>allotted</strong> by the RTA — orders still showing “received” cannot be
                redeemed against.
              </WarnNote>
            )}

            <Field label="Client (UCC)">
              <select
                value={clientCode}
                onChange={(e) => {
                  setClientCode(e.target.value);
                  setKey('');
                }}
                className={selectCls}
              >
                <option value="">All clients</option>
                {activeUccs.map((u) => (
                  <option key={u.clientCode} value={u.clientCode}>
                    {u.name?.trim() || u.clientCode} — {u.clientCode}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Holding (folio · scheme)">
              <select
                value={key}
                onChange={(e) => setKey(e.target.value)}
                disabled={clientHoldings.length === 0}
                className={selectCls}
              >
                <option value="">Select a holding…</option>
                {clientHoldings.map((h) => (
                  <option key={`${h.folio}|${h.schemeCode}`} value={`${h.folio}|${h.schemeCode}`}>
                    {h.folio} · {h.schemeName || h.schemeCode} — {h.units} units
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-text-faint">
                {clientHoldings.length} redeemable holding{clientHoldings.length === 1 ? '' : 's'}.
              </p>
            </Field>

            {holding && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-token-md bg-bg-base px-3 py-2 text-[11px] text-text-secondary">
                <span>
                  Units <strong className="text-text-primary">{holding.units}</strong>
                </span>
                <span>
                  Value <strong className="text-text-primary">{fmt(holding.value)}</strong>
                </span>
                {holding.lastNav > 0 && <span>NAV {holding.lastNav}</span>}
              </div>
            )}

            <Field label="Redeem by">
              <select
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as RedeemMode);
                  setValue('');
                }}
                className={selectCls}
              >
                <option value="amount">Amount (₹)</option>
                <option value="units">Units</option>
                <option value="all">Everything in this folio</option>
              </select>
            </Field>

            {mode !== 'all' && (
              <Field label={mode === 'amount' ? 'Amount (₹)' : 'Units'}>
                <input
                  type="number"
                  inputMode="decimal"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  className={inputCls}
                />
                {valueError && <p className="mt-1 text-[11px] text-danger">{valueError}</p>}
              </Field>
            )}

            {error && <ErrorNote title="The redemption was not placed." message={error} />}

            {!confirming ? (
              <button
                type="button"
                disabled={!ready}
                onClick={() => {
                  setError(null);
                  setDone(null);
                  setConfirming(true);
                }}
                className="w-full rounded-token-md py-3 text-sm font-bold text-on-accent disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
              >
                Review Redemption
              </button>
            ) : (
              holding && (
                <ConfirmBox
                  rows={[
                    { label: 'Client', value: holding.clientCode },
                    { label: 'Scheme', value: holding.schemeName || holding.schemeCode },
                    { label: 'Folio', value: holding.folio },
                    { label: 'EUIN · ARN', value: `${euin} · ${NIYOM_ARN}` },
                    {
                      label: 'Redeeming',
                      value:
                        mode === 'all'
                          ? `Everything (${holding.units} units)`
                          : mode === 'units'
                            ? `${num} units`
                            : fmt(num),
                    },
                  ]}
                  note="This places a real redemption with BSE StAR MF. Units are sold at the applicable NAV once the RTA processes it."
                  busy={busy}
                  submitLabel="Place Redemption"
                  onBack={() => setConfirming(false)}
                  onConfirm={submit}
                />
              )
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
