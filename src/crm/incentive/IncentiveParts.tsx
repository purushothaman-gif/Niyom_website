/**
 * Presentational pieces shared by My Incentive and Incentive Admin.
 * They only render an engine result; none of them calculates anything.
 */
import type { ElementType, ReactNode } from 'react';
import { CheckCircle2, Circle, Target, TrendingUp, Package, Sparkles, Unlock } from 'lucide-react';
import type {
  IncentiveConfig, IncentiveGoals, IncentiveResult, ProductCheck,
} from '../../../shared/incentive/incentiveEngine';
import { inr } from './incentiveData';

const pct = (f: number) => `${+(f * 100).toFixed(2)}%`;

/* ------------------------------------------------------------ band ladder */

export function BandLadder({ config, result }: { config: IncentiveConfig; result: IncentiveResult }) {
  const bands = config.bands;
  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="flex gap-1.5 min-w-max">
        {bands.map((b, i) => {
          const on = i === result.bandIndex;
          const done = i < result.bandIndex;
          return (
            <div key={b.lower_x} className="rounded-xl px-3 py-2 text-center" title={b.note}
              style={{
                minWidth: 84,
                background: on ? 'rgba(var(--accent-soft-rgb),0.16)' : done ? 'rgba(16,185,129,0.08)' : 'var(--bg-base)',
                border: `1px solid ${on ? 'rgba(var(--accent-soft-rgb),0.45)' : 'var(--border)'}`,
              }}>
              <p className="text-[11px] font-bold" style={{ color: on ? 'var(--accent-soft)' : done ? 'rgb(16,185,129)' : 'var(--text-muted)' }}>
                {b.label}
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-faint)' }}>
                {b.base_mult ? `${pct(b.base_mult)} sal` : '—'}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- breakdown */

export function Breakdown({ result }: { result: IncentiveResult }) {
  const row = (label: string, value: number, hint: string, muted = false) => (
    <div className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
      <div>
        <p className="text-sm" style={{ color: muted ? 'var(--text-faint)' : 'var(--text-secondary)' }}>{label}</p>
        <p className="text-[11px]" style={{ color: 'var(--text-faint)' }}>{hint}</p>
      </div>
      <p className="text-sm font-semibold tabular-nums" style={{ color: muted ? 'var(--text-faint)' : 'var(--text-primary)' }}>{inr(value)}</p>
    </div>
  );
  return (
    <div>
      {row('Base incentive', result.base, `${pct(result.band.base_mult)} of salary`)}
      {row('Revenue add-on', result.addon,
        result.addonActive ? `${pct(result.band.addon_pct)} of revenue` : 'Unlocks above the add-on threshold', !result.addonActive)}
      {row('Over-achievement bonus', result.oaBonus,
        result.oaQualified ? `${pct(result.band.oa_pct)} of revenue` : `Needs ${result.oaRequired} products at OA level (${result.oaMet} now)`, !result.oaQualified)}
      <div className="flex items-center justify-between py-2" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Cap (share of revenue)</p>
        <p className="text-sm tabular-nums" style={{ color: result.capped ? 'rgb(245,158,11)' : 'var(--text-faint)' }}>
          {inr(result.cap)}{result.capped ? ' — applied' : ''}
        </p>
      </div>
      <div className="flex items-center justify-between pt-3">
        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>Eligible incentive</p>
        <p className="text-lg font-bold tabular-nums" style={{ color: result.eligible ? 'rgb(16,185,129)' : 'var(--text-faint)' }}>
          {inr(result.final)}
        </p>
      </div>
      {!result.eligible && result.ineligibleReasons.length > 0 && (
        <p className="text-xs mt-1" style={{ color: 'rgb(239,68,68)' }}>Not eligible: {result.ineligibleReasons.join('; ')}.</p>
      )}
    </div>
  );
}

/* ----------------------------------------------------- product checklist */

export function ProductChecklist({ result, manualKeys }: { result: IncentiveResult; manualKeys?: Set<string> }) {
  const tick = (c: ProductCheck) => c.met
    ? <CheckCircle2 className="w-4 h-4 inline" style={{ color: 'rgb(16,185,129)' }} />
    : <Circle className="w-4 h-4 inline" style={{ color: 'var(--text-faint)' }} />;
  return (
    <div className="overflow-x-auto">
      <table className="nw-table w-full text-sm" style={{ minWidth: 520 }}>
        <thead>
          <tr>
            <th className="text-left">Product</th>
            <th className="text-right">This month</th>
            <th className="text-right">Minimum</th>
            <th className="text-center">✓</th>
            <th className="text-right">Over-achievement</th>
            <th className="text-center">✓</th>
          </tr>
        </thead>
        <tbody>
          {result.minChecks.map((c, i) => {
            const oa = result.oaChecks[i];
            return (
              <tr key={c.key}>
                <td>
                  <span style={{ color: 'var(--text-primary)' }}>{c.label}</span>
                  <span className="text-[11px] ml-1.5" style={{ color: 'var(--text-faint)' }}>
                    {c.unit}{manualKeys?.has(c.key) ? ' · entered by admin' : ''}
                  </span>
                </td>
                <td className="text-right tabular-nums">{inr(c.actual)}</td>
                <td className="text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {inr(c.threshold)}
                  {!c.met && <span className="block text-[11px]" style={{ color: 'rgb(245,158,11)' }}>{inr(c.shortfall)} to go</span>}
                </td>
                <td className="text-center">{tick(c)}</td>
                <td className="text-right tabular-nums" style={{ color: 'var(--text-muted)' }}>
                  {inr(oa.threshold)}
                  {!oa.met && <span className="block text-[11px]" style={{ color: 'var(--text-faint)' }}>{inr(oa.shortfall)} to go</span>}
                </td>
                <td className="text-center">{tick(oa)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
        {result.productsRequired === 0 && result.minChecks.length > 0
          ? 'Minimum: not required this month (multi-product requirement off)'
          : `Minimum: ${result.productsMet} of ${result.productsRequired} required`}
        {' · '}Over-achievement: {result.oaMet} of {result.oaRequired} required
      </p>
    </div>
  );
}

/* ---------------------------------------------------------------- goals */

function GoalCard({ icon: Icon, title, children, tone = '99,102,241' }: {
  icon: ElementType; title: string; children: ReactNode; tone?: string;
}) {
  return (
    <div className="rounded-2xl p-4" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center gap-2 mb-2">
        <span className="w-7 h-7 rounded-lg flex items-center justify-center"
          style={{ background: `rgba(${tone},0.12)`, color: `rgb(${tone})` }}>
          <Icon className="w-3.5 h-3.5" />
        </span>
        <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>{title}</p>
      </div>
      <div className="text-sm space-y-1" style={{ color: 'var(--text-secondary)' }}>{children}</div>
    </div>
  );
}

export function GoalCards({ goals, result }: { goals: IncentiveGoals; result: IncentiveResult }) {
  const cards: ReactNode[] = [];
  if (goals.minRevenue) {
    cards.push(
      <GoalCard key="min" icon={Target} title={goals.minRevenue.label} tone="239,68,68">
        <p>Do <b>{inr(goals.minRevenue.gap)}</b> more revenue (target {inr(goals.minRevenue.targetRevenue)}).</p>
      </GoalCard>,
    );
  }
  if (goals.eligibility) {
    cards.push(
      <GoalCard key="elig" icon={Package} title={`Qualify ${goals.eligibility.needed} more product${goals.eligibility.needed > 1 ? 's' : ''}`} tone="245,158,11">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Incentive is paid only when enough products hit their minimum. Closest:</p>
        {goals.eligibility.suggestions.map(s => (
          <p key={s.key}>{s.label}: <b>{inr(s.shortfall)}</b> more</p>
        ))}
      </GoalCard>,
    );
  }
  if (goals.nextBand) {
    const gain = goals.nextBand.projectedIncentive - result.final;
    cards.push(
      <GoalCard key="band" icon={TrendingUp} title={`Next band: ${goals.nextBand.band.label}`} tone="16,185,129">
        <p>Do <b>{inr(goals.nextBand.gap)}</b> more revenue (target {inr(goals.nextBand.targetRevenue)}).</p>
        <p>Incentive there: <b>{inr(goals.nextBand.projectedIncentive)}</b>
          {gain > 0 && <span style={{ color: 'rgb(16,185,129)' }}> (+{inr(gain)})</span>}
        </p>
        {goals.nextBand.projectedIncentive === 0 && goals.eligibility && (
          <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Also needs the product minimums above.</p>
        )}
      </GoalCard>,
    );
  } else if (result.hasSalary) {
    cards.push(
      <GoalCard key="top" icon={Sparkles} title="Top band reached" tone="139,92,246">
        <p>You are in the highest band. Payout is limited by the revenue cap.</p>
      </GoalCard>,
    );
  }
  if (goals.addonUnlock && (!goals.nextBand || goals.addonUnlock.targetRevenue !== goals.nextBand.targetRevenue)) {
    cards.push(
      <GoalCard key="addon" icon={Unlock} title="Unlock the revenue add-on" tone="59,130,246">
        <p>Revenue above <b>{inr(goals.addonUnlock.targetRevenue - 1)}</b> adds a % of all revenue on top.</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{inr(goals.addonUnlock.gap)} to go · incentive there {inr(goals.addonUnlock.projectedIncentive)}</p>
      </GoalCard>,
    );
  }
  if (goals.overAchievement) {
    cards.push(
      <GoalCard key="oa" icon={Sparkles} title="Over-achievement bonus" tone="139,92,246">
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {goals.overAchievement.needed} more product{goals.overAchievement.needed > 1 ? 's' : ''} at OA level
          {goals.overAchievement.bonusPctAtBand > 0 ? ` adds ${pct(goals.overAchievement.bonusPctAtBand)} of revenue.` : ' (paid from higher bands).'}
        </p>
        {goals.overAchievement.suggestions.map(s => (
          <p key={s.key}>{s.label}: <b>{inr(s.shortfall)}</b> more</p>
        ))}
      </GoalCard>,
    );
  }
  if (cards.length === 0) return null;
  return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{cards}</div>;
}

/* ------------------------------------------------------------ slab table */

export function SlabTable({ config }: { config: IncentiveConfig }) {
  return (
    <div className="overflow-x-auto">
      <table className="nw-table w-full text-sm" style={{ minWidth: 520 }}>
        <thead>
          <tr>
            <th className="text-left">Band</th>
            <th className="text-right">Base (% of salary)</th>
            <th className="text-right">Add-on (% of revenue)</th>
            <th className="text-right">OA bonus (% of revenue)</th>
            <th className="text-left">Note</th>
          </tr>
        </thead>
        <tbody>
          {config.bands.map(b => (
            <tr key={b.lower_x}>
              <td style={{ color: 'var(--text-primary)' }}>{b.label}</td>
              <td className="text-right tabular-nums">{pct(b.base_mult)}</td>
              <td className="text-right tabular-nums">{pct(b.addon_pct)}</td>
              <td className="text-right tabular-nums">{pct(b.oa_pct)}</td>
              <td style={{ color: 'var(--text-muted)' }}>{b.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs mt-2" style={{ color: 'var(--text-muted)' }}>
        X = revenue ÷ monthly gross salary. Eligible from {config.rules.min_x}x with {config.rules.products_required_below_switch} products at minimum
        ({config.rules.products_required_at_or_above_switch} from {config.rules.product_switch_x}x). Add-on paid above {config.rules.addon_min_x}x.
        OA bonus needs {config.rules.oa_products_required} products at OA level. Capped at {pct(config.rules.cap_pct_revenue)} of revenue.
      </p>
    </div>
  );
}
