/**
 * A bond as it appears in the marketplace list.
 *
 * The website shows these three-across on a desktop grid; a phone gets one
 * column, so the card is wider than it is tall and the three headline figures
 * (yield, tenure, minimum) sit in a row rather than stacked. Same figures, same
 * order, same wording as the web card — a client who browses on both should not
 * have to re-learn where the yield is.
 *
 * ## Why the yield falls back to the coupon
 *
 * YTM comes from the enrich pipeline and can be absent on a freshly-imported
 * bond. Showing "—" in the one slot the eye goes to first makes a live bond look
 * broken, and the coupon is the honest floor: it is what the instrument pays,
 * just not adjusted for the price paid. The label stays "Yield (YTM)" only when
 * that is what it is.
 */
import { View } from 'react-native';
import { Landmark } from 'lucide-react-native';
import { fmt, fmtDate } from '@shared/crm/utils';
import type { ClientBond } from '@shared/portal/services/BondOrderService';
import { tenureLabel } from '@shared/portal/bonds/bondMath';
import { font, radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { StatusPill } from '@/ui/kit';

const pct = (v: number | null | undefined) =>
  v == null ? '—' : `${Number(v).toFixed(2)}%`;

/** A short marketing tag derived from the bond's own numbers. */
function derivedTag(b: ClientBond): { label: string; tone: 'accent' | 'success' } | null {
  const ytm = b.analytics?.ytm;
  const yrs = b.analytics?.years_to_maturity;
  if (ytm != null && ytm >= 12) return { label: 'High yield', tone: 'success' };
  if (yrs != null && yrs > 0 && yrs < 1) return { label: 'Short tenure', tone: 'accent' };
  const min = Number(b.min_investment) || Number(b.face_value) || 0;
  if (min > 0 && min <= 100000) return { label: 'Low minimum', tone: 'accent' };
  return null;
}

function freqLabel(f: string | null): string {
  const v = (f || '').toLowerCase().replace(/_/g, '-');
  if (!v) return '—';
  return v.charAt(0).toUpperCase() + v.slice(1);
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'positive' }) {
  const p = usePalette();
  return (
    <View style={{ flex: 1 }}>
      <Text variant="caption" tone="faint" numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={{
          fontFamily: font.displayBold,
          fontSize: 15,
          marginTop: 2,
          color: tone === 'positive' ? p.state.successSoft : p.text.primary,
        }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  );
}

export function BondCard({ bond, onPress }: { bond: ClientBond; onPress: () => void }) {
  const p = usePalette();
  const tag = derivedTag(bond);
  const min = Number(bond.min_investment) || Number(bond.face_value) || null;
  const hasYtm = bond.analytics?.ytm != null;

  return (
    <Card onPress={onPress} padding={4} style={{ gap: space[3] }}>
      {/* Issuer + rating */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
        <View
          style={{
            width: 38,
            height: 38,
            borderRadius: radius.sm + 2,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: p.accent.tint(0.12),
          }}
        >
          <Landmark size={18} color={p.accent.DEFAULT} strokeWidth={2} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyMedium" numberOfLines={2}>
            {bond.issuer_name || bond.bond_name || bond.isin}
          </Text>
          <Text variant="caption" tone="faint" style={{ marginTop: 1 }} numberOfLines={1}>
            {bond.isin}
          </Text>
        </View>
        {bond.rating ? <StatusPill label={bond.rating} tone="accent" /> : null}
      </View>

      {tag ? <StatusPill label={tag.label} tone={tag.tone === 'success' ? 'success' : 'accent'} /> : null}

      {/* The three headline figures */}
      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <Figure
          label={hasYtm ? 'Yield (YTM)' : 'Coupon'}
          value={pct(hasYtm ? bond.analytics?.ytm : bond.coupon_rate)}
          tone="positive"
        />
        <Figure label="Tenure" value={tenureLabel(bond)} />
        <Figure label="Min. Invest" value={min != null ? fmt(min) : '—'} />
      </View>

      {/* Coupon terms against the price */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: space[3],
          borderTopWidth: 1,
          borderTopColor: p.border.subtle,
          paddingTop: space[3],
        }}
      >
        <View style={{ flex: 1 }}>
          <Text variant="overline" tone="faint" caps>
            Coupon
          </Text>
          <Text style={{ fontFamily: font.displayBold, fontSize: 18, marginTop: 2 }}>
            {pct(bond.coupon_rate)}
          </Text>
          <Text variant="caption" tone="muted" style={{ marginTop: 2 }} numberOfLines={1}>
            {freqLabel(bond.coupon_frequency)} · Matures {fmtDate(bond.maturity_date)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="overline" tone="faint" caps>
            Price / ₹100
          </Text>
          <Text
            style={{
              fontFamily: font.displayBold,
              fontSize: 18,
              marginTop: 2,
              color: p.accent.DEFAULT,
            }}
          >
            {bond.client_price != null ? `₹${Number(bond.client_price).toFixed(2)}` : '—'}
          </Text>
        </View>
      </View>
    </Card>
  );
}
