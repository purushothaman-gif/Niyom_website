// Public bond-offer landing (/bond-offer?t=<token>) — the page a partner's shared
// link opens. Shows the bond at the PARTNER'S price + a request-to-invest form.
// Fully public: resolves the token and submits through the service-role edge
// functions (resolve-bond-share / submit-bond-offer). The partner's cost is never
// fetched or shown.

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Landmark, ShieldCheck, CheckCircle2, Loader2, Minus, Plus } from 'lucide-react';
import { inr, pct, shortDate } from '../lib/money';

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface OfferBond {
  isin: string;
  bond_name: string | null;
  issuer_name: string | null;
  coupon_rate: number | null;
  coupon_type: string | null;
  coupon_frequency: string | null;
  maturity_date: string | null;
  next_coupon_date: string | null;
  rating: string | null;
  rating_agency: string | null;
  security_type: string | null;
  tax_status: string | null;
  min_investment: number | null;
  face_value: number | null;
  price_per_100: number | null;
  analytics: { ytm?: number | null; years_to_maturity?: number | null; accrued_per_100?: number | null } | null;
}

function tenure(b: OfferBond): string {
  const y = b.analytics?.years_to_maturity;
  if (y != null && Number.isFinite(y)) return y < 1 ? `${Math.max(1, Math.round(y * 12))} mo` : `${(Math.round(y * 10) / 10).toFixed(1)} yr`;
  return '—';
}
const cap = (s: string | null | undefined) => !s ? '—' : (s.length <= 4 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase());

