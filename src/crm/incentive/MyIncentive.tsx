/**
 * My Incentive — every employee's own tracker.
 *
 * For an open month it is LIVE: revenue from the MIS engine, product business
 * from their transactions, plus any figures admin has entered on their draft
 * (SIP, insurance, overrides). Once admin approves a month the frozen amount
 * is shown instead, because that is what payroll pays.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Award, Wallet, TrendingUp, Gauge, RefreshCw } from 'lucide-react';
import type { NWEmployee } from '../types';
import {
  computeIncentive, nextGoals, mergeVolumes, payrollMonthFor, periodKey,
  type IncentiveResult,
} from '../../../shared/incentive/incentiveEngine';
import {
  loadMyMonth, loadMyStatements, loadPlanVersions, planForMonth, inr, fmtX, monthLabel, MONTHS,
  type IncentiveStatement, type MonthInputs, type PlanVersion,
} from './incentiveData';
import { BandLadder, Breakdown, GoalCards, ProductChecklist, SlabTable } from './IncentiveParts';
import { SectionCard, StatTile, Notice, Skeleton, Pill, Select, TableWrap } from '../hr/hrUi';
import { hrError } from '../hr/hrError';
import IncentiveCalculator, { type CalculatorPreset } from './IncentiveCalculator';

export default function MyIncentive({ employee }: { employee: NWEmployee }) {
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month0, setMonth0] = useState(today.getMonth());
  const [versions, setVersions] = useState<PlanVersion[]>([]);
  const [statements, setStatements] = useState<IncentiveStatement[]>([]);
  const [inputs, setInputs] = useState<MonthInputs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const period = periodKey(year, month0);
  const pay = payrollMonthFor(period);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [v, s, m] = await Promise.all([
        loadPlanVersions(), loadMyStatements(employee.id), loadMyMonth(employee.id, year, month0),
      ]);
      setVersions(v); setStatements(s); setInputs(m);
    } catch (e) {
      setError(hrError(e, 'Could not load your incentive.'));
    } finally {
      setLoading(false);
    }
  }, [employee.id, year, month0]);

  useEffect(() => { load(); }, [load]);

  const statement = statements.find(s => s.period_month === period) ?? null;
  const approved = statement?.status === 'approved';
  const plan = useMemo(() => {
    if (approved && statement?.plan_version_id) {
      const pinned = versions.find(v => v.id === statement.plan_version_id);
      if (pinned) return pinned;
    }
    return planForMonth(versions, period);
  }, [versions, statement, period, approved]);

  // Approved months show the frozen snapshot; open months are recomputed live.
  const view = useMemo(() => {
    if (!plan || !inputs) return null;
    const manual = statement?.volumes_manual ?? {};
    const salary = approved ? statement!.salary : inputs.salary;
    const revenue = approved
      ? (statement!.revenue_override ?? statement!.revenue_auto)
      : (statement?.revenue_override ?? inputs.revenue);
    const volumes = approved
      ? mergeVolumes(statement!.volumes_auto, manual)
      : mergeVolumes(inputs.volumesAuto, manual);
    const engineInput = { config: plan.config, salary, revenue, volumes };
    const result: IncentiveResult = computeIncentive(engineInput);
    const goals = nextGoals(engineInput, result);
    const payable = approved ? statement!.final_amount
      : (statement?.amount_override ?? result.final);
    return { result, goals, payable, manualKeys: new Set(Object.keys(manual)) };
  }, [plan, inputs, statement, approved]);

  // The calculator starts from this month's real figures; memoised so typing
  // in it is not reset on every render.
  const preset = useMemo<CalculatorPreset | null>(() => view ? {
    salary: view.result.salary,
    revenue: view.result.revenue,
    volumes: Object.fromEntries(view.result.minChecks.map(c => [c.key, c.actual])),
  } : null, [view]);

  const years = Array.from({ length: 3 }, (_, i) => today.getFullYear() - i);
  const isCurrentMonth = year === today.getFullYear() && month0 === today.getMonth();

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>My Incentive</h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Incentive on {monthLabel(period)} revenue is paid with your {MONTHS[pay.month0]} {pay.year} salary.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={month0} onChange={e => setMonth0(Number(e.target.value))} style={{ width: 140 }}>
            {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
          </Select>
          <Select value={year} onChange={e => setYear(Number(e.target.value))} style={{ width: 100 }}>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </Select>
          <button onClick={load} className="p-2.5 rounded-xl" title="Refresh"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <Notice tone="bad" title="Could not load">{error}</Notice>}
      {loading && !view && <Skeleton rows={6} height={60} />}
      {!loading && !plan && !error && <Notice tone="warn">No incentive structure is in force for {monthLabel(period)}.</Notice>}

      {view && plan && (
        <>
          {!view.result.hasSalary && (
            <Notice tone="warn" title="Salary not available">
              Your salary structure for {monthLabel(period)} is not visible here, so the revenue multiple cannot be worked out. Please contact HR.
            </Notice>
          )}
          <Notice tone={approved ? 'good' : 'info'}>
            {approved
              ? <>Approved{statement?.payroll_adjustment_id ? ' and added to payroll' : ''}. This is the amount that will be paid.</>
              : <>{isCurrentMonth ? 'Live and provisional — ' : 'Provisional — '}it updates as deals settle and is final only after admin approval.</>}
          </Notice>

          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <StatTile label="Revenue" value={inr(view.result.revenue)} icon={TrendingUp}
              sub={statement?.revenue_override != null ? 'Adjusted by admin' : 'From MIS'} />
            <StatTile label="Revenue multiple" value={fmtX(view.result.x)} icon={Gauge} tone="accent"
              sub={`Band ${view.result.band.label}`} />
            <StatTile label="Eligible products" value={`${view.result.productsMet} / ${view.result.productsRequired}`} icon={Award}
              tone={view.result.productsMet >= view.result.productsRequired ? 'good' : 'warn'} sub="at minimum threshold" />
            <StatTile label={approved ? 'Approved incentive' : 'Eligible incentive'} value={inr(view.payable)} icon={Wallet}
              tone={view.payable > 0 ? 'good' : 'neutral'}
              sub={statement?.amount_override != null ? 'Set by admin' : view.result.eligible ? 'Provisional' : 'Not eligible yet'} />
          </div>

          <SectionCard title="Where you are" subtitle={`X = revenue ÷ monthly gross salary (${inr(view.result.salary)})`}>
            <BandLadder config={plan.config} result={view.result} />
          </SectionCard>

          {!approved && (
            <div>
              <h2 className="text-sm font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Your next goals</h2>
              <GoalCards goals={view.goals} result={view.result} />
            </div>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <SectionCard title="How it adds up">
              <Breakdown result={view.result} />
              {statement?.amount_override != null && (
                <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
                  Admin set the payable amount to {inr(statement.amount_override)}{statement.override_reason ? ` — ${statement.override_reason}` : ''}.
                </p>
              )}
            </SectionCard>
            <SectionCard title="Product qualification" subtitle="SIP is entered by admin; other products come from your transactions.">
              <ProductChecklist result={view.result} manualKeys={view.manualKeys} />
            </SectionCard>
          </div>

          <SectionCard title="History" padded>
            {statements.length === 0
              ? <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No months reviewed yet.</p>
              : (
                <TableWrap>
                  <thead><tr><th className="text-left">Revenue month</th><th className="text-right">Revenue</th><th className="text-right">Incentive</th><th className="text-left">Status</th></tr></thead>
                  <tbody>
                    {statements.map(s => (
                      <tr key={s.id}>
                        <td>{monthLabel(s.period_month)}</td>
                        <td className="text-right tabular-nums">{inr(s.revenue_override ?? s.revenue_auto)}</td>
                        <td className="text-right tabular-nums">{inr(s.final_amount)}</td>
                        <td><Pill small value={s.payroll_adjustment_id ? 'in_payroll' : s.status === 'approved' ? 'approved' : 'pending'} /></td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              )}
          </SectionCard>

          <IncentiveCalculator config={plan.config} preset={preset}
            title="What-if calculator" presetLabel={`Reset to ${monthLabel(period)} actuals`} />

          <SectionCard title="Incentive structure" subtitle={`In force from ${monthLabel(plan.effective_from)} — ${plan.note}`}>
            <SlabTable config={plan.config} />
            {plan.config.policy_notes.length > 0 && (
              <ul className="mt-4 space-y-1 text-xs list-disc pl-5" style={{ color: 'var(--text-muted)' }}>
                {plan.config.policy_notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
