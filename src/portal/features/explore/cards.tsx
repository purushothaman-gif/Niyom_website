/**
 * Explore building blocks — the Groww-style card rails used by the Invest
 * Explore hub and the Mutual Funds Explore tab. Pure presentation.
 */
import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react';
import { inr } from '../../../lib/money';
import type { ClientBond } from '../../../../shared/portal/services/BondOrderService';
import type { ClientShare } from '../../../../shared/portal/services/ShareOrderService';
import { ratingGrade } from '../../../../shared/portal/bonds/bondFilters';
import type { CatalogFund } from '../../types/funds';
import { BrandLogo } from '../../../components/BrandLogo';
import { issuerFromBondName } from '../../../components/brandLogos';
import { AmcAvatar } from '../mutual-funds/components/AmcAvatar';
import type { FundCollection } from '../mutual-funds/explore/collections';
import { signedPct, toneOf } from '../investments/format';
import { WatchStar } from '../../watchlist/Watchlist';

/** Section heading with an optional "See more" link, as on Groww. */
export function Rail({
  title,
  icon: Icon,
  more,
  onMore,
  children,
}: {
  title: string;
  icon?: LucideIcon;
  more?: string;
  onMore?: () => void;
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 font-display text-xl font-bold tracking-tight text-text-primary">
          {Icon && <Icon className="h-5 w-5 text-accent" />}
          {title}
        </h2>
      </div>
      {children}
      {more && onMore && (
        <button
          type="button"
          onClick={onMore}
          className="mt-4 inline-flex items-center gap-1 text-sm font-semibold text-accent hover:text-accent-soft"
        >
          {more} <ChevronRight className="h-4 w-4" />
        </button>
      )}
    </section>
  );
}

/**
 * A horizontally scrolling card row (Groww-style): four cards across on desktop,
 * two on phones, with left/right arrows that appear only when there is more to
 * see that way. Swipe and trackpad scrolling work as usual; cards snap.
 */
export function ScrollRow({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });
  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft <= 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    update();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [update, children]);
  const go = (dir: -1 | 1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.9, behavior: 'smooth' });
  };
  const arrow = (dir: -1 | 1) => (
    <button
      type="button"
      onClick={() => go(dir)}
      aria-label={dir < 0 ? `Scroll ${label} left` : `Scroll ${label} right`}
      className={`absolute top-1/2 z-10 hidden h-9 w-9 sm:grid -translate-y-1/2 place-items-center rounded-full border border-border bg-bg-elevated text-text-primary shadow-token-lg transition-colors hover:border-accent hover:text-accent ${
        dir < 0 ? 'left-0 sm:-left-4' : 'right-0 sm:-right-4'
      }`}
    >
      {dir < 0 ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
    </button>
  );
  return (
    <div className="relative">
      <div
        ref={ref}
        onScroll={update}
        role="region"
        aria-label={label}
        className="-mx-4 -my-1 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 py-1 sm:-mx-1 sm:scroll-px-1 sm:gap-4 sm:px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {Children.map(children, (c) => (
          <div className="w-[64%] shrink-0 snap-start sm:w-[calc(50%-0.5rem)] lg:w-[calc(25%-0.75rem)]">{c}</div>
        ))}
      </div>
      {!edge.start && arrow(-1)}
      {!edge.end && arrow(1)}
    </div>
  );
}

export function CardGrid({ children, cols = 4 }: { children: ReactNode; cols?: 3 | 4 }) {
  return (
    <div className={`grid grid-cols-2 gap-3 sm:gap-4 ${cols === 3 ? 'xl:grid-cols-3' : 'lg:grid-cols-4'}`}>{children}</div>
  );
}

const cardCls =
  'group flex h-full min-h-[11.5rem] w-full flex-col rounded-token-xl border border-border bg-bg-elevated p-4 text-left shadow-token-card transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-token-lg';

