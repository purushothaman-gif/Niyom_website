/**
 * Partner "Sell today" cards — the client-facing figure (yield / price) plus
 * what the partner earns at their current spread, and the three selling
 * actions they use most. Earnings come ONLY from the shared partner maths
 * (partnerBondMath / partnerShareMath); nothing is recomputed here.
 */
import { ImageIcon, Link2, ShoppingBag } from 'lucide-react';
import { inr } from '../../../lib/money';
import type { PartnerBond, PartnerShare } from '../../../../shared/partner/services/PartnerService';
import { partnerBreakdown } from '../../../../shared/partner/bonds/partnerBondMath';
import { partnerShareBreakdown } from '../../../../shared/partner/shares/partnerShareMath';
import { BondCard, ShareCard } from '../../../portal/features/explore/cards';

const LAKH = 100_000;

/** Partner's earnings on a ₹1 lakh client investment at their current spread. */
export function bondEarnPerLakh(b: PartnerBond): number | null {
  const margin = b.self_markup_percent ?? 0;
  const face = Number(b.face_value) || 100;
  const price = Number(b.partner_price) || 0;
  if (!(price > 0) || !(Number(b.partner_base) > 0)) return null;
  const units = LAKH / (face * (price / 100));
  return partnerBreakdown(b, units, margin).yourMargin;
}

export function shareEarnPerLakh(s: PartnerShare): number | null {
  const margin = s.self_markup_percent ?? 0;
  const price = Number(s.partner_price) || 0;
  if (!(price > 0) || !(Number(s.partner_base) > 0)) return null;
  return partnerShareBreakdown(s, LAKH / price, margin).yourMargin;
}

/**
 * The spread only — what the partner's own markup adds on a ₹1 lakh deal. It
 * is NOT their whole income (debit-note payouts are computed separately in
 * DSAPayout and never here), so it is labelled as the spread, not "you earn".
 */
function EarnLine({ earn, margin }: { earn: number | null; margin: number | null }) {
  if (earn == null || earn <= 0) {
    return <p className="mt-2 px-1 text-[11px] text-text-faint">No spread set — client sees your base price</p>;
  }
  return (
    <p className="mt-2 rounded-token-md bg-success/10 px-2.5 py-1.5 text-[11px] font-semibold text-success">
      Spread {inr(earn)} / ₹1 L
      {margin != null && <span className="font-medium text-success/80"> · {margin}%</span>}
    </p>
  );
}

function Actions({ items }: { items: Array<{ label: string; icon: typeof Link2; onClick: () => void }> }) {
  return (
    <div className="mt-2 grid gap-1.5" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((a) => (
        <button
          key={a.label}
          type="button"
          onClick={a.onClick}
          title={a.label}
          aria-label={a.label}
          className="flex items-center justify-center gap-1 rounded-token-md border border-border bg-bg-surface px-1.5 py-1.5 text-[11px] font-semibold text-text-secondary transition-colors hover:border-accent/40 hover:text-accent"
        >
          <a.icon className="h-3.5 w-3.5 shrink-0" />
          {/* Icons only on a phone, where three labels don't fit a half-width card. */}
          <span className="hidden truncate sm:inline">{a.label}</span>
        </button>
      ))}
    </div>
  );
}

export function PartnerBondSellCard({
  bond,
  onOpen,
  onOrder,
  onShare,
  onImage,
}: {
  bond: PartnerBond;
  onOpen: () => void;
  onOrder: () => void;
  onShare: () => void;
  onImage: () => void;
}) {
  return (
    <div className="flex flex-col">
      <BondCard bond={bond} onOpen={onOpen} />
      <EarnLine earn={bondEarnPerLakh(bond)} margin={bond.self_markup_percent} />
      <Actions
        items={[
          { label: 'Order', icon: ShoppingBag, onClick: onOrder },
          { label: 'Link', icon: Link2, onClick: onShare },
          { label: 'Image', icon: ImageIcon, onClick: onImage },
        ]}
      />
    </div>
  );
}

export function PartnerShareSellCard({
  share,
  onOpen,
  onOrder,
  onShare,
}: {
  share: PartnerShare;
  onOpen: () => void;
  onOrder: () => void;
  onShare: () => void;
}) {
  return (
    <div className="flex flex-col">
      <ShareCard share={share} price={share.partner_price} onOpen={onOpen} />
      <EarnLine earn={shareEarnPerLakh(share)} margin={share.self_markup_percent} />
      <Actions
        items={[
          { label: 'Order', icon: ShoppingBag, onClick: onOrder },
          { label: 'Link', icon: Link2, onClick: onShare },
        ]}
      />
    </div>
  );
}
