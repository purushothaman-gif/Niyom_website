// Partner unlisted-share detail — the company facts on the left, partner pricing
// (cost, your markup, your selling price) on the right rather than a buy box.
// Action slots render only when their handler is provided.

import { ArrowLeft, ShieldCheck, UserPlus, Share2, ExternalLink } from 'lucide-react';
import { inr, pct } from '../../../lib/money';
import { ShareLogo } from '../../../components/ShareLogo';
import { minQty, stepQty } from '../../../../shared/portal/shares/shareMath';
import type { PartnerShare } from '../../services/PartnerService';

export function PartnerShareDetail({
  share,
  onBack,
  onOrder,
  onShare,
}: {
  share: PartnerShare;
  onBack: () => void;
  /** Order this share for one of the partner's clients. */
  onOrder?: () => void;
  /** Mint a shareable offer link for a client. */
  onShare?: () => void;
}) {
  const min = minQty(share);
  const step = stepQty(share);
  const markup = Number(share.self_markup_percent) || 0;

  const rows: Array<[string, string]> = [
    ['ISIN', share.isin || '—'],
    ['Company', share.company_name || '—'],
    ['Sector', share.sector || '—'],
    ['Face value', share.face_value != null ? inr(share.face_value) : '—'],
    ['Minimum quantity', `${min} share${min === 1 ? '' : 's'}`],
    ['Lot size', `${step} share${step === 1 ? '' : 's'}`],
  ];

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-accent">
        <ArrowLeft className="h-4 w-4" /> Back to unlisted shares
      </button>

      {/* Hero */}
      <div className="relative rounded-token-xl border border-border bg-bg-elevated p-6 shadow-token-card">
        <span aria-hidden className="absolute left-0 top-5 bottom-5 w-1 rounded-full bg-accent" />
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
          {share.sector && (
            <span className="rounded-token-sm border border-accent/20 bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
              {share.sector}
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {share.about && (
            <div className="rounded-token-xl border border-border bg-bg-elevated p-5">
              <h3 className="mb-2 text-sm font-bold text-text-primary">About the company</h3>
              <p className="whitespace-pre-line text-sm leading-relaxed text-text-secondary">{share.about}</p>
              {share.website && (
                <a href={share.website} target="_blank" rel="noopener noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-accent">
                  Visit website <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          )}

          <div className="rounded-token-xl border border-border bg-bg-elevated p-5">
            <h3 className="mb-2 text-sm font-bold text-text-primary">Security details</h3>
            <dl className="divide-y divide-border-subtle">
              {rows.map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-xs text-text-secondary">{label}</dt>
                  <dd className="text-right text-xs font-semibold text-text-primary">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <div className="rounded-token-xl border border-border bg-bg-elevated p-5">
            <p className="text-[11px] leading-relaxed text-text-faint">
              Unlisted shares are not exchange-traded. Prices are indicative, availability is confirmed by the client's
              relationship manager at the time of dealing, and settlement is off-market into the client's demat account.
              These instruments carry liquidity and valuation risk, and there is no assurance of a listing.
            </p>
          </div>
        </div>

        {/* Partner pricing */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-token-xl border border-border bg-bg-elevated p-5">
            <h3 className="text-sm font-bold text-text-primary">Your pricing</h3>

            <div className="mt-4 space-y-1">
              <Row label="Your cost / share" value={inr(share.partner_base ?? 0)} />
              <Row label="Your markup" value={pct(markup)} />
              <div className="mt-1 rounded-token-md bg-bg-surface px-3 py-2.5">
                <Row label="Your price / share" value={inr(share.partner_price ?? 0)} strong />
              </div>
            </div>

            <p className="mt-3 text-[11px] text-text-faint">
              Minimum {min} share{min === 1 ? '' : 's'} — about {inr((share.partner_price ?? 0) * min)} at your price.
            </p>

            <div className="mt-4 space-y-2">
              {onOrder && (
                <button type="button" onClick={onOrder}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-token-md py-3 text-sm font-bold text-on-accent"
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                  <UserPlus className="h-4 w-4" /> Order for a client
                </button>
              )}
              {onShare && (
                <button type="button" onClick={onShare}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-token-md border border-border bg-bg-surface py-3 text-sm font-bold text-text-primary hover:border-accent/40">
                  <Share2 className="h-4 w-4" /> Share with a client
                </button>
              )}
            </div>

            <p className="mt-3 flex items-start gap-1.5 text-[11px] text-text-faint">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              Your cost is never shown to a client — they only see your price.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className={`text-right tabular-nums ${strong ? 'text-sm font-bold text-accent' : 'text-xs font-semibold text-text-primary'}`}>
        {value}
      </span>
    </div>
  );
}
