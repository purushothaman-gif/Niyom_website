/**
 * Return calculator — "what would this fund have done with my money".
 * -----------------------------------------------------------------------------
 * Backward-looking on purpose. It applies THIS fund's own realised annualised
 * return for each period to a hypothetical investment, so every number on
 * screen is traceable to the returns shown above it. It does not project
 * forward at an assumed rate, because that would be a number about the future
 * with nothing behind it.
 *
 * Periods with no history (a three-year-old fund has no 5Y figure) are dropped
 * rather than filled in.
 */
import { useState } from 'react';
import { fmt } from '../../../../crm/utils';
import { Card } from '../../../components/Card';
import { Segmented } from '../../../components/Segmented';
import { SectionHeader } from '../../../components/SectionHeader';
import type { CatalogFund } from '../../../types/funds';
import { Calculator } from 'lucide-react';
import { retColor } from './catalogBits';
import { ret, type ReturnKey } from './collections';

type Mode = 'sip' | 'lumpsum';

const PERIODS: { key: ReturnKey; years: number; label: string }[] = [
  { key: '1Y', years: 1, label: '1 year' },
  { key: '3Y', years: 3, label: '3 years' },
  { key: '5Y', years: 5, label: '5 years' },
];

const SIP_STEPS = [500, 1000, 2500, 5000, 10000, 25000];
const LUMPSUM_STEPS = [5000, 10000, 25000, 50000, 100000, 500000];

/** Future value of a monthly SIP of `amount` for `years` at annualised `cagr`%. */
export function sipFutureValue(amount: number, years: number, cagr: number): number {
  const i = Math.pow(1 + cagr / 100, 1 / 12) - 1;
  const n = Math.round(years * 12);
  if (i === 0) return amount * n;
  return amount * ((Math.pow(1 + i, n) - 1) / i) * (1 + i);
}

/** Future value of a one-time investment at annualised `cagr`%. */
export function lumpsumFutureValue(amount: number, years: number, cagr: number): number {
  return amount * Math.pow(1 + cagr / 100, years);
}

export function ReturnCalculator({ fund }: { fund: CatalogFund }) {
  const [mode, setMode] = useState<Mode>('sip');
  const [sipAmount, setSipAmount] = useState(5000);
  const [lumpsumAmount, setLumpsumAmount] = useState(100000);

  const amount = mode === 'sip' ? sipAmount : lumpsumAmount;
  const setAmount = mode === 'sip' ? setSipAmount : setLumpsumAmount;
  const steps = mode === 'sip' ? SIP_STEPS : LUMPSUM_STEPS;

  const rows = PERIODS.map((p) => {
    const cagr = ret(fund, p.key);
    if (cagr === null) return null;
    const invested = mode === 'sip' ? amount * p.years * 12 : amount;
    const value =
      mode === 'sip'
        ? sipFutureValue(amount, p.years, cagr)
        : lumpsumFutureValue(amount, p.years, cagr);
    const gain = value - invested;
    return { ...p, invested, value, gain, gainPct: invested > 0 ? (gain / invested) * 100 : 0 };
  }).filter((r): r is NonNullable<typeof r> => r !== null);

  if (rows.length === 0) return null;

  return (
    <Card>
      <SectionHeader title="Return calculator" icon={Calculator} />

      <Segmented<Mode>
        options={[
          { value: 'sip', label: 'Monthly SIP' },
          { value: 'lumpsum', label: 'One-time' },
        ]}
        value={mode}
        onChange={setMode}
      />

      <div className="mt-5 text-center">
        <p className="text-[11px] uppercase tracking-wide text-text-faint">
          {mode === 'sip' ? 'Monthly investment' : 'One-time investment'}
        </p>
        <p className="font-display text-3xl font-bold text-text-primary">{fmt(amount)}</p>
      </div>

      <input
        type="range"
        min={steps[0]}
        max={steps[steps.length - 1]}
        step={steps[0]}
        value={amount}
        onChange={(e) => setAmount(Number(e.target.value))}
        className="mt-4 w-full accent-[var(--accent)]"
        aria-label={mode === 'sip' ? 'Monthly investment amount' : 'One-time investment amount'}
      />

      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {steps.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setAmount(s)}
            className={`rounded-token-md border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
              amount === s
                ? 'border-accent/30 bg-selected text-accent'
                : 'border-border bg-bg-raised text-text-muted hover:text-text-primary'
            }`}
          >
            {fmt(s)}
          </button>
        ))}
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-[11px] uppercase tracking-wide text-text-faint">
              <th className="py-2 text-left font-semibold">Over the past</th>
              <th className="py-2 text-right font-semibold">Invested</th>
              <th className="py-2 text-right font-semibold">Would’ve become</th>
              <th className="py-2 text-right font-semibold">Returns</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="py-3 font-semibold text-text-primary">{r.label}</td>
                <td className="py-3 text-right text-text-secondary">{fmt(r.invested)}</td>
                <td className="py-3 text-right font-bold text-text-primary">{fmt(r.value)}</td>
                <td className="py-3 text-right font-bold" style={{ color: retColor(r.gainPct) }}>
                  {r.gainPct > 0 ? '+' : ''}
                  {r.gainPct.toFixed(2)}%
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] leading-relaxed text-text-faint">
        A hypothetical applied to this fund’s own realised returns for each period — not a forecast.
        {mode === 'sip'
          ? ' A real SIP buys at every month’s NAV, so an actual result would differ.'
          : ' Actual returns depend on the NAV on the day you invest.'}
      </p>
    </Card>
  );
}
