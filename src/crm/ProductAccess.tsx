/**
 * Product access controls for the CRM.
 *
 *  - ProductAccessEditor: one client's or one partner's products (admin or the
 *    assigned RM). Each product either follows the default or is forced on/off.
 *  - ProductDefaultsPanel: the default for every client / every partner (admin).
 *
 * Both save on change through SECURITY DEFINER RPCs that re-check the caller,
 * so the UI never decides who may edit. See 20261024120000_product_access.sql.
 */
import { useCallback, useEffect, useState } from 'react';
import { Package } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { productsFor, type ProductAudience } from '../lib/productAccess';

type Choice = 'default' | 'on' | 'off';

const selectStyle = { background: 'var(--bg-raised)', border: '1px solid var(--border)' };

function useDefaults(audience: ProductAudience) {
  const [defaults, setDefaults] = useState<Record<string, boolean>>({});
  const load = useCallback(async () => {
    const { data } = await supabase.from('nw_product_defaults').select('product, enabled').eq('audience', audience);
    setDefaults(Object.fromEntries((data ?? []).map((r) => [r.product, r.enabled])));
  }, [audience]);
  useEffect(() => { load(); }, [load]);
  return { defaults, reload: load };
}

export function ProductAccessEditor({ audience, clientId, dsaId }: {
  audience: ProductAudience;
  clientId?: string;
  dsaId?: string;
}) {
  const { defaults } = useDefaults(audience);
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState('');

  const subjectId = audience === 'client' ? clientId : dsaId;

  useEffect(() => {
    if (!subjectId) return;
    supabase.from('nw_product_overrides').select('product, enabled')
      .eq(audience === 'client' ? 'client_id' : 'dsa_id', subjectId)
      .then(({ data }) => setOverrides(Object.fromEntries((data ?? []).map((r) => [r.product, r.enabled]))));
  }, [audience, subjectId]);

  const change = async (product: string, choice: Choice) => {
    setSaving(product);
    setError('');
    const enabled = choice === 'default' ? null : choice === 'on';
    const { error: err } = await supabase.rpc('nw_set_product_override', {
      p_audience: audience,
      p_client_id: (audience === 'client' ? clientId : null) as unknown as string,
      p_dsa_id: (audience === 'partner' ? dsaId : null) as unknown as string,
      p_product: product,
      // NULL clears the override.
      p_enabled: enabled as unknown as boolean,
    });
    setSaving(null);
    if (err) return setError(err.message);
    setOverrides((o) => {
      const next = { ...o };
      if (enabled === null) delete next[product]; else next[product] = enabled;
      return next;
    });
  };

  if (!subjectId) return null;

  return (
    <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}>
      <div>
        <p className="text-sm font-bold text-text-primary flex items-center gap-2">
          <Package className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Products
        </p>
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>
          Which products this {audience} sees in their portal. Changes apply immediately.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {productsFor(audience).map((p) => {
          const choice: Choice = p.key in overrides ? (overrides[p.key] ? 'on' : 'off') : 'default';
          const effective = p.key in overrides ? overrides[p.key] : defaults[p.key] ?? true;
          return (
            <div key={p.key} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2" style={{ background: 'var(--bg-elevated)' }}>
              <span className="text-sm text-text-primary flex items-center gap-2">
                <span className="w-2 h-2 rounded-full" style={{ background: effective ? 'var(--c-emerald, #34d399)' : 'var(--text-faint, #888)' }} />
                {p.label}
              </span>
              <select
                value={choice}
                disabled={saving === p.key}
                onChange={(e) => change(p.key, e.target.value as Choice)}
                className="px-2 py-1 rounded-lg text-xs text-text-primary outline-none disabled:opacity-50"
                style={selectStyle}
              >
                <option value="default">Default ({defaults[p.key] ?? true ? 'Shown' : 'Hidden'})</option>
                <option value="on">Shown</option>
                <option value="off">Hidden</option>
              </select>
            </div>
          );
        })}
      </div>
      {error && <p className="text-xs text-c-red">{error}</p>}
    </div>
  );
}

export function ProductDefaultsPanel() {
  const client = useDefaults('client');
  const partner = useDefaults('partner');
  const [error, setError] = useState('');

  const toggle = async (audience: ProductAudience, product: string, enabled: boolean) => {
    setError('');
    const { error: err } = await supabase.rpc('nw_set_product_default', { p_audience: audience, p_product: product, p_enabled: enabled });
    if (err) return setError(err.message);
    (audience === 'client' ? client : partner).reload();
  };

  return (
    <div className="rounded-2xl p-6 space-y-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
      <div>
        <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
          <Package className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Product Access
        </h3>
        <p className="text-xs mt-1" style={{ color: 'var(--text-secondary)' }}>
          The default product list for every client and every partner. A single client or partner can be
          overridden from their Edit screen. A hidden product disappears from the portal menu and cannot be ordered;
          existing holdings still show.
        </p>
      </div>
      {(['client', 'partner'] as const).map((audience) => {
        const defaults = (audience === 'client' ? client : partner).defaults;
        return (
          <div key={audience} className="space-y-2">
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>
              {audience === 'client' ? 'Client portal' : 'Partner portal'}
            </p>
            {productsFor(audience).map((p) => {
              const on = defaults[p.key] ?? true;
              return (
                <label key={p.key} className="flex items-center justify-between rounded-xl px-4 py-3 cursor-pointer" style={{ background: 'var(--bg-raised)', border: '1px solid var(--border)' }}>
                  <span className="text-sm text-text-primary">{p.label}</span>
                  <span className="flex items-center gap-2 text-xs" style={{ color: on ? 'var(--accent)' : 'var(--text-secondary)' }}>
                    {on ? 'Shown' : 'Hidden'}
                    <input type="checkbox" checked={on} onChange={(e) => toggle(audience, p.key, e.target.checked)} className="w-4 h-4 accent-[var(--accent)]" />
                  </span>
                </label>
              );
            })}
          </div>
        );
      })}
      {error && <p className="text-xs text-c-red">{error}</p>}
    </div>
  );
}
