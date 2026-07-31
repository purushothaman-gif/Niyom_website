/**
 * Switch — move a holding from one scheme into another at BSE.
 *
 * Two hard constraints, both enforced here rather than discovered as a BSE
 * rejection:
 *  - a switch needs a FOLIO, so it can only act on an allotted position;
 *  - BSE allows switches only WITHIN THE SAME AMC, so the destination list is
 *    filtered to the source holding's AMC.
 */
import { useMemo, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { fmt } from '../../../crm/utils';
import { Card } from '../../../portal/components/Card';
import { SectionHeader } from '../../../portal/components/SectionHeader';
import { LogoLoader } from '../../../components/LogoLoader';
import {
  BseOpsService,
  isBseConfigured,
  type BseHoldingRow,
  type BseSchemeRow,
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

export function SwitchPage() {
  // Display only — the proxy resolves the real EUIN from the session.
  const euin = useCallerEuin();
  const holdings = useBseData<BseHoldingRow[]>(() => BseOpsService.holdings());
  const schemes = useBseData<BseSchemeRow[]>(() => BseOpsService.schemes());

  const [key, setKey] = useState(''); // folio|scheme
  const [toScheme, setToScheme] = useState('');
  const [mode, setMode] = useState<RedeemMode>('amount');
  const [value, setValue] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ orderId: string; detail: string } | null>(null);

  const all = holdings.data ?? [];
  const holding = all.find((h) => `${h.folio}|${h.schemeCode}` === key) ?? null;

  // The source scheme's AMC — switches must stay inside it.
  const sourceAmc = useMemo(() => {
    if (!holding) return null;
    return (schemes.data ?? []).find((s) => s.schemeCode === holding.schemeCode)?.amc ?? null;
  }, [holding, schemes.data]);

  const destinations = useMemo(() => {
    if (!holding) return [];
    return (schemes.data ?? [])
      .filter(
        (s) =>
          s.isOpen &&
          s.allowsPhysical &&
          s.schemeCode !== holding.schemeCode &&
          // same AMC only — BSE rejects cross-AMC switches outright
          (sourceAmc ? s.amc === sourceAmc : true),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [holding, schemes.data, sourceAmc]);

  const num = Number(value);
  const valueError = (() => {
    if (mode === 'all' || !value.trim()) return null;
    if (!Number.isFinite(num) || num <= 0) return 'Enter a valid number.';
    if (mode === 'units' && holding && num > holding.units)
      return `Only ${holding.units} units held.`;
    return null;
  })();

  const ready = Boolean(
    holding && toScheme && (mode === 'all' || (value.trim() && !valueError)),
  );

  const submit = async () => {
    if (!holding || !toScheme) return;
    const dest = destinations.find((d) => d.schemeCode === toScheme);
    setBusy(true);
    setError(null);
    try {
      const res = await BseOpsService.switch({
        clientCode: holding.clientCode,
        fromSchemeCode: holding.schemeCode,
        fromSchemeName: holding.schemeName,
        toSchemeCode: toScheme,
        toSchemeName: dest?.name ?? toScheme,
        folio: holding.folio,
        mode,
        amount: mode === 'amount' ? num : mode === 'all' ? holding.value : 0,
        units: mode === 'units' ? num : mode === 'all' ? holding.units : 0,
      });
      setDone({ orderId: res.orderId, detail: res.detail });
      setConfirming(false);
      setValue('');
      setKey('');
      setToScheme('');
      holdings.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The switch could not be placed.');
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  if (!isBseConfigured()) return <NotConfigured title="Switch" />;

  const loading = holdings.loading || schemes.loading;
  const loadError = holdings.error ?? schemes.error;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      {done && (
        <SuccessCard title="Switch placed at BSE">
          <p className="mt-1 text-sm text-text-secondary">{done.detail}</p>
          <p className="mt-2 text-xs text-text-secondary">
            Order ID <span className="font-mono font-semibold">{done.orderId}</span> — track it in
            the Order Book.
          </p>
        </SuccessCard>
      )}

      <Card>
        <SectionHeader title="Switch Between Schemes" icon={ArrowLeftRight} />

        {loading && (
          <div className="flex min-h-[200px] items-center justify-center">
            <LogoLoader size={44} />
          </div>
        )}

        {!loading && loadError && <ErrorNote title="Couldn’t load from BSE." message={loadError} />}

        {!loading && !loadError && (
          <div className="space-y-4">
            {all.length === 0 && (
              <WarnNote>
                No switchable holdings yet. A switch acts on an existing folio, which is created
                only once a purchase is <strong>allotted</strong>.
              </WarnNote>
            )}

            <Field label="From (holding)">
              <select
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setToScheme('');
                }}
                disabled={all.length === 0}
                className={selectCls}
              >
                <option value="">Select a holding…</option>
                {all.map((h) => (
                  <option key={`${h.folio}|${h.schemeCode}`} value={`${h.folio}|${h.schemeCode}`}>
                    {h.clientCode} · {h.folio} · {h.schemeName || h.schemeCode} — {h.units} units
                  </option>
                ))}
              </select>
            </Field>

            {holding && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-token-md bg-bg-base px-3 py-2 text-[11px] text-text-secondary">
                <span>
                  Units <strong className="text-text-primary">{holding.units}</strong>
                </span>
                <span>
                  Value <strong className="text-text-primary">{fmt(holding.value)}</strong>
                </span>
                {sourceAmc && <span>{sourceAmc}</span>}
              </div>
            )}

            <Field label="To (scheme)">
              <select
                value={toScheme}
                onChange={(e) => setToScheme(e.target.value)}
                disabled={!holding}
                className={selectCls}
              >
                <option value="">Select a destination…</option>
                {destinations.map((s) => (
                  <option key={s.schemeCode} value={s.schemeCode}>
                    {s.name} ({s.schemeCode})
                  </option>
                ))}
              </select>
              {holding && (
                <p className="mt-1 text-[11px] text-text-faint">
                  {destinations.length} scheme{destinations.length === 1 ? '' : 's'} available
                  {sourceAmc ? ` — switches must stay within ${sourceAmc}` : ''}.
                </p>
              )}
            </Field>

            <Field label="Switch by">
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

            {error && <ErrorNote title="The switch was not placed." message={error} />}

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
                Review Switch
              </button>
            ) : (
              holding && (
                <ConfirmBox
                  rows={[
                    { label: 'Client', value: holding.clientCode },
                    { label: 'From', value: holding.schemeName || holding.schemeCode },
                    {
                      label: 'To',
                      value: destinations.find((d) => d.schemeCode === toScheme)?.name ?? toScheme,
                    },
                    { label: 'Folio', value: holding.folio },
                    { label: 'EUIN · ARN', value: `${euin} · ${NIYOM_ARN}` },
                    {
                      label: 'Switching',
                      value:
                        mode === 'all'
                          ? `Everything (${holding.units} units)`
                          : mode === 'units'
                            ? `${num} units`
                            : fmt(num),
                    },
                  ]}
                  note="This places a real switch with BSE StAR MF: units are sold in the source scheme and bought in the destination at the applicable NAVs."
                  busy={busy}
                  submitLabel="Place Switch"
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
