import { useState } from 'react';
import { Check, Copy, MessageCircle, PackagePlus } from 'lucide-react';

/**
 * Invite a client to import their outside holdings.
 *
 * A partner cannot run the import for a client, and should not be able to: the
 * statement is locked to the client's PAN and the demat fetch is authorised by
 * an OTP on the client's own phone. What the partner can do is send the client
 * straight to the right door — the link signs them in and opens the import hub
 * (`?import=1`, read by PortalApp).
 *
 * The copy promises only what is true today: the client sees everything in
 * their own portal. Imported holdings are not in the partner's client book —
 * nw_partner_client_portfolio reads what was bought through us — so nothing
 * here says they will be.
 */
const inviteLink = () => `${window.location.origin}/client-login?import=1`;

const inviteText = (link: string) =>
  `See all your investments in one place on Niyom Wealth. Sign in and import your mutual funds, shares, bonds and NPS held elsewhere — it takes a few minutes:\n${link}`;

export function InviteImportCard() {
  const [copied, setCopied] = useState(false);
  const link = inviteLink();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — the link is on screen to copy by hand */
    }
  };

  return (
    <section className="relative overflow-hidden rounded-token-xl border border-accent/30 bg-card p-5 shadow-token-card">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full opacity-[0.09]"
        style={{ background: 'radial-gradient(circle, var(--accent) 0%, transparent 70%)' }}
      />
      <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-token-lg bg-accent/10">
            <PackagePlus className="h-5 w-5 text-accent" />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-bold tracking-tight text-text-primary">
              Help your clients see everything they own in one place
            </h2>
            <p className="mt-1 max-w-xl text-sm leading-relaxed text-text-secondary">
              Send this link to a client. They sign in and import the mutual funds, shares, bonds
              and NPS they hold elsewhere, alongside what they bought through you.
            </p>
            <code className="mt-2 block truncate text-[11px] text-text-faint">{link}</code>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            onClick={copy}
            className="press inline-flex items-center gap-2 rounded-token-md px-4 py-2.5 text-sm font-bold text-on-accent"
            style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy invite link'}
          </button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(inviteText(link))}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-token-md border border-border bg-bg-surface px-4 py-2.5 text-sm font-semibold text-text-primary transition-colors hover:text-accent"
          >
            <MessageCircle className="h-4 w-4" /> WhatsApp
          </a>
        </div>
      </div>
    </section>
  );
}
