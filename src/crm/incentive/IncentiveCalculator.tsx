/**
 * What-if calculator: type in salary, revenue and product figures, see the
 * incentive they would earn. Runs the same engine as the live tracker, so a
 * prediction here is exactly what the month would pay on those numbers.
 * Nothing is saved.
 */
import { useEffect, useMemo, useState } from 'react';
import { Calculator, RotateCcw } from 'lucide-react';
import {
  computeIncentive, nextGoals, type IncentiveConfig, type ProductVolumes,
} from '../../../shared/incentive/incentiveEngine';
import { inr, fmtX } from './incentiveData';
import { Breakdown, GoalCards, ProductChecklist } from './IncentiveParts';
import { SectionCard, Field, Input, GhostButton, StatTile } from '../hr/hrUi';

export interface CalculatorPreset {
  salary: number;
  revenue: number;
  volumes: ProductVolumes;
}

const toText = (n: number | undefined) => (n ? String(Math.round(n)) : '');
const toNum = (s: string) => {
  const n = Number(s.replace(/[,₹\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

export default function IncentiveCalculator({ config, preset, presetLabel, title = 'Incentive calculator' }: {
  config: IncentiveConfig;
  /** Starting figures (e.g. the employee's actual month); blank when absent. */
  preset?: CalculatorPreset | null;
  presetLabel?: string;
  title?: string;
}) {
  const fromPreset = (p?: CalculatorPreset | null) => ({
    salary: toText(p?.salary),
    revenue: toText(p?.revenue),
    volumes: Object.fromEntries(config.products.map(pr => [pr.key, toText(p?.volumes[pr.key])])) as Record<string, string>,
  });
  const [form, setForm] = useState(() => fromPreset(preset));
  // Re-seed when the preset arrives or changes (month switch, data load).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setForm(fromPreset(preset)); }, [preset]);

  const calc = useMemo(() => {
    const volumes: ProductVolumes = {};
    for (const [k, v] of Object.entries(form.volumes)) volumes[k] = toNum(v);
    const input = { config, salary: toNum(form.salary), revenue: toNum(form.revenue), volumes };
    const result = computeIncentive(input);
    return { result, goals: nextGoals(input, result) };
  }, [form, config]);

  const { result, goals } = calc;
  const setVol = (k: string, v: string) => setForm(f => ({ ...f, volumes: { ...f.volumes, [k]: v } }));

  // Quick revenue targets: the start of each band at this salary.
  const salary = toNum(form.salary);
  const bandTargets = salary > 0 ? config.bands.filter(b => b.lower_x > 0) : [];

  return (
    <SectionCard title={title}
      subtitle="Enter any figures to see the incentive they would earn. Nothing here is saved."
      actions={preset ? (
        <GhostButton onClick={() => setForm(fromPreset(preset))}>
          <RotateCcw className="w-4 h-4 inline mr-1.5" />{presetLabel ?? 'Reset'}
        </GhostButton>
      ) : (
        <GhostButton onClick={() => setForm(fromPreset(null))}>
          <RotateCcw className="w-4 h-4 inline mr-1.5" />Clear
        </GhostButton>
      )}>
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Monthly gross salary (₹)">
            <Input inputMode="decimal" value={form.salary} placeholder="e.g. 40000"
              onChange={e => setForm(f => ({ ...f, salary: e.target.value }))} />
          </Field>
          <Field label="Monthly revenue (₹)" hint={salary > 0 ? `X = ${fmtX(result.x)}` : undefined}>
            <Input inputMode="decimal" value={form.revenue} placeholder="e.g. 250000"
              onChange={e => setForm(f => ({ ...f, revenue: e.target.value }))} />
          </Field>
        </div>

        {bandTargets.length > 0 && (
          <div className="flex flex-wrap gap-1.5 items-center">
            <span className="text-xs mr-1" style={{ color: 'var(--text-muted)' }}>Try revenue at:</span>
            {bandTargets.map(b => (
              <button key={b.lower_x} type="button"
                onClick={() => setForm(f => ({ ...f, revenue: String(Math.ceil(b.lower_x * salary)) }))}
                className="px-2.5 py-1 rounded-lg text-[11px] font-semibold"
                style={{
                  background: result.band.lower_x === b.lower_x ? 'rgba(var(--accent-soft-rgb),0.16)' : 'var(--bg-base)',
                  color: result.band.lower_x === b.lower_x ? 'var(--accent-soft)' : 'var(--text-secondary)',
                  border: '1px solid var(--border)',
                }}>
                {b.lower_x}x · {inr(b.lower_x * salary)}
              </button>
            ))}
          </div>
        )}

        <div>
          <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-secondary)' }}>Product business in the month</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {config.products.map(p => (
              <Field key={p.key} label={p.label} hint={`${p.unit} · min ${inr(p.min_threshold)} · OA ${inr(p.oa_threshold)}`}>
                <Input inputMode="decimal" value={form.volumes[p.key] ?? ''} placeholder="0"
                  onChange={e => setVol(p.key, e.target.value)} />
              </Field>
            ))}
          </div>
        </div>

        <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
          <StatTile label="Revenue multiple" value={salary > 0 ? fmtX(result.x) : '—'} tone="accent" sub={`Band ${result.band.label}`} />
          <StatTile label="Eligible products" value={`${result.productsMet} / ${result.productsRequired}`}
            tone={result.productsMet >= result.productsRequired ? 'good' : 'warn'} />
          <StatTile label="OA products" value={`${result.oaMet} / ${result.oaRequired}`}
            tone={result.oaQualified ? 'good' : 'neutral'} />
          <StatTile label="Predicted incentive" value={inr(result.final)} icon={Calculator}
            tone={result.final > 0 ? 'good' : 'neutral'}
            sub={!salary ? 'Enter a salary' : result.eligible ? (result.capped ? 'Capped' : 'Eligible') : 'Not eligible'} />
        </div>

        {salary > 0 && (
          <>
            <div className="grid gap-5 lg:grid-cols-2">
              <div><Breakdown result={result} /></div>
              <div><ProductChecklist result={result} /></div>
            </div>
            <GoalCards goals={goals} result={result} />
          </>
        )}
      </div>
    </SectionCard>
  );
}
