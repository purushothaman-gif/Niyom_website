/**
 * AuthShell — the shared frame for the client and partner sign-in screens.
 *
 * Both logins used to carry their own copy of the same two-column layout, and
 * the brand column argued for the product with three generic bullet points.
 * This puts the layout in one place and replaces the bullets with a picture of
 * what is behind the door: a portfolio for a client, a growing client book for
 * a partner. The partner side talks about growth and tooling, never about
 * commissions — that is deliberate.
 *
 * The preview figures are illustrative and say so on the card. Everything in
 * the trust strip is a checkable fact (the ARN is the one printed on the site
 * footer and on every statement) — a sign-in page is the last place to
 * decorate with claims.
 */
import type { ReactNode } from 'react';
import { Home, Loader2, Lock, Share2, ShieldCheck, TrendingUp, UserPlus, Users } from 'lucide-react';
import { ThemeToggle } from '../../theme/ThemeToggle';
import { HeroBackground } from '../../components/HeroBackground';
import { SUPPORT_EMAIL } from '../../../shared/support/contact';

export type AuthPortal = 'client' | 'partner';

const ARN = 'ARN-362707';

const COPY: Record<AuthPortal, { label: string; eyebrow: string; headline: string; sub: string }> = {
  client: {
    label: 'Client Portal',
    eyebrow: 'Your wealth, at a glance',
    headline: 'Every investment you own, in one place',
    sub: 'Mutual funds, bonds and unlisted shares — valued daily, with your real returns.',
  },
  partner: {
    label: 'Partner Portal',
    eyebrow: 'Technology that scales with you',
    headline: 'Grow your practice on a tech-first platform',
    sub: 'Onboard clients digitally, share ready-made offers in a tap, and watch your whole client book in real time.',
  },
};

export function AuthShell({ portal, children }: { portal: AuthPortal; children: ReactNode }) {
  const copy = COPY[portal];
  return (
    <div className="relative flex min-h-screen" style={{ background: 'var(--bg-base)' }}>
      {/* Brand column — always dark, whatever the page theme. */}
      <aside
        data-theme="dark"
        className="relative hidden w-[46%] max-w-[640px] flex-shrink-0 overflow-hidden lg:flex"
        style={{ borderRight: '1px solid var(--border-subtle)' }}
      >
        <HeroBackground />
        <div className="relative z-10 flex w-full flex-col justify-between p-10 xl:p-14">
          <a href="/" className="flex items-center gap-3">
            <img src="/niyomlogo.png" alt="Niyom Wealth" className="h-11 w-auto object-contain" />
            <span>
              <span className="block text-sm font-bold" style={{ color: 'var(--accent-soft)' }}>
                Niyom Wealth
              </span>
              <span className="block text-xs" style={{ color: 'var(--text-secondary)' }}>
                {copy.label}
              </span>
            </span>
          </a>

          <div className="space-y-8">
            <div>
              <p className="mb-3 text-xs uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
                {copy.eyebrow}
              </p>
              <h2 className="font-display text-3xl font-bold leading-tight text-text-primary xl:text-4xl">
                {copy.headline}
              </h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                {copy.sub}
              </p>
            </div>
            {portal === 'client' ? <PortfolioPreview /> : <PartnerPreview />}
          </div>

          <div className="space-y-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <p className="flex items-center gap-2">
              <ShieldCheck className="h-3.5 w-3.5 flex-shrink-0" style={{ color: 'var(--accent)' }} />
              AMFI Registered Mutual Fund Distributor · {ARN}
            </p>
            <p className="flex items-center gap-2">
              <Lock className="h-3.5 w-3.5 flex-shrink-0" style={{ color: 'var(--accent)' }} />
              {portal === 'client'
                ? 'Encrypted connection · automatic sign-out when you step away'
                : 'Encrypted connection · PAN-based sign-in'}
            </p>
          </div>
        </div>
      </aside>

      {/* Form column */}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-3 px-5 py-4 sm:px-8">
          <a href="/" className="flex items-center gap-2 lg:hidden">
            <img src="/niyomlogo.png" alt="Niyom Wealth" className="h-9 w-auto object-contain" />
          </a>
          <a
            href="/"
            className="hidden items-center gap-1.5 text-xs transition-colors hover:text-accent lg:inline-flex"
            style={{ color: 'var(--text-secondary)' }}
          >
            <Home className="h-3.5 w-3.5" /> Niyom Wealth home
          </a>
          <div className="flex items-center gap-2">
            <PortalSwitch portal={portal} />
            <ThemeToggle variant="icon" />
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center px-5 pb-8 pt-2 sm:px-8">
          <div className="w-full max-w-md">
            <div
              className="space-y-6 rounded-2xl p-6 shadow-token-card sm:p-8"
              style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}
            >
              {children}
            </div>
            <p className="mt-5 text-center text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
              {/* The brand column already carries this on wide screens. */}
              <span className="lg:hidden">
                AMFI Registered Mutual Fund Distributor · {ARN}
                <br />
              </span>
              Trouble signing in?{' '}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="font-semibold" style={{ color: 'var(--accent)' }}>
                {SUPPORT_EMAIL}
              </a>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}

