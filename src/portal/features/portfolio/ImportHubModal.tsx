import { useState, type ReactNode } from 'react';
import {
  CheckCircle2, ChevronLeft, ChevronRight, FileText, Landmark, Lock, Mail, PackagePlus, Upload, Zap, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ConnectInbox } from './ConnectInbox';
import { ForwardCasCard } from './ForwardCasCard';

/**
 * Import my portfolio — one guided door into every way of bringing outside
 * investments in, modelled on the way the depositories actually work.
 *
 * ## The flow
 *
 *   choose ─┬─ Mutual funds ──────────────► methods (MF)
 *           └─ Stocks & demat ─┬─ (depository known) ─► methods (demat)
 *                              └─ which depository?  ─► methods (demat)
 *
 * Each methods screen is split the way CASParser's own flow is: "Get it for me"
 * (we fetch or request it) and "I have the file" (you hand us a statement).
 * Which fetch options appear depends on the depository, because only CDSL can be
 * pulled by OTP — an NSDL-first statement has no fetch rail and must come by
 * email/forward (we parse it the same either way).
 *
 * We know most clients' depository from the demat account on file, so we skip
 * the picker and jump straight to their methods; the picker is the fallback when
 * we don't. The wizards each option opens are unchanged and owned by PortalApp;
 * the two email routes (inbox, forward) are self-contained cards that hide
 * themselves when the server can't offer them.
 */
type Depository = 'cdsl' | 'nsdl';
type Screen = 'choose' | 'mf' | 'depository' | 'demat';

interface Props {
  onClose: () => void;
  /** Opens the mutual-fund CAS request wizard ("email me a fresh CAS"). */
  onMutualFunds: () => void;
  /** Opens the import modal straight on its upload step ("I have the file"). */
  onUpload: () => void;
  /** Opens the CDSL demat OTP flow; absent when the server can't fetch demat. */
  onDemat?: () => void;
  /** The client's depository, inferred from their demat account on file. */
  depositoryHint?: Depository | null;
  /** Whether the server offers the two email routes, resolved up front so the
   *  sheet opens at its final size instead of growing as the cards load. */
  inboxEnabled: boolean;
  forwardEnabled: boolean;
  /** The client just returned from connecting their inbox — show a success
   *  banner guiding them to Sync now. */
  justConnectedInbox?: boolean;
  /** Refresh the portfolio after an email route imports something. */
  onImported: () => void;
}