/** Two-letter logo tile from a name, coloured deterministically. */
export function Monogram({ name, size = 44 }: { name: string; size?: number }) {
  const words = name.replace(/\b(ltd|limited|pvt|private|the|of|india|finance|financial)\b\.?/gi, '').trim().split(/\s+/);
  const initials = ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? words[0]?.[1] ?? '')).toUpperCase();
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const hues = ['#2563EB', '#7C3AED', '#0D9488', '#DB2777', '#EA580C', '#16A34A', '#0891B2', '#CA8A04'];
  const bg = hues[h % hues.length];
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-token-md font-display text-sm font-bold text-white"
      style={{ width: size, height: size, background: bg }}
    >
      {initials || '•'}
    </span>
  );
}

/* ----------------------------------------------------------------- Bonds */

function maturityShort(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.toLocaleString('en-IN', { month: 'short' })} '${String(d.getFullYear()).slice(2)}`;
}

function monthsTo(iso: string | null): number | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  return Math.max(0, (d.getFullYear() - now.getFullYear()) * 12 + d.getMonth() - now.getMonth());
}

/** The bond fields a card needs — satisfied by both ClientBond and PartnerBond. */
export type BondLike = Pick<ClientBond, 'id' | 'isin' | 'bond_name' | 'issuer_name' | 'coupon_rate' | 'maturity_date' | 'rating' | 'security_type'> & {
  analytics?: { ytm?: number | null } | null;
};

export function bondYield(b: BondLike): number | null {
  return b.analytics?.ytm ?? b.coupon_rate ?? null;
}

export function BondCard({ bond, onOpen }: { bond: BondLike; onOpen: () => void }) {
  const name = bond.issuer_name || bond.bond_name || bond.isin;
  const y = bondYield(bond);
  const months = monthsTo(bond.maturity_date);
  const grade = ratingGrade(bond.rating);
  const safe = grade && /^AA/.test(grade);
  const issuerName = bond.issuer_name?.trim() || issuerFromBondName(bond.bond_name) || name;
  return (
    <div className="relative h-full">
      <button type="button" onClick={onOpen} className={cardCls}>
        <BrandLogo kind="bond_issuer" name={issuerName} size={44} fallback={<Monogram name={name} />} />
        <p className="mt-3 line-clamp-2 text-sm font-semibold leading-snug text-text-primary">
          {name}
          {bond.maturity_date && <span className="text-text-secondary"> {maturityShort(bond.maturity_date)}</span>}
        </p>
        <div className="mt-auto pt-4">
          <p className="font-display text-lg font-bold tabular-nums text-text-primary">
            {y != null ? `${y.toFixed(2)}%` : '—'}
          </p>
          <div className="mt-0.5 flex items-center justify-between text-[11px] text-text-secondary">
            <span>{months != null ? `${months} months` : 'Yield'}</span>
            {grade && (
              <span className="inline-flex items-center gap-1 font-semibold text-text-primary">
                {grade}
                <span className={`h-1.5 w-1.5 rounded-full ${safe ? 'bg-success' : 'bg-warning'}`} />
              </span>
            )}
          </div>
        </div>
      </button>
      <WatchStar type="bond" itemRef={bond.id} className="absolute right-2 top-2" />
    </div>
  );
}

/* ----------------------------------------------------------------- Funds */

export function FundCard({ fund, onOpen }: { fund: CatalogFund; onOpen: () => void }) {
  const r3 = fund.returns['3Y'];
  const r1 = fund.returns['1Y'];
  const shown = r3 ?? r1;
  return (
    <div className="relative h-full">
      <button type="button" onClick={onOpen} className={cardCls}>
        <AmcAvatar amc={fund.amc || fund.name} size={44} />
        <p className="mt-3 line-clamp-2 text-sm font-semibold leading-snug text-text-primary">{fund.name}</p>
        <div className="mt-auto flex items-end justify-between pt-4">
          <p className={`font-display text-lg font-bold tabular-nums ${toneOf(shown)}`}>{signedPct(shown, 2)}</p>
          <span className="text-[11px] font-medium text-text-secondary">{r3 != null ? '3Y' : '1Y'}</span>
        </div>
      </button>
      <WatchStar type="fund" itemRef={fund.amfiCode} className="absolute right-2 top-2" />
    </div>
  );
}

