// Order review + place for unlisted shares. Shows the indicative amount, a T&C
// acknowledgement, and places the order through ShareOrderService → the
// place-share-order edge function (which re-derives the price server-side and
// alerts the RM). No online payment — the RM confirms availability first.

import { useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, ShieldCheck } from 'lucide-react';
import { inr } from '../../../lib/money';
import { ShareLogo } from '../../../components/ShareLogo';
import { Card } from '../../components/Card';
import { ShareOrderService, type ClientShare } from '../../../../shared/portal/services/ShareOrderService';
import { shareBreakdown } from '../../../../shared/portal/shares/shareMath';

export function ShareOrderFlow({
  share,
  qty,
  clientId,
  onBack,
  onDone,
}: {
  share: ClientShare;
  qty: number;
  clientId: string;
  onBack: () => void;
  onDone: () => void;
}) {
  const bd = useMemo(() => shareBreakdown(share.client_price, qty), [share.client_price, qty]);
  const [agree, setAgree] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [placedRef, setPlacedRef] = useState<string | null>(null);

  const place = async () => {
    setPlacing(true);
    setError(null);
    try {
      const order = await ShareOrderService.placeOrder({ clientId, shareId: share.id, qty });
      setPlacedRef(order.ref);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not place your order. Please try again.');
    } finally {
      setPlacing(false);
    }
  };

  if (placedRef) {
    return (
      <div className="mx-auto max-w-lg">
        <Card padding="lg" className="text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
            <CheckCircle2 className="h-7 w-7 text-success" />
          </span>
          <h2 className="font-display text-xl font-bold text-text-primary">Order submitted</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-text-secondary">
            Your order <span className="font-semibold text-text-primary">{placedRef}</span> for {qty} share
            {qty === 1 ? '' : 's'} of {share.short_name || share.company_name} has been sent to your relationship
            manager. They’ll confirm availability and the final terms, then send you a deal confirmation to accept.
          </p>
          <div className="mt-4 inline-flex flex-col gap-1 rounded-token-lg bg-bg-surface px-5 py-3 text-left">
            <Row label="Quantity" value={`${qty} share${qty === 1 ? '' : 's'}`} />
            <Row label="Indicative amount" value={inr(bd.amount)} strong />
          </div>
          <button
            type="button"
            onClick={onDone}
            className="mt-6 w-full rounded-token-md py-3 text-sm font-bold text-on-accent"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
          >
            View my orders
          </button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-accent"
      >
        <ArrowLeft className="h-4 w-4" /> Edit quantity
      </button>

      <Card padding="md">
        <div className="flex items-center gap-3">
          <ShareLogo name={share.short_name || share.company_name} url={share.logo_url} size={40} />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-text-primary">{share.short_name || share.company_name}</p>
            <p className="mt-0.5 text-[11px] text-text-faint">{share.isin}</p>
          </div>
        </div>
      </Card>

      <Card padding="md" className="space-y-1">
        <h3 className="mb-2 text-sm font-bold text-text-primary">Order overview</h3>
        <Row label={`Quantity (${qty} × ${inr(bd.pricePerShare)})`} value={inr(bd.amount)} />
        <Row label="Stamp duty" value="Finalised at confirmation" muted />
        <div className="mt-1 rounded-token-md bg-bg-surface px-3 py-2.5">
          <Row label="Amount payable (indicative)" value={inr(bd.amount)} strong />
        </div>
      </Card>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-token-md border border-border bg-bg-surface px-3 py-3">
        <input
          type="checkbox"
          checked={agree}
          onChange={(e) => setAgree(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
        />
        <span className="text-xs leading-relaxed text-text-secondary">
          I understand this is a request to my relationship manager, not a live-market purchase. Unlisted shares are
          not exchange-traded; prices and availability are indicative, and the final amount, stamp duty and off-market
          settlement are confirmed on the deal confirmation I’ll receive and accept.
        </span>
      </label>

      {error && (
        <div className="rounded-token-md border border-danger-soft/20 bg-danger-soft/10 p-3 text-xs text-danger-soft">
          {error}
        </div>
      )}

      <button
        type="button"
        disabled={!agree || placing}
        onClick={place}
        className="w-full rounded-token-md py-3 text-sm font-bold text-on-accent disabled:opacity-50"
        style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
      >
        {placing ? 'Placing order…' : `Place order · ${inr(bd.amount)}`}
      </button>

      <p className="flex items-start gap-1.5 text-[11px] text-text-faint">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
        No payment is taken now. Your RM confirms the deal and shares settlement instructions on acceptance.
      </p>
    </div>
  );
}

function Row({ label, value, strong, muted }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-xs text-text-secondary">{label}</span>
      <span
        className={`text-right tabular-nums ${strong ? 'text-sm font-bold text-text-primary' : muted ? 'text-xs text-text-faint' : 'text-xs font-semibold text-text-primary'}`}
      >
        {value}
      </span>
    </div>
  );
}
