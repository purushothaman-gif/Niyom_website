// Client Bonds — the bond list a client can see, priced at their approved markup.
// Reads nw_client_bonds() through clientSupabase; the RPC returns ONLY the marked-up
// price and safe facts (no base price, cost or margin), and is empty until an admin
// has approved a rate for this client.

import { useEffect, useState } from 'react';
import { Landmark, Loader2, TrendingUp } from 'lucide-react';
import { clientSupabase } from '../../../lib/supabase';
import { Card } from '../../components/Card';

interface ClientBond {
  id: string;
  isin: string;
  bond_name: string | null;
  issuer_name: string | null;
  coupon_rate: number | null;
  coupon_frequency: string | null;
  maturity_date: string | null;
  rating: string | null;
  min_investment: number | null;
  face_value: number | null;
  client_price: number | null;
  analytics: { ytm?: number | null } | null;
}

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
  const [bonds, setBonds] = useState<ClientBond[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true); setError(null);
      const { data, error } = await clientSupabase.rpc('nw_client_bonds');
      if (!alive) return;
      if (error) setError(error.message);
      else setBonds((data as unknown as ClientBond[]) ?? []);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  if (loading) return <div className="flex items-center justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-accent" /></div>;

  if (error) return (
    <Card className="text-center py-16">
      <p className="text-sm text-text-secondary">Couldn’t load bonds. {error}</p>
    </Card>
  );

  if (bonds.length === 0) return (
    <Card className="text-center py-20">
      <Landmark className="w-8 h-8 mx-auto mb-3 text-text-faint" />
      <p className="text-base font-semibold text-text-primary">No bonds available yet</p>
      <p className="text-sm text-text-muted mt-1 max-w-sm mx-auto">Fixed-income options curated for you will appear here. Please contact your relationship manager to get started.</p>
    </Card>
  );

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">{bonds.length} bond{bonds.length === 1 ? '' : 's'} available. Prices are indicative, per ₹100 face value.</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {bonds.map(b => (
          <Card key={b.id} interactive padding="md" className="flex flex-col gap-3">
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
                <p className="text-[10px] uppercase tracking-wider text-text-faint font-semibold">Price / ₹100</p>
                <p className="text-xl font-extrabold text-accent leading-none">{inr(b.client_price)}</p>
                {b.analytics?.ytm != null && <p className="text-[11px] text-text-muted mt-0.5 inline-flex items-center gap-1"><TrendingUp className="w-3 h-3" /> {pct(b.analytics.ytm)} YTM</p>}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-2 border-t border-border-subtle text-xs">
              <div><span className="text-text-faint">Maturity</span><p className="text-text-secondary font-medium">{fdate(b.maturity_date)}</p></div>
              <div className="text-right"><span className="text-text-faint">Min. Investment</span><p className="text-text-secondary font-medium">{inrShort(b.min_investment ?? b.face_value)}</p></div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