export function CollectionTile({ collection, count, onOpen }: { collection: FundCollection; count: number; onOpen: () => void }) {
  const Icon = collection.icon;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col items-center gap-2.5 rounded-token-xl border border-transparent p-2 text-center transition-colors hover:border-border hover:bg-bg-elevated"
    >
      <span className="flex h-20 w-full items-center justify-center rounded-token-xl bg-gradient-to-br from-accent/15 via-accent/5 to-transparent ring-1 ring-border">
        <Icon className="h-8 w-8 text-accent transition-transform group-hover:scale-110" />
      </span>
      <span className="text-[13px] font-semibold leading-tight text-text-primary">{collection.label}</span>
      <span className="-mt-1.5 text-[10px] text-text-faint">{count} funds</span>
    </button>
  );
}

/* ---------------------------------------------------------------- Shares */

/** The share fields a card needs — client and partner views differ only in price. */
export type ShareLike = Pick<ClientShare, 'id' | 'company_name' | 'short_name' | 'logo_url' | 'sector'>;

export function ShareCard({
  share,
  price,
  onOpen,
}: {
  share: ShareLike;
  /** Price shown to this viewer (client price or the partner's own price). */
  price: number | null;
  onOpen: () => void;
}) {
  const name = share.short_name || share.company_name;
  return (
    <div className="relative h-full">
      <button type="button" onClick={onOpen} className={cardCls}>
        {share.logo_url ? (
          <img
            src={share.logo_url}
            alt=""
            className="h-11 w-11 rounded-token-md bg-white object-contain p-1"
            onError={(e) => ((e.currentTarget as HTMLImageElement).style.display = 'none')}
          />
        ) : (
          <Monogram name={name} />
        )}
        <p className="mt-3 line-clamp-2 text-sm font-semibold leading-snug text-text-primary">{name}</p>
        <div className="mt-auto pt-4">
          <p className="font-display text-lg font-bold tabular-nums text-text-primary">
            {price != null ? inr(price, price < 1000) : '—'}
          </p>
          <p className="mt-0.5 truncate text-[11px] text-text-secondary">{share.sector || 'Unlisted'}</p>
        </div>
      </button>
      <WatchStar type="share" itemRef={share.id} className="absolute right-2 top-2" />
    </div>
  );
}

/* ------------------------------------------------------- Products & tools */

export interface ToolItem {
  key: string;
  label: string;
  icon: LucideIcon;
  badge?: string;
  onClick: () => void;
}

export function ProductsTools({ title = 'Products & Tools', items }: { title?: string; items: ToolItem[] }) {
  return (
    <section>
      <h2 className="mb-4 font-display text-xl font-bold tracking-tight text-text-primary">{title}</h2>
      <div className="overflow-hidden rounded-token-xl border border-border bg-bg-elevated shadow-token-card">
        {items.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={t.onClick}
            className="flex w-full items-center gap-4 border-b border-border-subtle px-5 py-4 text-left transition-colors last:border-0 hover:bg-hover"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-token-md bg-accent/10">
              <t.icon className="h-[18px] w-[18px] text-accent" />
            </span>
            <span className="flex-1 text-sm font-semibold text-text-primary">{t.label}</span>
            {t.badge && (
              <span className="rounded-full border border-success/25 bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                {t.badge}
              </span>
            )}
            <ChevronRight className="h-4 w-4 text-text-faint" />
          </button>
        ))}
      </div>
    </section>
  );
}

/** A loading shimmer the size of a card rail. */
export function RailSkeleton() {
  return (
    <CardGrid>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="h-[11.5rem] animate-pulse rounded-token-xl border border-border bg-bg-elevated" />
      ))}
    </CardGrid>
  );
}
