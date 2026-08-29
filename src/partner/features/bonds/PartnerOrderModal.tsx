// Partner places a bond order for one of their clients. Pick a client, set the
// per-bond margin (0–5%, defaults to the partner's global spread), choose units,
// review the indicative amount at the partner price, and submit. The edge function
// re-derives the price and routes the order to the client's RM.

import { useEffect, useMemo, useState } from 'react';
import { X, CheckCircle2, Percent, Minus, Plus } from 'lucide-react';
import { inr } from '../../../lib/money';
import { minUnits, stepUnits } from '../../../portal/features/bonds/bondMath';
import {
  clampMargin, isMarginValid, partnerBreakdown, MAX_PARTNER_MARGIN,
} from '../../../../shared/partner/bonds/partnerBondMath';
import { PartnerService, type PartnerBond } from '../../services/PartnerService';
import type { PartnerClientRow } from '../../types';

export function PartnerOrderModal({
  bond,
  defaultMargin,
  onClose,
  onPlaced,
}: {
  bond: PartnerBond;
  defaultMargin: number;
  onClose: () => void;
  onPlaced: () => void;
}) {
  const [clients, setClients] = useState<PartnerClientRow[]>([]);
  const [loadingClients, setLoadingClients] = useState(true);
  const [clientId, setClientId] = useState('');
  const [margin, setMargin] = useState(String(defaultMargin || 0));
  const min = minUnits(bond);
  const step = stepUnits(bond);
  const [units, setUnits] = useState(min);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placedRef, setPlacedRef] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try { const rows = await PartnerService.getClients(); if (alive) setClients(rows); }
      catch { /* leave empty; the select shows the empty hint */ }
      finally { if (alive) setLoadingClients(false); }
    })();
    return () => { alive = false; };
  }, []);

  const marginNum = clampMargin(margin);
  const bd = useMemo(() => partnerBreakdown(bond, units, margin), [bond, units, margin]);
  const pricePer100 = bd.pricePer100;
  const marginValid = isMarginValid(margin);
  const canPlace = !!clientId && marginValid && units >= min && !placing;

  const place = async () => {
    setPlacing(true); setError(null);
    try {
      const order = await PartnerService.placeBondOrder({ clientId, bondId: bond.id, units, margin: marginNum });
      setPlacedRef(order.ref);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not place the order.');
    } finally {
      setPlacing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-token-xl border border-border bg-bg-elevated shadow-token-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 className="font-display text-base font-bold text-text-primary">Order for a client</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary"><X className="h-5 w-5" /></button>
        </div>

        {placedRef ? (
          <div className="p-6 text-center">
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
              <CheckCircle2 className="h-7 w-7 text-success" />
            </span>
            <h3 className="font-display text-lg font-bold text-text-primary">Order submitted</h3>
            <p className="mx-auto mt-2 max-w-xs text-sm text-text-secondary">
              Order <span className="font-semibold text-text-primary">{placedRef}</span> for {units} unit{units === 1 ? '' : 's'} has been sent to the client's relationship manager, who will confirm the deal.
            </p>
            <button type="button" onClick={onPlaced} className="mt-6 w-full rounded-token-md py-3 text-sm font-bold text-on-accent" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
              Done
            </button>
          </div>
        ) : (
          <div className="space-y-4 overflow-y-auto p-5">
            <p className="text-sm font-bold text-text-primary">{bond.bond_name || bond.issuer_name || bond.isin}</p>

            {/* Client */}
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-faint">Client</span>
              <select
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                className="w-full rounded-token-md border border-border bg-bg-surface px-3 py-2.5 text-sm text-text-primary outline-none"
              >
                <option value="">{loadingClients ? 'Loading…' : clients.length ? 'Select a client' : 'No clients mapped to you yet'}</option>
                {clients.map((c) => (
                  <option key={c.client_id} value={c.client_id}>{c.full_name} · {c.client_code}</option>
                ))}
              </select>
            </label>

            {/* Margin + units */}
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-faint">Your margin</span>
                <div className="relative">
                  <Percent className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint" />
                  <input type="number" step="0.01" min={0} max={MAX_PARTNER_MARGIN} value={margin} onChange={(e) => setMargin(e.target.value)}
                    className="w-full rounded-token-md border border-border bg-bg-surface py-2.5 pl-8 pr-2 text-sm text-text-primary outline-none" />
                </div>
              </label>
              <div>
                <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-text-faint">Units</span>
                <div className="flex items-center justify-between rounded-token-md border border-border bg-bg-surface p-1">
                  <button type="button" onClick={() => setUnits((u) => Math.max(min, u - step))} disabled={units <= min} className="flex h-8 w-8 items-center justify-center rounded-token-sm border border-border bg-bg-elevated text-text-primary disabled:opacity-40"><Minus className="h-3.5 w-3.5" /></button>
                  <span className="font-display text-base font-bold tabular-nums text-text-primary">{units}</span>
                  <button type="button" onClick={() => setUnits((u) => u + step)} className="flex h-8 w-8 items-center justify-center rounded-token-sm border border-border bg-bg-elevated text-text-primary"><Plus className="h-3.5 w-3.5" /></button>
                </div>
              </div>
            </div>

            {/* Breakdown */}
            <div className="space-y-2 rounded-token-lg bg-bg-surface p-3">
              <Row label="Price / ₹100 (incl. your margin)" value={inr(pricePer100)} />
              <Row label="Investment amount" value={inr(bd.investment)} />
              {bd.accrued > 0 && <Row label="Accrued interest" value={inr(bd.accrued)} />}
              <div className="border-t border-border-subtle pt-2"><Row label="Amount payable (indicative)" value={inr(bd.amount)} strong /></div>
            </div>

            {error && <div className="rounded-token-md border border-danger-soft/20 bg-danger-soft/10 p-3 text-xs text-danger-soft">{error}</div>}

            <button type="button" disabled={!canPlace} onClick={place} className="w-full rounded-token-md py-3 text-sm font-bold text-on-accent disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
              {placing ? 'Placing order…' : `Place order · ${inr(bd.amount)}`}
            </button>
            <p className="text-center text-[11px] text-text-faint">Routed to the client's relationship manager, who confirms the deal. No payment is taken now.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className={`tabular-nums ${strong ? 'text-sm font-bold text-text-primary' : 'text-xs font-semibold text-text-primary'}`}>{value}</span>
    </div>
  );
}