/** Client ⇄ Partner. Plain links: each portal is its own route and session. */
function PortalSwitch({ portal }: { portal: AuthPortal }) {
  const items: { key: AuthPortal; label: string; href: string }[] = [
    { key: 'client', label: 'Client', href: '/client-login' },
    { key: 'partner', label: 'Partner', href: '/partner-login' },
  ];
  return (
    <nav
      aria-label="Choose portal"
      className="inline-flex rounded-full p-0.5"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)' }}
    >
      {items.map((i) => {
        const on = i.key === portal;
        return (
          <a
            key={i.key}
            href={i.href}
            aria-current={on ? 'page' : undefined}
            className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              on ? 'bg-accent text-on-accent' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {i.label}
          </a>
        );
      })}
    </nav>
  );
}

/** Heading block every view of the form card opens with. */
export function AuthHeading({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-xs uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
        {eyebrow}
      </p>
      <h1 className="font-display text-2xl font-bold tracking-tight text-text-primary sm:text-[28px]">{title}</h1>
      {sub && (
        <p className="mt-2 text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {sub}
        </p>
      )}
    </div>
  );
}

/** Two-or-three way segmented control for the sign-in method. */
export function AuthTabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { key: T; label: string }[];
  onChange: (key: T) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Sign-in method"
      className="grid gap-1 rounded-xl p-1"
      style={{
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(o.key)}
            className={`rounded-lg px-2 py-2 text-xs font-semibold transition-colors ${
              on ? 'text-text-primary shadow-token-sm' : 'text-text-secondary hover:text-text-primary'
            }`}
            style={on ? { background: 'var(--bg-elevated)', border: '1px solid var(--border)' } : { border: '1px solid transparent' }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** The primary action, with a spinner while it works. */
export function AuthSubmit({
  loading,
  disabled,
  loadingLabel,
  children,
}: {
  loading: boolean;
  disabled?: boolean;
  loadingLabel: string;
  children: ReactNode;
}) {
  return (
    <button
      type="submit"
      disabled={loading || disabled}
      className="press flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold text-on-accent transition-opacity disabled:opacity-50"
      style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
    >
      {loading ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {loadingLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ previews */

function PreviewCard({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative max-w-md rounded-2xl p-5 backdrop-blur-sm"
      style={{
        background: 'rgba(255,255,255,0.04)',
        border: '1px solid rgba(var(--accent-rgb),0.22)',
        boxShadow: '0 24px 60px -24px rgba(0,0,0,0.6)',
      }}
      aria-hidden
    >
      <span
        className="absolute right-4 top-4 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider"
        style={{ background: 'rgba(var(--accent-rgb),0.12)', color: 'var(--accent-soft)' }}
      >
        Illustration
      </span>
      {children}
    </div>
  );
}

const ALLOCATION = [
  { label: 'Mutual funds', pct: 52, color: 'var(--accent)' },
  { label: 'Bonds', pct: 31, color: '#5B8DEF' },
  { label: 'Unlisted shares', pct: 17, color: '#4FC59A' },
];

function PortfolioPreview() {
  return (
    <PreviewCard>
      <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        Portfolio value
      </p>
      <p className="mt-1 font-display text-3xl font-bold tabular-nums text-text-primary">₹24,59,550</p>
      <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold" style={{ color: '#4FC59A' }}>
        <TrendingUp className="h-3.5 w-3.5" /> +₹3,09,454 · 14.39% total return
      </p>

      <svg viewBox="0 0 320 64" className="mt-4 h-16 w-full" preserveAspectRatio="none">
        <defs>
          <linearGradient id="auth-spark" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d="M0 52 L28 48 L56 50 L84 40 L112 43 L140 34 L168 36 L196 26 L224 29 L252 18 L280 20 L320 8 L320 64 L0 64 Z"
          fill="url(#auth-spark)"
        />
        <path
          d="M0 52 L28 48 L56 50 L84 40 L112 43 L140 34 L168 36 L196 26 L224 29 L252 18 L280 20 L320 8"
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2"
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      <div className="mt-4 flex h-1.5 overflow-hidden rounded-full">
        {ALLOCATION.map((a) => (
          <span key={a.label} style={{ width: `${a.pct}%`, background: a.color }} />
        ))}
      </div>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
        {ALLOCATION.map((a) => (
          <li key={a.label} className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: a.color }} />
            {a.label} {a.pct}%
          </li>
        ))}
      </ul>
    </PreviewCard>
  );
}

function PartnerPreview() {
  const rows = [
    { icon: Users, label: 'Clients on your book', value: '42 · 37 active' },
    { icon: UserPlus, label: 'Digital onboarding', value: 'From your portal' },
    { icon: Share2, label: 'Offers ready to share', value: 'Links & images' },
  ];
  return (
    <PreviewCard>
      <p className="text-[11px]" style={{ color: 'var(--text-secondary)' }}>
        Client book value
      </p>
      <p className="mt-1 font-display text-3xl font-bold tabular-nums text-text-primary">₹6.8 Cr</p>
      <p className="mt-1 flex items-center gap-1.5 text-xs font-semibold" style={{ color: '#4FC59A' }}>
        <TrendingUp className="h-3.5 w-3.5" /> Growing across bonds, funds and unlisted shares
      </p>
      <ul className="mt-4 divide-y" style={{ borderTop: '1px dashed rgba(255,255,255,0.12)', borderColor: 'rgba(255,255,255,0.08)' }}>
        {rows.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-3 py-2.5" style={{ borderColor: 'rgba(255,255,255,0.08)' }}>
            <span className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              <r.icon className="h-3.5 w-3.5" style={{ color: 'var(--accent)' }} />
              {r.label}
            </span>
            <span className="text-xs font-semibold tabular-nums text-text-primary">{r.value}</span>
          </li>
        ))}
      </ul>
    </PreviewCard>
  );
}
