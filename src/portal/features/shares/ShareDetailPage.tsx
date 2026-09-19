// Unlisted share detail — company hero, the facts we hold, and a sticky quantity
// picker that leads to the order review. Every figure is the client's indicative
// marked-up price; the RM finalises on the deal confirmation.

import { useMemo, useState } from 'react';
import { ArrowLeft, Gem, ShieldCheck, ArrowRight, ExternalLink } from 'lucide-react';
import { inr } from '../../../lib/money';
import { ShareLogo } from '../../../components/ShareLogo';
import { QuantityInput } from '../../../components/QuantityInput';
import { Card } from '../../components/Card';
import { StatusPill } from '../../components/StatusPill';
import { Figure } from '../../ui/kit';
import type { ClientShare } from '../../../../shared/portal/services/ShareOrderService';
import { minQty, stepQty, shareBreakdown, qtyError } from '../../../../shared/portal/shares/shareMath';

export function ShareDetailPage({
  share,
  onBack,
  onInvest,
  canInvest,
}: {
  share: ClientShare;
  onBack: () => void;
  onInvest: (qty: number) => void;
  canInvest: boolean;
}) {
  const min = minQty(share);
  const step = stepQty(share);
  const [qty, setQty] = useState(min);

  const bd = useMemo(() => shareBreakdown(share.client_price, qty), [share.client_price, qty]);
  const qtyProblem = qtyError(share, qty);

  const rows: Array<[string, string]> = [
    ['ISIN', share.isin || '—'],
    ['Company', share.company_name || '—'],
    ['Sector', share.sector || '—'],
    ['Face value', share.face_value != null ? inr(share.face_value, true) : '—'],
    ['Minimum quantity', `${min} share${min === 1 ? '' : 's'}`],
    ['Lot size', `${step} share${step === 1 ? '' : 's'}`],
  ];

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-accent"
      >
        <ArrowLeft className="h-4 w-4" /> Back to unlisted shares
      </button>

      <Card accent padding="lg">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <ShareLogo name={share.short_name || share.company_name} url={share.logo_url} size={48} />
            <div className="min-w-0">
              <h1 className="font-display text-lg font-bold leading-tight text-text-primary">
                {share.short_name || share.company_name}
              </h1>
              <p className="mt-0.5 text-xs text-text-faint">{share.company_name} · {share.isin}</p>
            </div>
          </div>
          {share.sector && <StatusPill tone="accent">{share.sector}</StatusPill>}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Figure label="Price / share" value={inr(share.client_price ?? 0, true)} />
          <Figure label="Min. quantity" value={`${min}`} />
          <Figure label="Min. investment" value={inr((share.client_price ?? 0) * min, true)} />
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {share.about && (
            <Card padding="md">
              <h3 className="mb-2 text-sm font-bold text-text-primary">About the company</h3>
              <p className="whitespace-pre-line text-sm leading-relaxed text-text-secondary">{share.about}</p>
              {share.website && (
                <a
                  href={share.website}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-accent"
                >
                  Visit website <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </Card>
          )}

          <Card padding="md">
            <h3 className="mb-2 text-sm font-bold text-text-primary">Security details</h3>
            <dl className="divide-y divide-border-subtle">
              {rows.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-xs text-text-secondary">{label}</dt>
                  <dd className="text-right text-xs font-semibold text-text-primary">{value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card padding="md">
            <p className="text-[11px] leading-relaxed text-text-faint">
              Unlisted shares are not traded on an exchange. Prices are indicative, availability is confirmed by your
              relationship manager at the time of dealing, and settlement happens off-market into your demat account.
              These instruments carry liquidity and valuation risk, and there is no assurance of a listing.
            </p>
          </Card>
        </div>

        {/* Quantity picker */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <Card padding="md">
            <h3 className="text-sm font-bold text-text-primary">Select quantity</h3>
            <p className="mt-0.5 text-[11px] text-text-faint">
              Type a number or use − / +. Minimum {min}{step > 1 ? `, in steps of ${step}` : ''}.
            </p>

            <div className="mt-4">
              <QuantityInput value={qty} onChange={setQty} min={min} step={step} />
              {qtyProblem && <p className="mt-1.5 text-[11px] text-danger-soft">{qtyProblem}</p>}
            </div>

            <div className="mt-4 space-y-1">
              <Row label={`${qty} × ${inr(bd.pricePerShare, true)}`} value={inr(bd.amount, true)} />
              <Row label="Stamp duty" value="Finalised at confirmation" muted />
              <div className="mt-1 rounded-token-md bg-bg-surface px-3 py-2.5">
                <Row label="Indicative amount" value={inr(bd.amount, true)} strong />
              </div>
            </div>

            {canInvest ? (
              <button
                type="button"
                onClick={() => onInvest(qty)}
                disabled={!!qtyProblem}
                className="mt-4 inline-flex w-full items-center justify-center gap-1.5 rounded-token-md py-3 text-sm font-bold text-on-accent disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
              >
                Continue <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <div className="mt-4 rounded-token-md border border-border bg-bg-surface px-3 py-3 text-center">
                <Gem className="mx-auto mb-1.5 h-4 w-4 text-text-faint" />
                <p className="text-xs text-text-secondary">
                  Complete your KYC to place an order. You can keep browsing in the meantime.
                </p>
              </div>
            )}

            <p className="mt-3 flex items-start gap-1.5 text-[11px] text-text-faint">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              No payment is taken now — your RM confirms availability and the final terms.
            </p>
          </Card>
        </div>
      </div>
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
