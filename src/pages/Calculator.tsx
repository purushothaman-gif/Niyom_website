import { useMemo, useState, type ElementType, type ReactNode } from 'react';
import { Calculator as CalcIcon, TrendingUp, PiggyBank, Target, Landmark } from 'lucide-react';
import { PublicPageChrome } from './shared/PublicPageChrome';

/**
 * Public financial calculators — SIP, Lumpsum, Retirement, and Goal planning.
 *
 * Fully client-side and deterministic. All maths use standard compound-interest
 * formulas with monthly compounding for SIP-style flows; see each helper for the
 * exact formula. Currency is rendered with the Indian numbering system.
 */

type CalculatorId = 'sip' | 'lumpsum' | 'retirement' | 'goal';

const inr0 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

const formatINR = (n: number) => (Number.isFinite(n) ? inr0.format(Math.round(n)) : '—');

/** Compact ₹ form for large numbers: ₹1.2 Cr / ₹45.0 L / ₹12,000. */
function formatCompactINR(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `₹${(n / 1e5).toFixed(2)} L`;
  return formatINR(n);
}

// ---------------------------------------------------------------------------
// Finance helpers
// ---------------------------------------------------------------------------

/** Future value of a monthly SIP (annuity-due: contributions at start of month). */
function sipFutureValue(monthly: number, annualRatePct: number, years: number): number {
  const i = annualRatePct / 100 / 12;
  const n = Math.round(years * 12);
  if (n <= 0) return 0;
  if (i === 0) return monthly * n;
  return monthly * ((Math.pow(1 + i, n) - 1) / i) * (1 + i);
}

/** Monthly SIP required to reach a target future value (annuity-due). */
function sipRequired(target: number, annualRatePct: number, years: number): number {
  const i = annualRatePct / 100 / 12;
  const n = Math.round(years * 12);
  if (n <= 0) return target;
  if (i === 0) return target / n;
  return target / (((Math.pow(1 + i, n) - 1) / i) * (1 + i));
}

/** Future value of a one-time lumpsum with annual compounding. */
function lumpsumFutureValue(principal: number, annualRatePct: number, years: number): number {
  return principal * Math.pow(1 + annualRatePct / 100, years);
}

// ---------------------------------------------------------------------------
// Reusable input control
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  prefix?: string;
  suffix?: string;
  format?: (v: number) => string;
}

function Field({ label, value, onChange, min, max, step, prefix, suffix, format }: FieldProps) {
  const id = label.replace(/\s+/g, '-').toLowerCase();
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-3">
        <label htmlFor={id} className="text-sm font-medium text-text-secondary">{label}</label>
        <div className="flex items-center gap-1 rounded-lg px-2.5 py-1" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-subtle)' }}>
          {prefix && <span className="text-sm text-text-muted">{prefix}</span>}
          <input
            id={id}
            type="number"
            inputMode="numeric"
            value={value}
            min={min}
            max={max}
            step={step}
            onChange={(e) => onChange(clamp(Number(e.target.value) || 0))}
            className="w-24 bg-transparent text-right font-semibold text-text-primary focus:outline-none"
          />
          {suffix && <span className="text-sm text-text-muted">{suffix}</span>}
        </div>
      </div>
      <input
        type="range"
        aria-label={label}
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(clamp(Number(e.target.value)))}
        className="w-full cursor-pointer"
        style={{ accentColor: 'rgb(var(--accent-soft-rgb))' }}
      />
      {format && <div className="mt-1 text-xs text-text-faint">{format(value)}</div>}
    </div>
  );
}

