/**
 * Goal calculators.
 *
 * Pure client-side arithmetic — these need no BSE data, which is why they work
 * regardless of the proxy or the member tier. Two directions:
 *   - goal calculators solve for the monthly SIP needed to reach a target;
 *   - SIP / lumpsum solve for the corpus a given contribution produces.
 *
 * Inflation is applied to goal targets because a "₹1 Cr in 20 years" plan that
 * ignores it is not a plan. Existing savings are grown at the same return and
 * netted off the target before the SIP is derived.
 */
import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { CALCULATORS, type CalculatorDef } from '../../layout/adminNav';
import { PageHead, Panel, StatTile } from '../../ui/Surface';
import { SubNav, fieldCls } from '../../ui/controls';
import { inr, inrCompact } from '../../../lib/money';

/** Future value of a lumpsum at an annual rate. */
const grow = (pv: number, rate: number, years: number) => pv * Math.pow(1 + rate / 100, years);

/** Future value of a monthly contribution (annuity-due — invested at period start). */
function sipFutureValue(monthly: number, annualRate: number, years: number): number {
  const i = annualRate / 100 / 12;
  const n = Math.round(years * 12);
  if (n <= 0) return 0;
  if (i === 0) return monthly * n;
  return monthly * ((Math.pow(1 + i, n) - 1) / i) * (1 + i);
}

/** Monthly contribution needed to reach `target`. Inverse of the above. */
function sipRequired(target: number, annualRate: number, years: number): number {
  const i = annualRate / 100 / 12;
  const n = Math.round(years * 12);
  if (n <= 0) return 0;
  if (i === 0) return target / n;
  return target / (((Math.pow(1 + i, n) - 1) / i) * (1 + i));
}

export function CalculatorsPage() {
  const [id, setId] = useState(CALCULATORS[0].id);
  const active = CALCULATORS.find((c) => c.id === id) ?? CALCULATORS[0];

  return (
    <>
      <PageHead
        title="Calculators"
        subtitle="Planning tools for client conversations. Nothing here touches BSE."
      />
      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
        <SubNav
          value={id}
          onChange={setId}
          items={CALCULATORS.map((c) => ({ value: c.id, label: c.label, icon: c.icon }))}
          heading="Goal"
        />
        <div className="min-w-0">
          {active.defaultTarget === null ? (
            <GrowthCalculator key={active.id} def={active} />
          ) : (
            <GoalCalculator key={active.id} def={active} />
          )}
        </div>
      </div>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  suffix,
  step = '1',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  suffix?: string;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold text-text-primary">{label}</span>
      <div className="relative">
        <input
          type="number"
          inputMode="decimal"
          step={step}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={`${fieldCls} ${suffix ? 'pr-10' : ''}`}
        />
        {suffix && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-text-faint">
            {suffix}
          </span>
        )}
      </div>
    </label>
  );
}

/** Solves for the monthly SIP needed to hit an inflation-adjusted target. */
function GoalCalculator({ def }: { def: CalculatorDef }) {
  const [target, setTarget] = useState(String(def.defaultTarget ?? 1000000));
  const [years, setYears] = useState('15');
  const [savings, setSavings] = useState('0');
  const [rate, setRate] = useState('12');
  const [inflation, setInflation] = useState('6');

  const r = useMemo(() => {
    const t = Number(target) || 0;
    const y = Number(years) || 0;
    const s = Number(savings) || 0;
    const ret = Number(rate) || 0;
    const inf = Number(inflation) || 0;

    const futureCost = grow(t, inf, y);
    const savingsGrown = grow(s, ret, y);
    const shortfall = Math.max(futureCost - savingsGrown, 0);
    const monthly = sipRequired(shortfall, ret, y);
    return { futureCost, savingsGrown, shortfall, monthly, invested: monthly * y * 12, y };
  }, [target, years, savings, rate, inflation]);

  return (
    <div className="space-y-5">
      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={def.goalLabel} value={target} onChange={setTarget} suffix="₹" step="10000" />
          <Field label="Years to the goal" value={years} onChange={setYears} suffix="yrs" />
          <Field label="Savings already set aside" value={savings} onChange={setSavings} suffix="₹" step="10000" />
          <Field label="Expected return" value={rate} onChange={setRate} suffix="%" step="0.5" />
          <Field label="Inflation" value={inflation} onChange={setInflation} suffix="%" step="0.5" />
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Monthly SIP needed"
          value={r.monthly > 0 ? inr(Math.ceil(r.monthly)) : '₹0'}
          tone="positive"
          sub={r.monthly <= 0 ? 'Existing savings already cover this goal.' : `for ${r.y} years`}
        />
        <StatTile
          label={`${def.goalLabel} in ${r.y} yrs`}
          value={inrCompact(r.futureCost)}
          sub="after inflation"
        />
        <StatTile label="Savings grow to" value={inrCompact(r.savingsGrown)} />
        <StatTile label="You invest" value={inrCompact(r.invested)} sub="total contributions" />
      </div>

      <Note>
        Inflation is applied to the goal, and existing savings are grown at the same expected return
        and netted off before the SIP is derived. Returns are an assumption, not a forecast.
      </Note>
    </div>
  );
}

/** Solves for the corpus a given SIP or lumpsum produces. */
function GrowthCalculator({ def }: { def: CalculatorDef }) {
  const isSip = def.id === 'sip';
  const [amount, setAmount] = useState(isSip ? '10000' : '500000');
  const [years, setYears] = useState('15');
  const [rate, setRate] = useState('12');
  const [stepUp, setStepUp] = useState('0');

  const r = useMemo(() => {
    const a = Number(amount) || 0;
    const y = Number(years) || 0;
    const ret = Number(rate) || 0;
    const su = Number(stepUp) || 0;

    if (!isSip) {
      const fv = grow(a, ret, y);
      return { fv, invested: a, gain: fv - a };
    }
    // Step-up: each year's contribution rises, and every year's block compounds
    // for the remaining term.
    let fv = 0;
    let invested = 0;
    for (let year = 0; year < y; year++) {
      const monthly = a * Math.pow(1 + su / 100, year);
      invested += monthly * 12;
      fv += sipFutureValue(monthly, ret, 1) * Math.pow(1 + ret / 100, y - year - 1);
    }
    return { fv, invested, gain: fv - invested };
  }, [amount, years, rate, stepUp, isSip]);

  return (
    <div className="space-y-5">
      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={isSip ? 'Monthly investment' : 'One-time investment'}
            value={amount}
            onChange={setAmount}
            suffix="₹"
            step="1000"
          />
          <Field label="Period" value={years} onChange={setYears} suffix="yrs" />
          <Field label="Expected return" value={rate} onChange={setRate} suffix="%" step="0.5" />
          {isSip && (
            <Field label="Annual step-up" value={stepUp} onChange={setStepUp} suffix="%" step="1" />
          )}
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Value at maturity" value={inrCompact(r.fv)} tone="positive" />
        <StatTile label="You invest" value={inrCompact(r.invested)} />
        <StatTile
          label="Wealth gained"
          value={inrCompact(r.gain)}
          tone={r.gain >= 0 ? 'positive' : 'negative'}
        />
      </div>

      <Note>
        {isSip
          ? 'Contributions are treated as invested at the start of each month, and a step-up raises the amount every year.'
          : 'Compounded annually at the expected return.'}{' '}
        Mutual fund returns are not guaranteed.
      </Note>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-token-md border border-border-subtle bg-bg-base p-3 text-[11px] leading-relaxed text-text-faint">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
