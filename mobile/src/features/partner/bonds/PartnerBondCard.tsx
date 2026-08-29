/**
 * A bond as the PARTNER sees it in the list.
 *
 * The difference from the client card is the price block: a partner sees both
 * their cost and what they sell at, because the gap between the two is their
 * income and it is the number they are actually shopping on. A client never sees
 * either — they see one price the server computed, with cost stripped before it
 * leaves the database.
 *
 * That makes this screen the one place in the app where a cost figure is on
 * screen at all, which is why "Your cost" is labelled rather than left as a bare
 * number: a partner showing this screen to a client should be in no doubt about
 * what they are showing them.
 */
import { View } from 'react-native';
import { Landmark } from 'lucide-react-native';
import { fmt, fmtDate } from '@shared/crm/utils';
import type { PartnerBond } from '@shared/partner/services/PartnerService';
import { tenureLabel } from '@shared/portal/bonds/bondMath';
import { font, radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { StatusPill } from '@/ui/kit';

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Number(v).toFixed(2)}%`);
const rupee2 = (v: number | null | undefined) =>
  v == null ? '—' : `₹${Number(v).toFixed(2)}`;

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

export function PartnerBondCard({ bond, onPress }: { bond: PartnerBond; onPress: () => void }) {
  const p = usePalette();
  const min = Number(bond.min_investment) || Number(bond.face_value) || null;
  const hasYtm = bond.analytics?.ytm != null;

  return (
    <Card onPress={onPress} padding={4} style={{ gap: space[3] }}>
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

      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <Figure
          label={hasYtm ? 'Yield (YTM)' : 'Coupon'}
          value={pct(hasYtm ? bond.analytics?.ytm : bond.coupon_rate)}
          tone="positive"
        />
        <Figure label="Tenure" value={tenureLabel(bond)} />
        <Figure label="Min. Invest" value={min != null ? fmt(min) : '—'} />
      </View>

      {/* Cost vs. selling price — the partner's whole decision */}
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
            Your price / ₹100
          </Text>
          <Text
            style={{
              fontFamily: font.displayBold,
              fontSize: 18,
              marginTop: 2,
              color: p.accent.DEFAULT,
            }}
          >
            {rupee2(bond.partner_price)}
          </Text>
          <Text variant="caption" tone="faint" style={{ marginTop: 1 }}>
            your cost {rupee2(bond.partner_base)}
          </Text>
        </View>
      </View>
    </Card>
  );
}