/** Donut showing invested vs. returns split. */
function SplitDonut({ invested, gains }: { invested: number; gains: number }) {
  const total = Math.max(invested + gains, 1);
  const gainsPct = Math.max(0, Math.min(100, (gains / total) * 100));
  const r = 52;
  const c = 2 * Math.PI * r;
  const gainsLen = (gainsPct / 100) * c;
  return (
    <svg viewBox="0 0 140 140" className="w-40 h-40" role="img" aria-label="Invested versus returns split">
      <circle cx="70" cy="70" r={r} fill="none" stroke="var(--bg-raised)" strokeWidth="16" />
      <circle
        cx="70" cy="70" r={r} fill="none" stroke="rgb(var(--accent-soft-rgb))" strokeWidth="16"
        strokeDasharray={`${gainsLen} ${c - gainsLen}`} strokeDashoffset={c * 0.25} strokeLinecap="round"
        transform="rotate(-90 70 70)"
      />
      <text x="70" y="66" textAnchor="middle" className="fill-text-muted" style={{ fontSize: 10 }}>Returns</text>
      <text x="70" y="82" textAnchor="middle" className="fill-text-primary" style={{ fontSize: 15, fontWeight: 700 }}>
        {gainsPct.toFixed(0)}%
      </text>
    </svg>
  );
}

