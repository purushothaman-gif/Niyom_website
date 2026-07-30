import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, Handshake, LogIn, UserRound, type LucideIcon } from 'lucide-react';

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
    hint: 'Your clients & payouts',
    icon: Handshake,
    href: '/partner-login',
  },
];

interface LoginMenuProps {
  /** Extra classes for the trigger — lets each header keep its own scale. */
  triggerClassName?: string;
  /** Where the panel aligns relative to the trigger. */
  align?: 'left' | 'right';
}

export function LoginMenu({ triggerClassName = '', align = 'right' }: LoginMenuProps) {
  const [open, setOpen] = useState(false);
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
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        ref={triggerRef}
        /* Open-only, matching the employee menu: on a hover-capable pointer the
           panel is already open by the time a click lands, so a toggle would
           read as "clicking the button closes it". */
        onClick={() => setOpen(true)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`cta-glow-sm gold-sheen press flex items-center gap-2 rounded-xl font-semibold text-black hover:brightness-[1.06] ${triggerClassName}`}
        style={{
          background: 'linear-gradient(135deg, rgb(var(--accent-soft-rgb)) 0%, rgb(var(--accent-rgb)) 100%)',
        }}
      >
        <LogIn size={16} />
        Login
        <ChevronDown size={16} className={`transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
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
    </div>
  );
}