export function ImportHubModal({
  onClose,
  onMutualFunds,
  onUpload,
  onDemat,
  depositoryHint,
  inboxEnabled,
  forwardEnabled,
  justConnectedInbox,
  onImported,
}: Props) {
  const [screen, setScreen] = useState<Screen>('choose');
  const [depo, setDepo] = useState<Depository | null>(depositoryHint ?? null);

  const openDemat = () => {
    if (depositoryHint) {
      setDepo(depositoryHint);
      setScreen('demat');
    } else {
      setScreen('depository');
    }
  };

  const back = () => {
    if (screen === 'mf' || screen === 'depository') return setScreen('choose');
    if (screen === 'demat') return setScreen(depositoryHint ? 'choose' : 'depository');
  };

  const title =
    screen === 'mf' ? 'Mutual funds'
    : screen === 'depository' ? 'Which depository?'
    : screen === 'demat' ? 'Stocks & demat'
    : 'Import my portfolio';

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-overlay p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="import-hub-title"
    >
      <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-token-xl border border-border bg-modal shadow-token-lg">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-modal px-5 py-4">
          {screen === 'choose' ? (
            <PackagePlus className="h-4 w-4 shrink-0 text-accent" />
          ) : (
            <button
              type="button"
              onClick={back}
              aria-label="Back"
              className="text-text-secondary hover:text-text-primary"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
          )}
          <h3 id="import-hub-title" className="flex-1 text-sm font-bold text-text-primary">
            {title}
          </h3>
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
          {justConnectedInbox && screen === 'choose' && (
            <div className="flex items-start gap-2.5 rounded-token-md border border-success-soft/25 bg-success-soft/10 px-3.5 py-3">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-soft" />
              <p className="text-xs leading-relaxed text-text-secondary">
                <span className="font-semibold text-text-primary">Email connected.</span> Open a
                category below and tap <span className="font-semibold">Sync now</span> to bring in
                your statements.
              </p>
            </div>
          )}

          {screen === 'choose' && (
            <ChooseScreen onMutualFunds={() => setScreen('mf')} onDemat={openDemat} dematOn={!!onDemat} />
          )}

          {screen === 'mf' && (
            <MethodsScreen
              lead="We bring in every fund you hold across all fund houses, with full transaction history."
              getItForMe={
                <MethodRow
                  icon={Mail}
                  title="Email me a fresh CAS"
                  body="CAMS & KFintech send it to your PAN email — usually under 2 minutes."
                  onClick={onMutualFunds}
                  primary
                />
              }
              onUpload={onUpload}
              inboxEnabled={inboxEnabled}
              forwardEnabled={forwardEnabled}
              onImported={onImported}
            />
          )}

          {screen === 'depository' && (
            <DepositoryScreen
              hint={depositoryHint ?? null}
              onPick={(d) => {
                setDepo(d);
                setScreen('demat');
              }}
            />
          )}

          {screen === 'demat' && (
            <MethodsScreen
              lead={
                depo === 'nsdl'
                  ? 'Your holdings are with NSDL, which has no instant fetch — forward your statement or connect your inbox and we import it automatically.'
                  : 'A CDSL fetch returns everything you hold across both depositories in one statement.'
              }
              getItForMe={
                depo === 'cdsl' && onDemat ? (
                  <MethodRow
                    icon={Zap}
                    title="Fetch via CDSL OTP"
                    body="Full holdings — CDSL + NSDL — in seconds, with a one-time password to your phone."
                    onClick={onDemat}
                    primary
                  />
                ) : null
              }
              onUpload={onUpload}
              inboxEnabled={inboxEnabled}
              forwardEnabled={forwardEnabled}
              onImported={onImported}
            />
          )}

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

const COVERS = ['Shares', 'Bonds', 'G-Secs', 'ETFs', 'NPS'];

function ChooseScreen({
  onMutualFunds,
  onDemat,
  dematOn,
}: {
  onMutualFunds: () => void;
  onDemat: () => void;
  dematOn: boolean;
}) {
  return (
    <div className="space-y-5">
      <div>
        <p className="font-display text-xl font-bold tracking-tight text-text-primary">
          Everything you own, in one basket
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-text-muted">
          Bring in what you hold through other apps, banks and brokers and see it alongside your
          Niyom investments — one value, one return.
        </p>
      </div>
      <div className="space-y-2.5">
        <MethodRow
          icon={FileText}
          title="Mutual funds"
          body="Every fund house, with full transaction history."
          meta="~2 min"
          onClick={onMutualFunds}
          primary
        />
        {dematOn && (
          <MethodRow
            icon={Landmark}
            title="Stocks & demat"
            body="Shares, bonds, G-Secs, ETFs and NPS from your depository."
            meta="~1 min"
            onClick={onDemat}
          />
        )}
      </div>
      {dematOn && (
        <ul className="flex flex-wrap gap-1.5">
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
  );
}

function DepositoryScreen({
  hint,
  onPick,
}: {
  hint: Depository | null;
  onPick: (d: Depository) => void;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm leading-relaxed text-text-muted">
        Indian shares sit in one of two depositories. Most retail brokers (Zerodha, Groww, Upstox)
        use <b className="text-text-secondary">CDSL</b>; bank brokers like HDFC, ICICI and Kotak
        typically use <b className="text-text-secondary">NSDL</b>. Not sure? Pick CDSL — if it finds
        nothing we'll point you to the email route.
      </p>
      <div className="space-y-2.5">
        <DepoOption
          code="CDSL"
          sub="Central Depository Services — most retail brokers"
          highlighted={hint === 'cdsl'}
          onClick={() => onPick('cdsl')}
        />
        <DepoOption
          code="NSDL"
          sub="National Securities Depository — typically bank brokers"
          highlighted={hint === 'nsdl'}
          onClick={() => onPick('nsdl')}
        />
      </div>
    </div>
  );
}

function DepoOption({
  code,
  sub,
  highlighted,
  onClick,
}: {
  code: string;
  sub: string;
  highlighted: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`press flex w-full items-center justify-between gap-3 rounded-token-lg border px-4 py-3.5 text-left transition-colors ${
        highlighted ? 'border-accent/60 bg-accent/10' : 'border-border bg-card hover:border-accent/40'
      }`}
    >
      <span className="min-w-0">
        <span className="block text-sm font-bold text-text-primary">{code}</span>
        <span className="mt-0.5 block text-xs text-text-muted">{sub}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-text-faint" />
    </button>
  );
}

/**
 * A methods sheet: an optional "Get it for me" fetch/request action on top, then
 * the two always-available email routes under "I have the file". Sections whose
 * cards all hide themselves (server off) simply don't render a header.
 */
function MethodsScreen({
  lead,
  getItForMe,
  onUpload,
  inboxEnabled,
  forwardEnabled,
  onImported,
}: {
  lead: string;
  getItForMe: ReactNode;
  onUpload: () => void;
  inboxEnabled: boolean;
  forwardEnabled: boolean;
  onImported: () => void;
}) {
  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-text-muted">{lead}</p>

      {(getItForMe || inboxEnabled) && (
        <div className="space-y-2.5">
          <SectionLabel>Get it for me</SectionLabel>
          {getItForMe}
          {inboxEnabled && <ConnectInbox preEnabled onImported={onImported} />}
        </div>
      )}

      <div className="space-y-2.5">
        <SectionLabel>I have the statement</SectionLabel>
        <MethodRow
          icon={Upload}
          title="Upload a PDF"
          body="Already have the statement? Upload it — we open PAN-locked files for you."
          onClick={onUpload}
        />
        {forwardEnabled && <ForwardCasCard preEnabled onImported={onImported} />}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wider text-text-faint">{children}</p>
  );
}

function MethodRow({
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
  meta?: string;
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
          {meta && <span className="text-[11px] text-text-faint">{meta}</span>}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">{body}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-text-faint transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}
