import { ChevronRight, FileText, Landmark, Lock, PackagePlus, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ConnectInbox } from './ConnectInbox';
import { ForwardCasCard } from './ForwardCasCard';

/**
 * Import my portfolio — the one door into every way of bringing outside
 * investments in.
 *
 * ## Why a hub
 *
 * The four routes (statement request, demat OTP, connected mailbox, forwarding
 * address) were built one at a time and each landed wherever it was built: one
 * under the Mutual Funds menu, three as separate rows on My Portfolio. A client
 * had to already know they existed. Here they sit side by side, described by
 * what they bring in rather than by how they work, so the choice is "which of
 * my investments are missing" and not "which mechanism do I want".
 *
 * The hub only chooses; the wizards it opens are unchanged and still owned by
 * PortalApp. The two email routes are light enough to live inline, and each
 * hides itself when the server cannot offer it.
 */
interface Props {
  onClose: () => void;
  /** Opens the mutual fund statement wizard. */
  onMutualFunds: () => void;
  /** Opens the demat OTP flow; absent when the server cannot fetch demat. */
  onDemat?: () => void;
  /** Refresh the portfolio after an email route imports something. */
  onImported: () => void;
}

const COVERS = ['Mutual funds', 'Shares', 'Bonds', 'G-Secs', 'ETFs', 'NPS'];

export function ImportHubModal({ onClose, onMutualFunds, onDemat, onImported }: Props) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-hub-title"
    >
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-token-xl border border-border bg-modal shadow-token-lg">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-modal px-6 py-4">
          <div className="flex items-center gap-2">
            <PackagePlus className="h-4 w-4 text-accent" />
            <h3 id="import-hub-title" className="text-sm font-bold text-text-primary">
              Import my portfolio
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-text-secondary hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 p-6">
          <div>
            <p className="font-display text-xl font-bold tracking-tight text-text-primary">
              Everything you own, in one basket
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-text-muted">
              Bring in what you hold through other apps, banks and brokers and see it alongside
              your Niyom investments — one value, one return.
            </p>
            {/* Only promised when the demat route is really on offer. */}
            {onDemat && (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {COVERS.map((c) => (
                  <li
                    key={c}
                    className="rounded-full border border-border bg-bg-surface px-2.5 py-1 text-[11px] font-semibold text-text-secondary"
                  >
                    {c}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2.5">
            <HubOption
              icon={FileText}
              title="Mutual funds"
              body="We request your Consolidated Account Statement for you. It covers every fund house, with full transaction history."
              meta="About 5 minutes"
              onClick={onMutualFunds}
              primary
            />
            {onDemat && (
              <HubOption
                icon={Landmark}
                title="Shares, bonds, ETFs and NPS"
                body="Fetch your demat holdings from the depository with a one-time password sent to your phone."
                meta="About 1 minute"
                onClick={onDemat}
              />
            )}
          </div>

          {/* Each renders nothing until it knows the server offers it. */}
          <div className="space-y-2.5">
            <ConnectInbox onImported={onImported} />
            <ForwardCasCard onImported={onImported} />
          </div>

          <p className="flex items-start gap-2 border-t border-border-subtle pt-4 text-[11px] leading-relaxed text-text-faint">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Read-only. We read your statements to show your holdings and never store the files or
            your statement password. Nothing here can move or sell your investments.
          </p>
        </div>
      </div>
    </div>
  );
}

function HubOption({
  icon: Icon,
  title,
  body,
  meta,
  onClick,
  primary = false,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  meta: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`press group flex w-full items-center gap-3.5 rounded-token-lg border px-4 py-3.5 text-left transition-colors ${
        primary
          ? 'border-accent/40 bg-accent/5 hover:border-accent/70'
          : 'border-border bg-card hover:border-accent/40'
      }`}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-token-md bg-accent/10">
        <Icon className="h-5 w-5 text-accent" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-bold text-text-primary">{title}</span>
          <span className="text-[11px] text-text-faint">{meta}</span>
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">{body}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-text-faint transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}