export default function BondOffer() {
  const [params] = useSearchParams();
  const token = params.get('t') || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bond, setBond] = useState<OfferBond | null>(null);
  const [partnerName, setPartnerName] = useState<string>('');

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [units, setUnits] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ outcome: string; ref?: string; lead_code?: string } | null>(null);

  useEffect(() => {
    if (!token) { setError('This link is not valid.'); setLoading(false); return; }
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${SUPA_URL}/functions/v1/resolve-bond-share`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
          body: JSON.stringify({ token }),
        });
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok || !body?.bond) { setError(body?.error || 'This link is not valid.'); }
        else {
          setBond(body.bond as OfferBond);
          setPartnerName(body.partner_name || '');
          const face = Number(body.bond.face_value) || 100;
          const min = Math.max(1, Math.ceil((Number(body.bond.min_investment) || face) / face));
          setUnits(min);
        }
      } catch {
        if (alive) setError('Could not open this offer. Please try again.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [token]);

  const face = Number(bond?.face_value) || 100;
  const minUnits = Math.max(1, Math.ceil((Number(bond?.min_investment) || face) / face));
  const price = Number(bond?.price_per_100) || 0;
  const accruedPer100 = Number(bond?.analytics?.accrued_per_100) || 0;
  const amount = useMemo(() => {
    const inv = units * face * (price / 100);
    const acc = units * face * (accruedPer100 / 100);
    return Math.round((inv + acc + Number.EPSILON) * 100) / 100;
  }, [units, face, price, accruedPer100]);

  const canSubmit = name.trim().length >= 2 && /^\d{10}$/.test(mobile.replace(/\D/g, '')) && units >= minUnits && !submitting;

  const submit = async () => {
    setSubmitting(true); setSubmitErr(null);
    try {
      const res = await fetch(`${SUPA_URL}/functions/v1/submit-bond-offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
        body: JSON.stringify({ token, full_name: name.trim(), mobile: mobile.replace(/\D/g, ''), email: email.trim(), units }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body?.success) setSubmitErr(body?.error || 'Could not submit your request.');
      else setDone({ outcome: body.outcome, ref: body.ref, lead_code: body.lead_code });
    } catch {
      setSubmitErr('Could not submit your request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <Shell><div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-accent" /></div></Shell>;
  if (error || !bond) return (
    <Shell>
      <div className="mx-auto max-w-md rounded-token-xl border border-border bg-bg-elevated p-8 text-center">
        <Landmark className="mx-auto mb-3 h-8 w-8 text-text-faint" />
        <p className="text-base font-semibold text-text-primary">{error || 'This offer is unavailable.'}</p>
        <p className="mt-1 text-sm text-text-muted">Please ask your advisor for a fresh link.</p>
      </div>
    </Shell>
  );

  if (done) return (
    <Shell>
      <div className="mx-auto max-w-md rounded-token-xl border border-border bg-bg-elevated p-8 text-center">
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10"><CheckCircle2 className="h-7 w-7 text-success" /></span>
        <h2 className="font-display text-xl font-bold text-text-primary">Request received</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm text-text-secondary">
          Thank you, {name.trim()}. {partnerName || 'Your advisor'}’s team will contact you shortly to confirm the details and complete your investment
          {done.ref ? <> (reference <span className="font-semibold text-text-primary">{done.ref}</span>)</> : done.lead_code ? <> (reference <span className="font-semibold text-text-primary">{done.lead_code}</span>)</> : null}.
        </p>
      </div>
    </Shell>
  );

  return (
    <Shell partner={partnerName}>
      <div className="mx-auto grid max-w-4xl gap-5 lg:grid-cols-[1fr_360px]">
        {/* Bond */}
        <div className="space-y-4">
          <div className="relative rounded-token-xl border border-border bg-bg-elevated p-6 shadow-token-card">
            <span aria-hidden className="absolute left-0 top-5 bottom-5 w-1 rounded-full bg-accent" />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1 className="font-display text-lg font-bold leading-tight text-text-primary">{bond.bond_name || bond.issuer_name || bond.isin}</h1>
                <p className="mt-0.5 text-xs text-text-faint">{bond.issuer_name || ''} · {bond.isin}</p>
              </div>
              {bond.rating && <span className="rounded-token-sm border border-accent/20 bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">{bond.rating}</span>}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Fig label="Yield (YTM)" value={bond.analytics?.ytm != null ? pct(bond.analytics.ytm) : pct(bond.coupon_rate ?? 0)} />
              <Fig label="Coupon" value={pct(bond.coupon_rate ?? 0)} />
              <Fig label="Tenure" value={tenure(bond)} />
              <Fig label="Min. Investment" value={inr(bond.min_investment ?? bond.face_value ?? 0)} />
            </div>
          </div>
          <div className="rounded-token-xl border border-border bg-bg-elevated p-5 shadow-token-card">
            <dl className="divide-y divide-border-subtle">
              {([
                ['Interest payment', cap(bond.coupon_frequency)],
                ['Coupon type', cap(bond.coupon_type)],
                ['Face value', inr(bond.face_value ?? 0)],
                ['Maturity', shortDate(bond.maturity_date)],
                ['Security', cap(bond.security_type)],
                ['Tax status', cap(bond.tax_status)],
                ['Rating', bond.rating ? `${bond.rating}${bond.rating_agency ? ` · ${bond.rating_agency}` : ''}` : '—'],
              ] as Array<[string, string]>).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-xs text-text-secondary">{k}</dt><dd className="text-right text-xs font-semibold text-text-primary">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* Request form */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="space-y-4 rounded-token-xl border border-border bg-bg-elevated p-5 shadow-token-card">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-text-faint">Request to invest</p>
              <p className="mt-0.5 text-[11px] text-text-muted">Price {inr(price)} / ₹100 · {inr(face)} face per unit</p>
            </div>
            <div className="flex items-center justify-between rounded-token-lg border border-border bg-bg-surface p-2">
              <button type="button" onClick={() => setUnits((u) => Math.max(minUnits, u - minUnits))} disabled={units <= minUnits} className="flex h-9 w-9 items-center justify-center rounded-token-md border border-border bg-bg-elevated text-text-primary disabled:opacity-40"><Minus className="h-4 w-4" /></button>
              <div className="text-center"><p className="font-display text-2xl font-bold tabular-nums text-text-primary">{units}</p><p className="text-[10px] text-text-faint">units</p></div>
              <button type="button" onClick={() => setUnits((u) => u + minUnits)} className="flex h-9 w-9 items-center justify-center rounded-token-md border border-border bg-bg-elevated text-text-primary"><Plus className="h-4 w-4" /></button>
            </div>
            <div className="flex items-center justify-between rounded-token-lg bg-bg-surface px-3 py-2.5">
              <span className="text-xs text-text-secondary">Indicative amount</span>
              <span className="text-sm font-bold tabular-nums text-text-primary">{inr(amount)}</span>
            </div>

            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name"
              className="w-full rounded-token-md border border-border bg-bg-surface px-3 py-2.5 text-sm text-text-primary outline-none" />
            <input value={mobile} onChange={(e) => setMobile(e.target.value)} inputMode="numeric" placeholder="Mobile number"
              className="w-full rounded-token-md border border-border bg-bg-surface px-3 py-2.5 text-sm text-text-primary outline-none" />
            <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email (optional)"
              className="w-full rounded-token-md border border-border bg-bg-surface px-3 py-2.5 text-sm text-text-primary outline-none" />

            {submitErr && <div className="rounded-token-md border border-danger-soft/20 bg-danger-soft/10 p-3 text-xs text-danger-soft">{submitErr}</div>}

            <button type="button" disabled={!canSubmit} onClick={submit}
              className="w-full rounded-token-md py-3 text-sm font-bold text-on-accent disabled:opacity-50"
              style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
              {submitting ? 'Submitting…' : 'Request to invest'}
            </button>
            <p className="flex items-start gap-1.5 text-[11px] text-text-faint">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              No payment now. {partnerName || 'Your advisor'}’s relationship manager will confirm the terms and guide you through the investment.
            </p>
          </div>
        </div>
      </div>
    </Shell>
  );
}

function Shell({ children, partner }: { children: React.ReactNode; partner?: string }) {
  return (
    <div className="min-h-screen bg-bg-base px-4 py-8 sm:px-6">
      <div className="mx-auto mb-6 flex max-w-4xl items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-token-lg bg-accent/10"><Landmark className="h-5 w-5 text-accent" /></span>
          <div>
            <p className="font-display text-sm font-bold text-text-primary">Niyom Wealth</p>
            {partner && <p className="text-[11px] text-text-faint">Presented by {partner}</p>}
          </div>
        </div>
      </div>
      {children}
      <p className="mx-auto mt-8 max-w-4xl text-center text-[11px] leading-relaxed text-text-faint">
        Investments in bonds are subject to market, credit and interest-rate risks, including loss of principal. Rates are indicative.
        Niyom Wealth Distribution LLP acts as a distributor.
      </p>
    </div>
  );
}

function Fig({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-text-faint">{label}</p>
      <p className="mt-1 font-display text-xl font-bold tabular-nums text-text-primary">{value}</p>
    </div>
  );
}
