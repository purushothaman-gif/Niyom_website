// Partner bond detail — same layout as the client detail page (hero stat bar,
// Summary / Other details sections) but the right panel is partner pricing (cost,
// your markup, your selling price) rather than a buy box. Action slots (order for
// a client, share, marketing image) render only when their handler is provided,
// so later phases light them up without touching this file's structure.

import { useState } from 'react';
import { ArrowLeft, Landmark, ShieldCheck, UserPlus, Share2, ImageDown } from 'lucide-react';
import { inr, pct, shortDate } from '../../../lib/money';
import { tenureLabel } from '../../../portal/features/bonds/bondMath';
import type { PartnerBond } from '../../services/PartnerService';

type Section = 'summary' | 'details';

function cap(s: string | null | undefined): string {
  if (!s) return '—';
  return s.length <= 4 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function PartnerBondDetail({
  bond,
  onBack,
  onOrder,
  onShare,
  onMarketingImage,
}: {
  bond: PartnerBond;
  onBack: () => void;
  /** Order this bond for one of the partner's clients (Phase B). */
  onOrder?: () => void;
  /** Create a shareable link for a client (Phase C). */
  onShare?: () => void;
  /** Generate a marketing image (Phase D). */
  onMarketingImage?: () => void;
}) {
  const [section, setSection] = useState<Section>('summary');

  const summaryRows: Array<[string, string]> = [
    ['Coupon rate', pct(bond.coupon_rate ?? 0)],
    ['Coupon type', cap(bond.coupon_type)],
    ['Interest payment', cap(bond.coupon_frequency)],
    ['Face value', inr(bond.face_value ?? 0)],
    ['Maturity date', shortDate(bond.maturity_date)],
    ['Next coupon', shortDate(bond.next_coupon_date)],
    ['Yield to maturity', bond.analytics?.ytm != null ? pct(bond.analytics.ytm) : '—'],
    ['Tenure', tenureLabel(bond)],
  ];
  const detailRows: Array<[string, string]> = [
    ['ISIN', bond.isin || '—'],
    ['Issuer', bond.issuer_name || '—'],
    ['Security type', cap(bond.security_type)],
    ['Seniority', cap(bond.seniority)],
    ['Principal repayment', cap(bond.principal_repayment_structure)],
    ['Day-count convention', bond.day_count_convention || '—'],
    ['Rating', bond.rating ? `${bond.rating}${bond.rating_agency ? ` · ${bond.rating_agency}` : ''}` : '—'],
    ['Tax status', cap(bond.tax_status)],
    ['Trustee', bond.trustee || '—'],
    ['Issue date', shortDate(bond.issue_date)],
  ];

  return (
    <div className="space-y-5">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-accent">
        <ArrowLeft className="h-4 w-4" /> Back to bonds
      </button>

      {/* Hero */}
      <div className="relative rounded-token-xl border border-border bg-bg-elevated p-6 shadow-token-card">
        <span aria-hidden className="absolute left-0 top-5 bottom-5 w-1 rounded-full bg-accent" />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-token-lg bg-accent/10">
              <Landmark className="h-5 w-5 text-accent" />
            </span>
            <div className="min-w-0">
              <h1 className="font-display text-lg font-bold leading-tight text-text-primary">{bond.bond_name || bond.issuer_name || bond.isin}</h1>
              <p className="mt-0.5 text-xs text-text-faint">{bond.issuer_name || ''} · {bond.isin}</p>
            </div>
          </div>
          {bond.rating && <span className="rounded-token-sm border border-accent/20 bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">{bond.rating}</span>}
        </div>
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Hero label="Yield (YTM)" value={bond.analytics?.ytm != null ? pct(bond.analytics.ytm) : pct(bond.coupon_rate ?? 0)} />
          <Hero label="Coupon" value={pct(bond.coupon_rate ?? 0)} />
          <Hero label="Tenure" value={tenureLabel(bond)} />
          <Hero label="Min. Investment" value={inr(bond.min_investment ?? bond.face_value ?? 0)} />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        {/* Sections */}
        <div className="space-y-4">
          <div className="flex gap-1.5">
            {(['summary', 'details'] as Section[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSection(s)}
                className={`rounded-token-md border px-3.5 py-2 text-xs font-semibold transition-colors ${
                  section === s ? 'border-accent/30 bg-selected text-accent' : 'border-border bg-bg-raised text-text-muted hover:text-text-primary'
                }`}
              >
                {s === 'summary' ? 'Summary' : 'Other details'}
              </button>
            ))}
          </div>
          <div className="rounded-token-xl border border-border bg-bg-elevated p-5 shadow-token-card">
            <dl className="divide-y divide-border-subtle">
              {(section === 'summary' ? summaryRows : detailRows).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-xs text-text-secondary">{k}</dt>
                  <dd className="text-right text-xs font-semibold text-text-primary">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* Partner pricing panel */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="space-y-4 rounded-token-xl border border-border bg-bg-elevated p-5 shadow-token-card">
            <p className="text-xs font-semibold uppercase tracking-wider text-text-faint">Your pricing</p>
            <div className="space-y-2 rounded-token-lg bg-bg-surface p-3">
              <Row label="Your cost / ₹100" value={inr(bond.partner_base ?? 0)} />
              <Row label="Your markup" value={pct(bond.self_markup_percent ?? 0)} />
              <div className="border-t border-border-subtle pt-2">
                <Row label="Your price / ₹100" value={inr(bond.partner_price ?? 0)} strong />
              </div>
            </div>
            {(onOrder || onShare || onMarketingImage) && (
              <div className="space-y-2">
                {onOrder && (
                  <button
                    type="button"
                    onClick={onOrder}
                    className="inline-flex w-full items-center justify-center gap-1.5 rounded-token-md py-2.5 text-sm font-bold text-on-accent"
                    style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
                  >
                    <UserPlus className="h-4 w-4" /> Order for a client
                  </button>
                )}
                <div className="flex gap-2">
                  {onShare && (
                    <button type="button" onClick={onShare} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-token-md border border-border bg-bg-surface py-2 text-xs font-bold text-text-primary hover:border-accent/40">
                      <Share2 className="h-3.5 w-3.5" /> Share
                    </button>
                  )}
                  {onMarketingImage && (
                    <button type="button" onClick={onMarketingImage} className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-token-md border border-border bg-bg-surface py-2 text-xs font-bold text-text-primary hover:border-accent/40">
                      <ImageDown className="h-3.5 w-3.5" /> Marketing image
                    </button>
                  )}
                </div>
              </div>
            )}
            <p className="flex items-start gap-1.5 text-[11px] text-text-faint">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              Your cost is set by your relationship manager. Prices are indicative; the final terms are confirmed by the RM on the deal confirmation.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-faint">{label}</p>
      <p className="mt-1 font-display text-xl font-bold tabular-nums text-text-primary">{value}</p>
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-text-secondary">{label}</span>
      <span className={`tabular-nums ${strong ? 'text-sm font-bold text-accent' : 'text-xs font-semibold text-text-primary'}`}>{value}</span>
    </div>
  );
}
