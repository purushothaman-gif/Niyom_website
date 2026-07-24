import { useEffect, useState, type ElementType } from 'react';
import {
  GraduationCap, ChevronDown, TrendingUp, Landmark, PiggyBank, Shield, Building2,
  Sparkles, Coins, Repeat, Scale, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import { PublicPageChrome } from './shared/PublicPageChrome';
import { commoditySource, type Commodity, type CommoditySnapshot } from './shared/commoditySource';

/**
 * Public education centre. Static, curated learning content plus a live
 * gold/silver price widget sourced through `commoditySource`. No personalized
 * advice — educational framing only.
 */

// ---------------------------------------------------------------------------
// Key concepts (quick cards)
// ---------------------------------------------------------------------------

const CONCEPTS: { icon: ElementType; title: string; body: string }[] = [
  { icon: Repeat, title: 'Power of Compounding', body: 'Returns earn their own returns over time. Starting early and staying invested is what turns modest, regular contributions into meaningful wealth.' },
  { icon: Coins, title: 'Rupee-Cost Averaging', body: 'Investing a fixed amount regularly (a SIP) buys more units when prices are low and fewer when high — smoothing out market timing risk.' },
  { icon: Scale, title: 'Risk & Return', body: 'Higher potential returns come with higher volatility. Matching investments to your goals and time horizon is more important than chasing the top performer.' },
  { icon: Sparkles, title: 'Diversification', body: 'Spreading money across asset classes and funds reduces the impact of any single investment underperforming. Don’t put all your eggs in one basket.' },
];

// ---------------------------------------------------------------------------
// Learning modules (accordion)
// ---------------------------------------------------------------------------

interface Module {
  icon: ElementType;
  title: string;
  summary: string;
  points: string[];
}

const MODULES: Module[] = [
  {
    icon: TrendingUp,
    title: 'Mutual Funds',
    summary: 'Pooled, professionally managed portfolios across equity, debt and hybrid.',
    points: [
      'Equity funds invest in stocks and suit long-term goals with higher risk appetite.',
      'Debt funds invest in bonds and are generally steadier, suited to shorter horizons.',
      'Hybrid funds blend both to balance growth and stability.',
      'Start with as little as ₹500/month via a SIP; look at expense ratio and long-term track record, not just last year’s return.',
    ],
  },
  {
    icon: Landmark,
    title: 'Bonds',
    summary: 'Fixed-income instruments that pay periodic interest and return principal at maturity.',
    points: [
      'Government and AAA-rated corporate bonds carry lower credit risk.',
      'Yields move inversely to interest rates — bond prices fall when rates rise.',
      'Useful for predictable income and capital preservation within a diversified portfolio.',
    ],
  },
  {
    icon: PiggyBank,
    title: 'Fixed Deposits',
    summary: 'Capital-protected deposits with a guaranteed rate for a fixed tenure.',
    points: [
      'Returns are fixed and known upfront, independent of market movements.',
      'Interest is taxable as per your income slab; premature withdrawal may attract a penalty.',
      'Best for emergency funds and goals where certainty matters more than growth.',
    ],
  },
  {
    icon: Shield,
    title: 'Insurance',
    summary: 'Protection first — insurance covers risk, it is not primarily an investment.',
    points: [
      'Term life plans give the highest cover for the lowest premium.',
      'Health insurance shields your savings from medical emergencies.',
      'Keep protection and investment separate for clarity and better value.',
    ],
  },
  {
    icon: Building2,
    title: 'Unlisted Shares',
    summary: 'Equity in companies not yet listed on a stock exchange.',
    points: [
      'Potential for high growth ahead of an IPO, with correspondingly higher risk.',
      'Lower liquidity — exits can take time and pricing is less transparent.',
      'Suited to informed investors who can hold for the long term.',
    ],
  },
];

function AccordionItem({ module, open, onToggle }: { module: Module; open: boolean; onToggle: () => void }) {
  const Icon = module.icon;
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)' }}>
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-4 text-left px-5 sm:px-6 py-5 hover:bg-hover transition-colors"
      >
        <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0" style={{ background: 'rgba(var(--accent-soft-rgb),0.12)', border: '1px solid rgba(var(--accent-soft-rgb),0.30)' }}>
          <Icon className="w-5 h-5 text-accent-soft" />
        </span>
        <span className="flex-1 min-w-0">
          <span className="block font-bold text-text-primary" style={{ fontFamily: 'var(--font-display)' }}>{module.title}</span>
          <span className="block text-sm text-text-muted mt-0.5">{module.summary}</span>
        </span>
        <ChevronDown size={20} className={`text-text-muted flex-shrink-0 transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="px-5 sm:px-6 pb-6 pt-1">
          <ul className="space-y-2.5">
            {module.points.map((p, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-text-secondary leading-relaxed">
                <span className="mt-1.5 w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'rgb(var(--accent-soft-rgb))' }} />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Commodity widget
// ---------------------------------------------------------------------------

function Sparkline({ series }: { series: number[] }) {
  if (series.length < 2) return null;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const w = 120;
  const h = 36;
  const pts = series
    .map((v, i) => `${(i / (series.length - 1)) * w},${h - ((v - min) / span) * h}`)
    .join(' ');
  const up = series[series.length - 1] >= series[0];
  const color = up ? 'rgb(var(--success-soft-rgb))' : 'rgb(var(--danger-soft-rgb))';
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-9" preserveAspectRatio="none" aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CommodityCard({ label, unit, snapshot }: { label: string; unit: string; snapshot: CommoditySnapshot | null }) {
  const inr = (n: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n);
  const price = snapshot?.latest?.price;
  const up = (snapshot?.change ?? 0) >= 0;
  return (
    <div className="rounded-2xl p-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Coins className="w-4 h-4 text-accent-soft" />
          <span className="font-semibold text-text-primary">{label}</span>
        </div>
        <span className="text-xs text-text-muted">{unit}</span>
      </div>
      {price != null ? (
        <>
          <div className="text-2xl font-bold text-text-primary mb-1" style={{ fontFamily: 'var(--font-display)' }}>{inr(price)}</div>
          <div className="flex items-center gap-1 text-sm font-medium mb-3" style={{ color: up ? 'rgb(var(--success-soft-rgb))' : 'rgb(var(--danger-soft-rgb))' }}>
            {up ? <ArrowUpRight size={15} /> : <ArrowDownRight size={15} />}
            {inr(Math.abs(snapshot!.change))} ({Math.abs(snapshot!.changePct).toFixed(2)}%)
          </div>
          <Sparkline series={snapshot!.series.map((s) => s.price)} />
        </>
      ) : (
        <div className="text-sm text-text-muted py-4">Price data unavailable.</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

interface LearningProps {
  onBack: () => void;
}

export function Learning({ onBack }: LearningProps) {
  const [openIdx, setOpenIdx] = useState<number>(0);
  const [snapshots, setSnapshots] = useState<Record<Commodity, CommoditySnapshot | null>>({ gold: null, silver: null });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [gold, silver] = await Promise.all([
          commoditySource.snapshot('gold'),
          commoditySource.snapshot('silver'),
        ]);
        if (!cancelled) setSnapshots({ gold, silver });
      } catch {
        // Non-critical widget — leave as unavailable on failure.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <PublicPageChrome
      onBack={onBack}
      eyebrow="Learning Centre"
      icon={GraduationCap}
      title="Invest with knowledge, not guesswork"
      subtitle="Clear, jargon-free explainers on how mutual funds, bonds, deposits, insurance and more actually work."
      documentTitle="Learning Centre — Niyom Wealth"
    >
      {/* Key concepts */}
      <h2 className="text-xl font-bold text-text-primary mb-4" style={{ fontFamily: 'var(--font-display)' }}>Core concepts</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-14">
        {CONCEPTS.map((c) => {
          const Icon = c.icon;
          return (
            <div key={c.title} className="lift rounded-2xl p-5 h-full" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}>
              <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl mb-3" style={{ background: 'rgba(var(--accent-soft-rgb),0.12)', border: '1px solid rgba(var(--accent-soft-rgb),0.30)' }}>
                <Icon className="w-5 h-5 text-accent-soft" />
              </span>
              <h3 className="font-bold text-text-primary mb-2" style={{ fontFamily: 'var(--font-display)' }}>{c.title}</h3>
              <p className="text-sm text-text-secondary leading-relaxed">{c.body}</p>
            </div>
          );
        })}
      </div>

      {/* Learning modules */}
      <div className="grid lg:grid-cols-3 gap-8 mb-14">
        <div className="lg:col-span-2">
          <h2 className="text-xl font-bold text-text-primary mb-4" style={{ fontFamily: 'var(--font-display)' }}>Product guides</h2>
          <div className="space-y-3">
            {MODULES.map((m, i) => (
              <AccordionItem key={m.title} module={m} open={openIdx === i} onToggle={() => setOpenIdx(openIdx === i ? -1 : i)} />
            ))}
          </div>
        </div>

        {/* Commodity watch */}
        <div>
          <h2 className="text-xl font-bold text-text-primary mb-4" style={{ fontFamily: 'var(--font-display)' }}>Commodity watch</h2>
          <div className="space-y-4">
            <CommodityCard label="Gold" unit="per 10g" snapshot={snapshots.gold} />
            <CommodityCard label="Silver" unit="per kg" snapshot={snapshots.silver} />
            <p className="text-xs text-text-faint leading-relaxed">Indicative MCX-aligned prices for educational reference. Not a quote or an offer to transact.</p>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="rounded-2xl p-8 text-center" style={{ background: 'linear-gradient(150deg, #071524 0%, #0b2244 55%, #10284D 100%)' }} data-theme="dark">
        <h2 className="text-2xl font-bold text-white mb-3" style={{ fontFamily: 'var(--font-display)' }}>Ready to put it into practice?</h2>
        <p className="text-gray-300 mb-6 max-w-xl mx-auto">Explore our investment solutions or talk to our team to build a plan around your goals.</p>
        <button
          onClick={() => window.open('/client-login', '_blank')}
          className="lift press bg-accent-soft hover:bg-accent-soft-deep text-black font-bold px-8 py-3.5 rounded-xl shadow-lg"
        >
          Start Investing
        </button>
      </div>
    </PublicPageChrome>
  );
}

export default Learning;
