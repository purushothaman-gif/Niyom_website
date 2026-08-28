// Bond detail (Jiraaf-style): hero stat bar + section nav on the left, a sticky
// "Select Units" invest sidebar on the right. The client picks a quantity (in
// min-investment lots) and proceeds to the order review. All figures are the
// client's indicative marked-up price; the RM finalises on the deal confirmation.

import { useMemo, useState } from 'react';
import { ArrowLeft, Minus, Plus, Landmark, ShieldCheck, ArrowRight } from 'lucide-react';
import { inr, pct, shortDate } from '../../../lib/money';
import { Card } from '../../components/Card';
import { StatusPill } from '../../components/StatusPill';
import { Figure } from '../../ui/kit';
import type { ClientBond } from '../../../../shared/portal/services/BondOrderService';
import { breakdown, minUnits, stepUnits, tenureLabel } from './bondMath';

type Section = 'summary' | 'details';

function cap(s: string | null | undefined): string {
  if (!s) return '—';
  return s.length <= 4 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export function BondDetailPage({
  bond,
  onBack,
  onInvest,
  canInvest,
}: {
  bond: ClientBond;
  onBack: () => void;
  onInvest: (units: number) => void;
  canInvest: boolean;
}) {
  const min = minUnits(bond);
  const step = stepUnits(bond);
  const [units, setUnits] = useState(min);
  const [section, setSection] = useState<Section>('summary');

  const bd = useMemo(() => breakdown(bond, units), [bond, units]);
  const dec = () => setUnits((u) => Math.max(min, u - step));
  const inc = () => setUnits((u) => u + step);

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
    ['Principal repayment', cap(bond.principal_repayment_structure)],
    ['Day-count convention', bond.day_count_convention || '—'],
    ['Rating', bond.rating ? `${bond.rating}${bond.rating_agency ? ` · ${bond.rating_agency}` : ''}` : '—'],
    ['Tax status', cap(bond.tax_status)],
    ['Trustee', bond.trustee || '—'],
    ['Issue date', shortDate(bond.issue_date)],
  ];

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-accent"
      >
        <ArrowLeft className="h-4 w-4" /> Back to bonds
      </button>

      {/* Hero */}
      <Card accent padding="lg">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-token-lg bg-accent/10">
              <Landmark className="h-5 w-5 text-accent" />
            </span>
            <div className="min-w-0">
              <h1 className="font-display text-lg font-bold leading-tight text-text-primary">
                {bond.bond_name || bond.issuer_name || bond.isin}
              </h1>
              <p className="mt-0.5 text-xs text-text-faint">{bond.issuer_name || ''} · {bond.isin}</p>
            </div>
          </div>
          {bond.rating && <StatusPill tone="accent">{bond.rating}</StatusPill>}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Figure label="Yield (YTM)" value={bond.analytics?.ytm != null ? pct(bond.analytics.ytm) : pct(bond.coupon_rate ?? 0)} />
          <Figure label="Coupon" value={pct(bond.coupon_rate ?? 0)} />
          <Figure label="Tenure" value={tenureLabel(bond)} />
          <Figure label="Min. Investment" value={inr((Number(bond.min_investment) || Number(bond.face_value) || 0))} />
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* Left: sections */}
        <div className="space-y-4">
          <div className="flex gap-1.5">
            {(['summary', 'details'] as Section[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setSection(s)}
                className={`rounded-token-md border px-3.5 py-2 text-xs font-semibold transition-colors ${
                  section === s
                    ? 'border-accent/30 bg-selected text-accent'
                    : 'border-border bg-bg-raised text-text-muted hover:text-text-primary'
                }`}
              >
                {s === 'summary' ? 'Summary' : 'Other details'}
              </button>
            ))}
          </div>

          <Card padding="md">
            <dl className="divide-y divide-border-subtle">
              {(section === 'summary' ? summaryRows : detailRows).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-xs text-text-secondary">{k}</dt>
                  <dd className="text-right text-xs font-semibold text-text-primary">{v}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <p className="flex items-start gap-1.5 text-[11px] text-text-faint">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            Figures are indicative and per your approved pricing. Your relationship manager confirms the final terms (including stamp duty and settlement) on the deal confirmation.
          </p>
        </div>

        {/* Right: Select Units invest sidebar */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <Card padding="md" className="space-y-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-text-faint">Select units</p>
              <p className="mt-0.5 text-[11px] text-text-muted">
                {inr(bond.face_value ?? 0)} face each · min {min} unit{min === 1 ? '' : 's'}
              </p>
            </div>

            <div className="flex items-center justify-between rounded-token-lg border border-border bg-bg-surface p-2">
              <button
                type="button"
                onClick={dec}
                disabled={units <= min}
                className="flex h-9 w-9 items-center justify-center rounded-token-md border border-border bg-bg-elevated text-text-primary disabled:opacity-40"
                aria-label="Decrease units"
              >
                <Minus className="h-4 w-4" />
              </button>
              <div className="text-center">
                <p className="font-display text-2xl font-bold tabular-nums text-text-primary">{units}</p>
                <p className="text-[10px] text-text-faint">units</p>
              </div>
              <button
                type="button"
                onClick={inc}
                className="flex h-9 w-9 items-center justify-center rounded-token-md border border-border bg-bg-elevated text-text-primary"
                aria-label="Increase units"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2 rounded-token-lg bg-bg-surface p-3">
              <Row label="Price / ₹100" value={inr(bd.pricePer100)} />
              <Row label="Investment amount" value={inr(bd.investment)} />
              {bd.accrued > 0 && <Row label="Accrued interest" value={inr(bd.accrued)} />}
              <div className="border-t border-border-subtle pt-2">
                <Row label="Amount payable" value={inr(bd.amountPayable)} strong />
              </div>
              {bd.estMaturityValue != null && (
                <Row label="Est. total inflows" value={inr(bd.estMaturityValue)} tone="positive" />
              )}
            </div>

            <button
              type="button"
              disabled={!canInvest}
              onClick={() => onInvest(units)}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-token-md py-3 text-sm font-bold text-on-accent disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
            >
              Review order <ArrowRight className="h-4 w-4" />
            </button>
            {!canInvest && (
              <p className="text-center text-[11px] text-text-muted">
                Complete your onboarding to place an order.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  tone = 'default',
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: 'default' | 'positive';
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-text-secondary">{label}</span>
      <span
        className={`tabular-nums ${strong ? 'text-sm font-bold' : 'text-xs font-semibold'} ${
          tone === 'positive' ? 'text-success' : 'text-text-primary'
        }`}
      >
        {value}
      </span>
    </div>
  );
}
