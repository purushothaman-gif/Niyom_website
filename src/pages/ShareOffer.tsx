// Public unlisted-share offer landing (/share-offer?t=<token>) — the page a
// partner's shared link opens. Shows the share at the PARTNER'S price + a
// request-to-buy form. Fully public: resolves the token and submits through the
// service-role edge functions (resolve-share-offer / submit-share-offer). The
// partner's cost and Niyom's base price are never fetched, so they cannot leak.

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Gem, ShieldCheck, CheckCircle2, Loader2, Minus, Plus } from 'lucide-react';
import { inr } from '../lib/money';
import { ShareLogo } from '../components/ShareLogo';

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

interface OfferShare {
  isin: string;
  company_name: string;
  short_name: string | null;
  sector: string | null;
  about: string | null;
  logo_url: string | null;
  website: string | null;
  face_value: number | null;
  lot_size: number | null;
  min_qty: number | null;
  price_per_share: number | null;
}

export default function ShareOffer() {
  const [params] = useSearchParams();
  const token = params.get('t') || '';

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [share, setShare] = useState<OfferShare | null>(null);
  const [partnerName, setPartnerName] = useState<string>('');

  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [email, setEmail] = useState('');
  const [qty, setQty] = useState(1);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ outcome: string; ref?: string; lead_code?: string } | null>(null);

  useEffect(() => {
    if (!token) { setError('This link is not valid.'); setLoading(false); return; }
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${SUPA_URL}/functions/v1/resolve-share-offer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
          body: JSON.stringify({ token }),
        });
        const body = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok || !body?.share) {
          setError(body?.error || 'This link is not valid.');
        } else {
          setShare(body.share as OfferShare);
          setPartnerName(body.partner_name || '');
          setQty(Math.max(1, Math.round(Number(body.share.min_qty) || 1)));
        }
      } catch {
        if (alive) setError('Could not open this offer. Please try again.');
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [token]);

  const minQty = Math.max(1, Math.round(Number(share?.min_qty) || 1));
  const step = Math.max(1, Math.round(Number(share?.lot_size) || 1));
  const price = Number(share?.price_per_share) || 0;
  const amount = useMemo(() => Math.round((qty * price + Number.EPSILON) * 100) / 100, [qty, price]);

  const canSubmit =
    name.trim().length >= 2 && /^\d{10}$/.test(mobile.replace(/\D/g, '')) && qty >= minQty && !submitting;

  const submit = async () => {
    setSubmitting(true);
    setSubmitErr(null);
    try {
      const res = await fetch(`${SUPA_URL}/functions/v1/submit-share-offer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
        body: JSON.stringify({ token, full_name: name.trim(), mobile: mobile.replace(/\D/g, ''), email: email.trim(), qty }),
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

  if (loading) {
    return <Shell><div className="flex justify-center py-24"><Loader2 className="h-7 w-7 animate-spin text-accent" /></div></Shell>;
  }

  if (error || !share) {
    return (
      <Shell>
        <div className="mx-auto max-w-md rounded-token-xl border border-border bg-bg-elevated p-8 text-center">
          <Gem className="mx-auto mb-3 h-8 w-8 text-text-faint" />
          <p className="text-base font-semibold text-text-primary">{error || 'This offer is unavailable.'}</p>
          <p className="mt-1 text-sm text-text-muted">Please ask your advisor for a fresh link.</p>
        </div>
      </Shell>
    );
  }

  if (done) {
    return (
      <Shell>
        <div className="mx-auto max-w-md rounded-token-xl border border-border bg-bg-elevated p-8 text-center">
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-success/10">
            <CheckCircle2 className="h-7 w-7 text-success" />
          </span>
          <h2 className="font-display text-xl font-bold text-text-primary">Request received</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-text-secondary">
            Thank you, {name.trim()}. {partnerName || 'Your advisor'}’s team will contact you shortly to confirm
            availability and complete your purchase
            {done.ref ? <> (reference <span className="font-semibold text-text-primary">{done.ref}</span>)</>
              : done.lead_code ? <> (reference <span className="font-semibold text-text-primary">{done.lead_code}</span>)</>
              : null}.
          </p>
        </div>
      </Shell>
    );
  }

  const displayName = share.short_name || share.company_name;

  return (
    <Shell partner={partnerName}>
      <div className="mx-auto grid max-w-4xl gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <div className="relative rounded-token-xl border border-border bg-bg-elevated p-6 shadow-token-card">
            <span aria-hidden className="absolute left-0 top-5 bottom-5 w-1 rounded-full bg-accent" />
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <ShareLogo name={displayName} url={share.logo_url} size={48} />
                <div className="min-w-0">
                  <h1 className="font-display text-lg font-bold leading-tight text-text-primary">{displayName}</h1>
                  <p className="mt-0.5 text-xs text-text-faint">{share.company_name} · {share.isin}</p>
                </div>
              </div>
              {share.sector && (
                <span className="rounded-token-sm border border-accent/20 bg-accent/10 px-2 py-0.5 text-xs font-semibold text-accent">
                  {share.sector}
                </span>
              )}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <Fig label="Price / share" value={inr(price)} />
              <Fig label="Min. quantity" value={String(minQty)} />
              <Fig label="Min. investment" value={inr(price * minQty)} />
            </div>
          </div>

          {share.about && (
            <div className="rounded-token-xl border border-border bg-bg-elevated p-5 shadow-token-card">
              <h2 className="mb-2 text-sm font-bold text-text-primary">About the company</h2>
              <p className="whitespace-pre-line text-sm leading-relaxed text-text-secondary">{share.about}</p>
            </div>
          )}

          <div className="rounded-token-xl border border-border bg-bg-elevated p-5 shadow-token-card">
            <dl className="divide-y divide-border-subtle">
              {([
                ['ISIN', share.isin || '—'],
                ['Company', share.company_name || '—'],
                ['Sector', share.sector || '—'],
                ['Face value', share.face_value != null ? inr(share.face_value) : '—'],
                ['Minimum quantity', `${minQty} share${minQty === 1 ? '' : 's'}`],
                ['Lot size', `${step} share${step === 1 ? '' : 's'}`],
              ] as Array<[string, string]>).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between gap-3 py-2.5">
                  <dt className="text-xs text-text-secondary">{k}</dt>
                  <dd className="text-right text-xs font-semibold text-text-primary">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>

        {/* Request form */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          <div className="space-y-4 rounded-token-xl border border-border bg-bg-elevated p-5 shadow-token-card">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-text-faint">Request to buy</p>
              <p className="mt-0.5 text-[11px] text-text-muted">
                {inr(price)} per share · minimum {minQty}, in steps of {step}
              </p>
            </div>

            <div className="flex items-center justify-between rounded-token-lg border border-border bg-bg-surface p-2">
              <button type="button" onClick={() => setQty((q) => Math.max(minQty, q - step))} disabled={qty <= minQty}
                className="flex h-9 w-9 items-center justify-center rounded-token-md border border-border bg-bg-elevated text-text-primary disabled:opacity-40"
                aria-label="Decrease quantity">
                <Minus className="h-4 w-4" />
              </button>
              <div className="text-center">
                <p className="font-display text-2xl font-bold tabular-nums text-text-primary">{qty}</p>
                <p className="text-[10px] text-text-faint">shares</p>
              </div>
              <button type="button" onClick={() => setQty((q) => q + step)}
                className="flex h-9 w-9 items-center justify-center rounded-token-md border border-border bg-bg-elevated text-text-primary"
                aria-label="Increase quantity">
                <Plus className="h-4 w-4" />
              </button>
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
              {submitting ? 'Submitting…' : 'Request to buy'}
            </button>

            <p className="flex items-start gap-1.5 text-[11px] text-text-faint">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              No payment now. {partnerName || 'Your advisor'}’s relationship manager will confirm availability and the
              terms, and guide you through the purchase.
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
          <span className="flex h-9 w-9 items-center justify-center rounded-token-lg bg-accent/10">
            <Gem className="h-5 w-5 text-accent" />
          </span>
          <div>
            <p className="font-display text-sm font-bold text-text-primary">Niyom Wealth</p>
            {partner && <p className="text-[11px] text-text-faint">Presented by {partner}</p>}
          </div>
        </div>
      </div>
      {children}
      <p className="mx-auto mt-8 max-w-4xl text-center text-[11px] leading-relaxed text-text-faint">
        Unlisted shares are not traded on a stock exchange. They carry liquidity, valuation and issuer risks including
        loss of principal, there is no assurance of a listing, and prices are indicative and settled off-market.
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
