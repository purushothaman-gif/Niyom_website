// Partner marketing image — the partner picks logo on/off (asked up front) and
// downloads the same brochure/promo the employee Bond Creation module makes, but
// with the partner's own contact and their selling price. The generator (with its
// heavy html2canvas/html2pdf deps) is dynamically imported so it never weighs down
// the partner bundle until actually used.

import { useState } from 'react';
import { X, ImageDown, Megaphone, Loader2 } from 'lucide-react';
import type { PartnerBond } from '../../services/PartnerService';
import type { PartnerIdentity } from '../../types';

// Map the partner bond projection onto the shape the image generator reads. The
// generator only touches this subset and tolerates missing fields, so a partial
// cast is safe; the price is passed explicitly as the partner's selling price.
function toBondPublic(b: PartnerBond): any {
  return {
    id: b.id, isin: b.isin, issuer_name: b.issuer_name, bond_name: b.bond_name || b.issuer_name || b.isin,
    coupon_rate: b.coupon_rate, coupon_type: b.coupon_type || '', coupon_frequency: b.coupon_frequency || '',
    maturity_date: b.maturity_date, next_coupon_date: b.next_coupon_date, issue_date: b.issue_date,
    rating: b.rating, rating_agency: b.rating_agency, security_type: b.security_type, seniority: b.seniority,
    tax_status: b.tax_status, day_count_convention: b.day_count_convention || '',
    principal_repayment_structure: b.principal_repayment_structure || '',
    min_investment: b.min_investment, face_value: b.face_value,
    selling_price: b.partner_price, latest_price: b.partner_price,
  };
}

export function PartnerMarketingModal({
  bond,
  partner,
  onClose,
}: {
  bond: PartnerBond;
  partner: PartnerIdentity | null;
  onClose: () => void;
}) {
  const [logo, setLogo] = useState(true);
  const [busy, setBusy] = useState<'brochure' | 'promo' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const contact = partner
    ? { name: partner.full_name, phone: partner.mobile, email: partner.email }
    : undefined;

  const run = async (kind: 'brochure' | 'promo') => {
    setBusy(kind); setError(null);
    try {
      const mod = await import('../../../crm/bonds/bondOutputs');
      const b = toBondPublic(bond);
      const analytics = bond.analytics ? { ...bond.analytics } as any : null;
      const opts = { contact, logo, contactLabel: 'Contact', sellingPricePer100: bond.partner_price };
      if (kind === 'brochure') await mod.generateMarketingImage(b, analytics, opts);
      else await mod.generatePromoImage(b, opts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not generate the image.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} onClick={onClose}>
      <div className="w-full max-w-sm rounded-token-xl border border-border bg-bg-elevated shadow-token-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
          <h2 className="font-display text-base font-bold text-text-primary">Marketing image</h2>
          <button type="button" onClick={onClose} className="text-text-muted hover:text-text-primary"><X className="h-5 w-5" /></button>
        </div>

        <div className="space-y-4 p-5">
          <p className="text-sm text-text-secondary">A shareable image for <strong className="text-text-primary">{bond.bond_name || bond.isin}</strong> at your price, with your contact details.</p>

          {/* Logo preference */}
          <label className="flex cursor-pointer items-center justify-between gap-3 rounded-token-md border border-border bg-bg-surface px-3.5 py-3">
            <span className="text-sm text-text-primary">Include the Niyom logo</span>
            <input type="checkbox" checked={logo} onChange={(e) => setLogo(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
          </label>
          <p className="-mt-2 text-[11px] text-text-faint">Turn this off to share a de-branded image under your own name.</p>

          {error && <div className="rounded-token-md border border-danger-soft/20 bg-danger-soft/10 p-3 text-xs text-danger-soft">{error}</div>}

          <div className="grid grid-cols-2 gap-3">
            <button type="button" disabled={busy !== null} onClick={() => run('brochure')} className="inline-flex items-center justify-center gap-1.5 rounded-token-md border border-border bg-bg-surface py-2.5 text-sm font-bold text-text-primary hover:border-accent/40 disabled:opacity-50">
              {busy === 'brochure' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageDown className="h-4 w-4" />} Brochure
            </button>
            <button type="button" disabled={busy !== null} onClick={() => run('promo')} className="inline-flex items-center justify-center gap-1.5 rounded-token-md border border-border bg-bg-surface py-2.5 text-sm font-bold text-text-primary hover:border-accent/40 disabled:opacity-50">
              {busy === 'promo' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />} Promo
            </button>
          </div>
          <p className="text-center text-[11px] text-text-faint">The image downloads to your device to share with your clients.</p>
        </div>
      </div>
    </div>
  );
}
