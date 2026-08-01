/**
 * Client-facing fund recommendations.
 * -----------------------------------------------------------------------------
 * This screen is the ONLY thing that writes the "Recommended by Niyom" shelf in
 * the client portal. Everything else on that portal page is derived from data
 * (returns, categories, NAV); this is the one place a person's opinion reaches
 * a client, so it is deliberately explicit: pick a fund, say why in a line, and
 * the client sees that line under your pick.
 *
 * Picks are chosen from the curated `mutual_funds` catalog rather than free
 * text, because the shelf renders live returns next to each one and can only do
 * that for a fund we actually track.
 *
 * Writes are gated by RLS to admin / super_admin (see the migration). A
 * non-admin sees the list read-only and a note saying so, rather than a form
 * that fails on save.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Plus, Sparkles, Trash2 } from 'lucide-react';
import { supabase } from '../../../lib/supabase';
import type { NWEmployee } from '../../../crm/types';
import { Panel, PanelHead, PageHead, Chip } from '../../ui/Surface';
import { Button, ErrorBlock, Loading, fieldCls } from '../../ui/controls';

interface CatalogRow {
  fund_code: string;
  fund_name: string;
  fund_house: string | null;
  category: string | null;
  sub_category: string | null;
  return_3y: number | string | null;
}

interface Reco {
  id: string;
  amfi_code: string;
  fund_name: string;
  headline: string | null;
  rationale: string | null;
  sort_order: number;
  is_active: boolean;
}

const pct = (v: number | string | null): string =>
  v === null || v === '' ? '—' : `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(1)}%`;

export function RecommendationsPage({ employee }: { employee: NWEmployee | null }) {
  const canEdit = employee?.role === 'admin' || employee?.role === 'super_admin';

  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [recos, setRecos] = useState<Reco[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // New-pick form.
  const [code, setCode] = useState('');
  const [headline, setHeadline] = useState('');
  const [rationale, setRationale] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [cat, rec] = await Promise.all([
        supabase
          .from('mutual_funds')
          .select('fund_code, fund_name, fund_house, category, sub_category, return_3y')
          .order('fund_name'),
        supabase
          .from('nw_mf_recommendations')
          .select('id, amfi_code, fund_name, headline, rationale, sort_order, is_active')
          .order('sort_order'),
      ]);
      if (cat.error) throw cat.error;
      if (rec.error) throw rec.error;
      setCatalog((cat.data ?? []).filter((c) => c.fund_code) as CatalogRow[]);
      setRecos((rec.data ?? []) as Reco[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load recommendations.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const picked = useMemo(() => new Set(recos.map((r) => r.amfi_code)), [recos]);
  const available = useMemo(
    () => catalog.filter((c) => !picked.has(c.fund_code)),
    [catalog, picked],
  );

  const mutate = async (run: () => Promise<{ error: unknown }>) => {
    setSaving(true);
    setError(null);
    const { error: err } = await run();
    setSaving(false);
    if (err) {
      setError(err instanceof Error ? err.message : 'That change could not be saved.');
      return;
    }
    await load();
  };

  const add = async () => {
    const fund = catalog.find((c) => c.fund_code === code);
    if (!fund) return;
    await mutate(async () =>
      supabase.from('nw_mf_recommendations').insert({
        amfi_code: fund.fund_code,
        fund_name: fund.fund_name,
        headline: headline.trim() || null,
        rationale: rationale.trim() || null,
        sort_order: recos.length,
        created_by: employee?.id ?? null,
      }),
    );
    setCode('');
    setHeadline('');
    setRationale('');
  };

  const toggle = (r: Reco) =>
    mutate(async () =>
      supabase.from('nw_mf_recommendations').update({ is_active: !r.is_active }).eq('id', r.id),
    );

  const remove = (r: Reco) =>
    mutate(async () => supabase.from('nw_mf_recommendations').delete().eq('id', r.id));

  /** Swap sort_order with the neighbour — the shelf renders in this order. */
  const move = async (index: number, delta: number) => {
    const other = recos[index + delta];
    const self = recos[index];
    if (!other || !self) return;
    await mutate(async () => {
      const a = await supabase
        .from('nw_mf_recommendations')
        .update({ sort_order: other.sort_order })
        .eq('id', self.id);
      if (a.error) return a;
      return supabase
        .from('nw_mf_recommendations')
        .update({ sort_order: self.sort_order })
        .eq('id', other.id);
    });
  };

  if (loading) return <Loading label="Loading recommendations" />;

  return (
    <>
      <PageHead
        title="Fund Recommendations"
        subtitle="The “Recommended by Niyom” shelf on every client's Mutual Funds tab. Empty here means the shelf is hidden there."
        actions={<Chip tone={recos.some((r) => r.is_active) ? 'success' : 'neutral'}>
          {recos.filter((r) => r.is_active).length} live
        </Chip>}
      />

      {error && (
        <div className="mb-4">
          <ErrorBlock message={error} onRetry={load} />
        </div>
      )}

      {!canEdit && (
        <Panel className="mb-4">
          <p className="text-xs text-text-secondary">
            You can see the current picks, but only an admin can change what clients are
            recommended.
          </p>
        </Panel>
      )}

      {canEdit && (
        <Panel className="mb-5">
          <PanelHead
            title="Add a pick"
            icon={Sparkles}
            hint="Shown to every client. Write the reason the way you would say it to them."
          />
          <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-text-primary">
                Fund
              </label>
              <select value={code} onChange={(e) => setCode(e.target.value)} className={fieldCls}>
                <option value="">Choose a tracked fund…</option>
                {available.map((c) => (
                  <option key={c.fund_code} value={c.fund_code}>
                    {c.fund_name} · {c.sub_category ?? c.category ?? '—'} · 3Y {pct(c.return_3y)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-[11px] font-semibold text-text-primary">
                Headline <span className="font-normal text-text-faint">(optional)</span>
              </label>
              <input
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                maxLength={28}
                placeholder="Core equity holding"
                className={fieldCls}
              />
            </div>
          </div>
          <div className="mt-3">
            <label className="mb-1.5 block text-[11px] font-semibold text-text-primary">
              Why this fund <span className="font-normal text-text-faint">(optional, one line)</span>
            </label>
            <input
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              maxLength={160}
              placeholder="Steady across market cycles, and the lowest cost in its category."
              className={fieldCls}
            />
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" icon={Plus} onClick={add} disabled={!code || saving}>
              Add to shelf
            </Button>
          </div>
        </Panel>
      )}

      <Panel flush>
        <div className="border-b border-border-subtle p-4 sm:p-5">
          <PanelHead
            title="Current picks"
            hint="Order here is the order clients see. Hidden picks stay saved but leave the shelf."
          />
        </div>

        {recos.length === 0 ? (
          <p className="px-5 py-10 text-center text-xs text-text-secondary">
            No recommendations yet. The client portal hides the shelf entirely until one is added.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {recos.map((r, i) => {
              const fund = catalog.find((c) => c.fund_code === r.amfi_code);
              return (
                <li key={r.id} className="flex flex-wrap items-start gap-3 p-4 sm:px-5">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-text-primary">{r.fund_name}</p>
                      {r.headline && <Chip tone="info">{r.headline}</Chip>}
                      {!r.is_active && <Chip tone="warning">Hidden</Chip>}
                      {!fund && <Chip tone="danger">Not in catalog</Chip>}
                    </div>
                    {r.rationale && (
                      <p className="mt-1 text-xs leading-relaxed text-text-secondary">
                        {r.rationale}
                      </p>
                    )}
                    <p className="mt-1 text-[11px] text-text-faint">
                      {fund
                        ? `${fund.fund_house ?? '—'} · ${fund.sub_category ?? fund.category ?? '—'} · 3Y ${pct(fund.return_3y)}`
                        : 'This fund is no longer in the tracked catalog, so clients do not see it.'}
                    </p>
                  </div>

                  {canEdit && (
                    <div className="flex items-center gap-1">
                      <IconBtn
                        label="Move up"
                        disabled={i === 0 || saving}
                        onClick={() => move(i, -1)}
                        icon={ArrowUp}
                      />
                      <IconBtn
                        label="Move down"
                        disabled={i === recos.length - 1 || saving}
                        onClick={() => move(i, 1)}
                        icon={ArrowDown}
                      />
                      <IconBtn
                        label={r.is_active ? 'Hide from clients' : 'Show to clients'}
                        disabled={saving}
                        onClick={() => toggle(r)}
                        icon={r.is_active ? Eye : EyeOff}
                      />
                      <IconBtn
                        label="Remove"
                        disabled={saving}
                        onClick={() => remove(r)}
                        icon={Trash2}
                        danger
                      />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}

function IconBtn({
  label,
  icon: Icon,
  onClick,
  disabled,
  danger,
}: {
  label: string;
  icon: typeof ArrowUp;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-token-md border border-border p-1.5 transition-colors disabled:opacity-40 ${
        danger ? 'text-danger-soft hover:border-danger-soft/40' : 'text-text-secondary hover:text-accent'
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}
