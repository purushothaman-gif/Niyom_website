// Partner Bonds — the bonds a partner may sell. They see their COST (base, set by
// their RM and admin-approved) and add their own markup, capped at 5%, to get their
// selling price. Reads via PartnerService (RPC-only, partnerSupabase). Empty until
// the RM's partner rate is approved.

import { useEffect, useState } from 'react';
import { Landmark, Loader2, TrendingUp, Percent, Check } from 'lucide-react';
import { PartnerService, type PartnerBond } from '../../services/PartnerService';

const pct = (v: number | null | undefined) => v === null || v === undefined ? '—' : `${Number(v).toFixed(2)}%`;
const inr = (v: number | null | undefined) => v === null || v === undefined ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const inrShort = (v: number | null | undefined) => {
  if (v === null || v === undefined) return '—';
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2)} Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2)} L`;
  return `₹${Number(v).toLocaleString('en-IN')}`;
};
const fdate = (d: string | null) => {
  if (!d) return '—';
  const dt = new Date(d);
  return Number.isNaN(dt.getTime()) ? '—' : dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

export function BondsPage() {
  const [bonds, setBonds] = useState<PartnerBond[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [markup, setMarkup] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const load = async () => {
    setLoading(true); setError(null);
    try { setBonds(await PartnerService.getBonds()); }
    catch (e) { setError(e instanceof Error ? e.message : 'Failed to load'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const currentSelf = bonds[0]?.self_markup_percent ?? 0;

  const save = async () => {
    const v = parseFloat(markup);
    if (Number.isNaN(v)) return;
    setSaving(true); setSaveErr(null);
    try { await PartnerService.setBondMarkup(v); setMarkup(''); await load(); }
    catch (e) { setSaveErr(e instanceof Error ? e.message : 'Failed to save'); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>;

  if (error) return (
    <div className="text-center py-16 rounded-2xl bg-surface border border-border">
      <p className="text-sm text-text-secondary">Couldn’t load bonds. {error}</p>
    </div>
  );

  if (bonds.length === 0) return (
    <div className="text-center py-20 rounded-2xl bg-surface border border-border">
      <Landmark className="w-8 h-8 mx-auto mb-3 text-text-faint" />
      <p className="text-base font-semibold text-text-primary">No bonds available yet</p>
      <p className="text-sm text-text-muted mt-1 max-w-sm mx-auto">Bonds you can offer will appear here once your relationship manager sets up your pricing.</p>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Your markup control */}
      <div className="rounded-2xl bg-surface border border-border p-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-text-faint font-semibold">Your markup</p>
          <p className="text-sm text-text-secondary mt-0.5">Added on top of your cost, capped at <strong>5%</strong>. Current: <strong className="text-text-primary">{pct(currentSelf)}</strong></p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Percent className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-faint" />
            <input type="number" step="0.01" min={0} max={5} value={markup} onChange={e => setMarkup(e.target.value)} placeholder={String(currentSelf)}
              className="w-28 pl-8 pr-2 py-2 rounded-lg text-sm bg-base border border-border text-text-primary outline-none" />
          </div>
          <button disabled={saving || markup === '' || Number.isNaN(parseFloat(markup))} onClick={save}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-accent text-text-on disabled:opacity-40 inline-flex items-center gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save
          </button>
        </div>
      </div>
      {saveErr && <p className="text-sm text-red-500">{saveErr}</p>}

      <p className="text-sm text-text-muted">{bonds.length} bond{bonds.length === 1 ? '' : 's'}. Prices are per ₹100 face value; “Your price” includes your {pct(currentSelf)} markup.</p>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {bonds.map(b => (
          <div key={b.id} className="rounded-2xl bg-surface border border-border p-5 flex flex-col gap-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-text-primary leading-snug line-clamp-2">{b.bond_name || b.issuer_name || b.isin}</p>
                <p className="text-xs text-text-faint mt-0.5">{b.issuer_name || ''}</p>
              </div>
              {b.rating && <span className="shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-lg bg-accent/10 text-accent">{b.rating}</span>}
            </div>

            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-text-faint font-semibold">Coupon</p>
                <p className="text-2xl font-bold text-text-primary leading-none">{pct(b.coupon_rate)}</p>
                <p className="text-[11px] text-text-muted capitalize mt-0.5">{(b.coupon_frequency || '').replace('_', '-') || '—'}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] uppercase tracking-wider text-text-faint font-semibold">Your price / ₹100</p>
                <p className="text-xl font-extrabold text-accent leading-none">{inr(b.partner_price)}</p>
                <p className="text-[11px] text-text-faint mt-0.5">cost {inr(b.partner_base)}</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-border-subtle text-xs">
              <div><span className="text-text-faint">Maturity</span><p className="text-text-secondary font-medium">{fdate(b.maturity_date)}</p></div>
              <div><span className="text-text-faint">Min. Inv.</span><p className="text-text-secondary font-medium">{inrShort(b.min_investment ?? b.face_value)}</p></div>
              <div className="text-right"><span className="text-text-faint">YTM</span><p className="text-text-secondary font-medium inline-flex items-center gap-1">{b.analytics?.ytm != null && <TrendingUp className="w-3 h-3" />}{b.analytics?.ytm != null ? pct(b.analytics.ytm) : '—'}</p></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
