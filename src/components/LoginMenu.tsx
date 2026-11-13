import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ArrowUpRight, ChevronDown, Handshake, LayoutDashboard, LogIn, UserRound, X, type LucideIcon } from 'lucide-react';

/**
 * The public site's primary login control.
 *
 * Niyom Wealth has two external audiences with their own portals — clients and
 * distribution partners (DSAs) — so a single "Client Login" button left partners
 * with no way in at all. This renders one gold "Login" CTA that opens a small
 * portal chooser, mirroring the Employee Login menu's interaction model so the
 * nav reads as one system rather than two conventions.
 *
 * Rendered by both Landing and PublicPageChrome; the portal list lives here so
 * the two headers cannot drift apart.
 */

export interface LoginPortal {
  label: string;
  hint: string;
  icon: LucideIcon;
  href: string;
}

export const LOGIN_PORTALS: LoginPortal[] = [
  {
    label: 'Client Login',
    hint: 'Your portfolio & statements',
    icon: UserRound,
    href: '/client-login',
  },
  {
    label: 'Partner Login',
    hint: 'Your clients & orders',
    icon: Handshake,
    href: '/partner-login',
  },
];

/** Staff console. Desktop keeps it behind the separate "Employee Login" menu;
 *  on a phone all three sit in one sheet so nobody hunts for the right door. */
export const EMPLOYEE_PORTAL: LoginPortal = {
  label: 'Employee Login',
  hint: 'CRM for Niyom staff',
  icon: LayoutDashboard,
  href: '/crm',
};

export const ALL_PORTALS: LoginPortal[] = [...LOGIN_PORTALS, EMPLOYEE_PORTAL];

/** Phones (and touch tablets below md) get the sheet instead of the dropdown. */
function prefersSheet(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
}

/**
 * Phone login chooser: a bottom sheet with one large, thumb-sized row per
 * portal. Opens the portal in the same tab — a new tab on a phone strands the
 * visitor in a second tab they didn't ask for. Portalled to <body> because the
 * headers that open it use backdrop-filter, which would otherwise become the
 * containing block for this fixed overlay.
 */
export function LoginSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div data-theme="dark" className="fixed inset-0 z-[100] flex items-end" role="dialog" aria-modal="true" aria-label="Choose how to log in">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60" />
      <div
        className="relative w-full rounded-t-3xl border-t border-accent-soft/25 px-4 pt-2 pb-[max(1.25rem,env(safe-area-inset-bottom))]"
        style={{ background: 'rgba(7, 21, 36, 0.98)', animation: 'm-sheet-up 0.24s var(--ease-out, ease-out)' }}
      >
        <div aria-hidden className="mx-auto mb-3 h-1 w-9 rounded-full bg-white/20" />
        <div className="mb-3 flex items-center justify-between px-1">
          <p className="font-display text-lg font-bold text-white">Log in to Niyom</p>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 rounded-lg p-2 text-white/60 hover:text-white">
            <X size={20} />
          </button>
        </div>
        <div className="space-y-2.5">
          {ALL_PORTALS.map(({ label, hint, icon: Icon, href }, i) => (
            <a
              key={label}
              href={href}
              onClick={onClose}
              className={`press flex min-h-[64px] w-full items-center gap-3.5 rounded-2xl border px-4 py-3 text-left transition-colors ${
                i === 0
                  ? 'border-accent-soft/50 bg-accent-soft/[0.12]'
                  : 'border-white/10 bg-white/[0.04] hover:border-accent-soft/40'
              }`}
            >
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft/10 text-accent-soft ring-1 ring-inset ring-accent-soft/25">
                <Icon size={20} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-white">{label}</span>
                <span className="block text-xs text-white/50">{hint}</span>
              </span>
              <ArrowRight size={18} className="shrink-0 text-accent-soft" />
            </a>
          ))}
        </div>
        <p className="mt-4 px-1 text-center text-xs text-white/45">
          New to Niyom?{' '}
          <a href="/onboarding" className="font-semibold text-accent-soft">Open a free account</a>
        </p>
      </div>
    </div>,
    document.body,
  );
}

interface LoginMenuProps {
  /** Extra classes for the trigger — lets each header keep its own scale. */
  triggerClassName?: string;
  /** Where the panel aligns relative to the trigger. */
  align?: 'left' | 'right';
}

export function LoginMenu({ triggerClassName = '', align = 'right' }: LoginMenuProps) {
  const [open, setOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Opens on hover for pointers, but must also close on Escape and on an
  // outside click so keyboard and touch users aren't trapped with a panel they
  // can't dismiss. Same contract as the Employee Login menu in Landing.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  return (
    <div
      ref={menuRef}
      className="relative"
      // Hover-open only for real pointers: a tap on a phone fires a synthetic
      // mouseenter, which used to pop the small dropdown under the thumb.
      onMouseEnter={() => { if (!prefersSheet()) setOpen(true); }}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={triggerRef}
        /* Open-only, matching the employee menu: on a hover-capable pointer the
           panel is already open by the time a click lands, so a toggle would
           read as "clicking the button closes it". */
        onClick={() => (prefersSheet() ? setSheetOpen(true) : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`cta-glow-sm gold-sheen press flex items-center gap-2 rounded-xl font-semibold text-black hover:brightness-[1.06] ${triggerClassName}`}
        style={{
          background: 'linear-gradient(135deg, rgb(var(--accent-soft-rgb)) 0%, rgb(var(--accent-rgb)) 100%)',
        }}
      >
        <LogIn size={16} />
        Login
        {/* Below md the button opens a sheet, not a dropdown — no chevron. */}
        <ChevronDown size={16} className={`hidden md:block transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        /* The wrapper's top padding bridges the trigger-to-panel gap, so the
           pointer can travel down without the menu closing. */
        <div className={`absolute top-full z-50 pt-2 ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <div
            role="menu"
            aria-label="Login"
            data-theme="dark"
            className="animate-navMenuIn w-[276px] overflow-hidden rounded-2xl border border-accent-soft/20"
            style={{
              /* Near-opaque: the nav row sits directly behind the panel, and at
                 lower alpha its links ghost through. */
              background: 'rgba(7, 21, 36, 0.97)',
              backdropFilter: 'saturate(160%) blur(18px)',
              WebkitBackdropFilter: 'saturate(160%) blur(18px)',
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <div className="px-4 pt-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-accent-soft/70">
              Choose your portal
            </div>
            {LOGIN_PORTALS.map(({ label, hint, icon: Icon, href }) => (
              <button
                key={label}
                role="menuitem"
                onClick={() => { setOpen(false); window.open(href, '_blank'); }}
                className="group/item flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors duration-200 hover:bg-accent-soft/10"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft/10 text-accent-soft ring-1 ring-inset ring-accent-soft/20 transition-colors duration-200 group-hover/item:bg-accent-soft/20">
                  <Icon size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-white">{label}</span>
                  <span className="block text-[11px] text-white/45">{hint}</span>
                </span>
                <ArrowUpRight
                  size={14}
                  className="text-white/25 transition-all duration-200 group-hover/item:-translate-y-0.5 group-hover/item:translate-x-0.5 group-hover/item:text-accent-soft"
                />
              </button>
            ))}
            <div className="h-1" />
          </div>
        </div>
      )}
      <LoginSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </div>
  );
}