function ResultCard({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div
      className="rounded-xl p-4"
      style={{
        background: emphasis ? 'rgba(var(--accent-soft-rgb), 0.10)' : 'var(--bg-raised)',
        border: emphasis ? '1px solid rgba(var(--accent-soft-rgb), 0.35)' : '1px solid var(--border-subtle)',
      }}
    >
      <div className="text-xs text-text-muted mb-1">{label}</div>
      <div className={`text-xl font-bold ${emphasis ? 'text-accent-soft' : 'text-text-primary'}`} style={{ fontFamily: 'var(--font-display)' }}>
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual calculators
// ---------------------------------------------------------------------------

function SipCalculator() {
  const [monthly, setMonthly] = useState(10000);
  const [rate, setRate] = useState(12);
  const [years, setYears] = useState(15);

  const { fv, invested, gains } = useMemo(() => {
    const fv = sipFutureValue(monthly, rate, years);
    const invested = monthly * years * 12;
    return { fv, invested, gains: fv - invested };
  }, [monthly, rate, years]);

  return (
    <CalcLayout
      inputs={
        <>
          <Field label="Monthly investment" value={monthly} onChange={setMonthly} min={500} max={500000} step={500} prefix="₹" />
          <Field label="Expected return (p.a.)" value={rate} onChange={setRate} min={1} max={30} step={0.5} suffix="%" />
          <Field label="Investment period" value={years} onChange={setYears} min={1} max={40} step={1} suffix="yrs" />
        </>
      }
      donut={<SplitDonut invested={invested} gains={gains} />}
      results={
        <>
          <ResultCard label="Invested amount" value={formatINR(invested)} />
          <ResultCard label="Est. returns" value={formatINR(gains)} />
          <ResultCard label="Total value" value={formatINR(fv)} emphasis />
        </>
      }
      note={`Investing ${formatINR(monthly)}/month for ${years} years at ${rate}% p.a. grows to about ${formatCompactINR(fv)}.`}
    />
  );
}

function LumpsumCalculator() {
  const [amount, setAmount] = useState(500000);
  const [rate, setRate] = useState(12);
  const [years, setYears] = useState(10);

  const { fv, gains } = useMemo(() => {
    const fv = lumpsumFutureValue(amount, rate, years);
    return { fv, gains: fv - amount };
  }, [amount, rate, years]);

  return (
    <CalcLayout
      inputs={
        <>
          <Field label="Investment amount" value={amount} onChange={setAmount} min={1000} max={10000000} step={1000} prefix="₹" />
          <Field label="Expected return (p.a.)" value={rate} onChange={setRate} min={1} max={30} step={0.5} suffix="%" />
          <Field label="Investment period" value={years} onChange={setYears} min={1} max={40} step={1} suffix="yrs" />
        </>
      }
      donut={<SplitDonut invested={amount} gains={gains} />}
      results={
        <>
          <ResultCard label="Invested amount" value={formatINR(amount)} />
          <ResultCard label="Est. returns" value={formatINR(gains)} />
          <ResultCard label="Total value" value={formatINR(fv)} emphasis />
        </>
      }
      note={`A one-time ${formatINR(amount)} at ${rate}% p.a. for ${years} years grows to about ${formatCompactINR(fv)}.`}
    />
  );
}

function RetirementCalculator() {
  const [currentAge, setCurrentAge] = useState(30);
  const [retireAge, setRetireAge] = useState(60);
  const [monthlyExpense, setMonthlyExpense] = useState(50000);
  const [inflation, setInflation] = useState(6);
  const [preReturn, setPreReturn] = useState(12);

  const { corpus, monthlySip, years, futureExpense } = useMemo(() => {
    const years = Math.max(0, retireAge - currentAge);
    // Grow today's monthly expense to retirement by inflation, then size a corpus
    // that sustains 25 years of that (the "25x annual expense" rule of thumb).
    const futureExpense = monthlyExpense * Math.pow(1 + inflation / 100, years);
    const corpus = futureExpense * 12 * 25;
    const monthlySip = sipRequired(corpus, preReturn, years);
    return { corpus, monthlySip, years, futureExpense };
  }, [currentAge, retireAge, monthlyExpense, inflation, preReturn]);

  return (
    <CalcLayout
      inputs={
        <>
          <Field label="Current age" value={currentAge} onChange={setCurrentAge} min={18} max={59} step={1} suffix="yrs" />
          <Field label="Retirement age" value={retireAge} onChange={setRetireAge} min={Math.max(currentAge + 1, 40)} max={75} step={1} suffix="yrs" />
          <Field label="Current monthly expense" value={monthlyExpense} onChange={setMonthlyExpense} min={5000} max={1000000} step={1000} prefix="₹" />
          <Field label="Inflation (p.a.)" value={inflation} onChange={setInflation} min={1} max={12} step={0.5} suffix="%" />
          <Field label="Expected return (p.a.)" value={preReturn} onChange={setPreReturn} min={1} max={20} step={0.5} suffix="%" />
        </>
      }
      results={
        <>
          <ResultCard label="Years to retirement" value={`${years} yrs`} />
          <ResultCard label="Monthly expense at retirement" value={formatINR(futureExpense)} />
          <ResultCard label="Corpus required" value={formatCompactINR(corpus)} />
          <ResultCard label="Monthly SIP needed" value={formatINR(monthlySip)} emphasis />
        </>
      }
      note={`To retire at ${retireAge}, aim for a corpus of about ${formatCompactINR(corpus)} — roughly ${formatINR(monthlySip)}/month invested at ${preReturn}% p.a.`}
    />
  );
}

function GoalCalculator() {
  const [goal, setGoal] = useState(2500000);
  const [rate, setRate] = useState(12);
  const [years, setYears] = useState(8);

  const { monthlySip, invested, gains } = useMemo(() => {
    const monthlySip = sipRequired(goal, rate, years);
    const invested = monthlySip * years * 12;
    return { monthlySip, invested, gains: goal - invested };
  }, [goal, rate, years]);

  return (
    <CalcLayout
      inputs={
        <>
          <Field label="Target amount" value={goal} onChange={setGoal} min={50000} max={50000000} step={50000} prefix="₹" />
          <Field label="Expected return (p.a.)" value={rate} onChange={setRate} min={1} max={30} step={0.5} suffix="%" />
          <Field label="Time to goal" value={years} onChange={setYears} min={1} max={40} step={1} suffix="yrs" />
        </>
      }
      donut={<SplitDonut invested={invested} gains={gains} />}
      results={
        <>
          <ResultCard label="Monthly SIP needed" value={formatINR(monthlySip)} emphasis />
          <ResultCard label="You invest" value={formatINR(invested)} />
          <ResultCard label="Growth adds" value={formatINR(gains)} />
        </>
      }
      note={`Reaching ${formatCompactINR(goal)} in ${years} years needs about ${formatINR(monthlySip)}/month at ${rate}% p.a.`}
    />
  );
}

/** Shared two-column layout: inputs on the left, results (+optional donut) right. */
function CalcLayout({
  inputs,
  results,
  donut,
  note,
}: {
  inputs: ReactNode;
  results: ReactNode;
  donut?: ReactNode;
  note?: string;
}) {
  return (
    <div className="grid lg:grid-cols-2 gap-6 lg:gap-10">
      <div className="space-y-6">{inputs}</div>
      <div className="space-y-5">
        {donut && <div className="flex items-center justify-center">{donut}</div>}
        <div className="grid sm:grid-cols-2 gap-3">{results}</div>
        {note && (
          <p className="text-sm text-text-secondary leading-relaxed rounded-xl p-4" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border-subtle)' }}>
            {note}
          </p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

const TABS: { id: CalculatorId; label: string; icon: ElementType; blurb: string }[] = [
  { id: 'sip', label: 'SIP', icon: TrendingUp, blurb: 'Grow wealth with monthly investments' },
  { id: 'lumpsum', label: 'Lumpsum', icon: PiggyBank, blurb: 'Project a one-time investment' },
  { id: 'retirement', label: 'Retirement', icon: Landmark, blurb: 'Plan your retirement corpus' },
  { id: 'goal', label: 'Goal SIP', icon: Target, blurb: 'Find the SIP for any goal' },
];

interface CalculatorProps {
  onBack: () => void;
}

export default function CalculatorPage({ onBack }: CalculatorProps) {
  const [active, setActive] = useState<CalculatorId>('sip');
  const activeTab = TABS.find((t) => t.id === active)!;

  return (
    <PublicPageChrome
      onBack={onBack}
      eyebrow="Financial Calculators"
      icon={CalcIcon}
      title="Plan every rupee with confidence"
      subtitle="Interactive, research-grade calculators to model your SIPs, lumpsum investments, retirement corpus and financial goals."
      documentTitle="Financial Calculators — Niyom Wealth"
    >
      {/* Tabs */}
      <div className="flex flex-wrap gap-2 sm:gap-3 mb-8" role="tablist" aria-label="Calculator type">
        {TABS.map((tab) => {
          const selected = tab.id === active;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={selected}
              onClick={() => setActive(tab.id)}
              className="press flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-sm transition-colors"
              style={
                selected
                  ? { background: 'rgb(var(--accent-soft-rgb))', color: 'var(--text-on-accent)' }
                  : { background: 'var(--bg-elevated)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }
              }
            >
              <Icon size={16} /> {tab.label}
            </button>
          );
        })}
      </div>

      {/* Active calculator card */}
      <div className="rounded-2xl p-6 sm:p-8" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}>
        <div className="flex items-center gap-3 mb-6">
          <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl" style={{ background: 'rgba(var(--accent-soft-rgb),0.12)', border: '1px solid rgba(var(--accent-soft-rgb),0.30)' }}>
            <activeTab.icon className="w-5 h-5 text-accent-soft" />
          </span>
          <div>
            <h2 className="text-lg font-bold text-text-primary" style={{ fontFamily: 'var(--font-display)' }}>{activeTab.label} Calculator</h2>
            <p className="text-sm text-text-muted">{activeTab.blurb}</p>
          </div>
        </div>

        {active === 'sip' && <SipCalculator />}
        {active === 'lumpsum' && <LumpsumCalculator />}
        {active === 'retirement' && <RetirementCalculator />}
        {active === 'goal' && <GoalCalculator />}
      </div>

      <p className="mt-6 text-xs text-text-faint leading-relaxed max-w-3xl">
        These calculators are for illustration only and assume a constant annual rate of return.
        Actual mutual fund and market returns vary and are not guaranteed. Figures do not account for
        taxes, exit loads or expense ratios. Please consult a qualified advisor before investing.
      </p>
    </PublicPageChrome>
  );
}
