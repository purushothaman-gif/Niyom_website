/**
 * Partner "Sell today" cards — the client-facing figure plus what the partner's
 * own spread adds on a ₹1 lakh deal, and the selling actions used most.
 *
 * The spread figure comes ONLY from shared/partner/sell/sellMath (which defers
 * to partnerBondMath / partnerShareMath). It is the spread, not the partner's
 * whole income — payouts are computed in the CRM and never here — so it is
 * labelled "Spread", not "You earn".
 */
import { View } from 'react-native';
import { Gem, Link2, ShoppingBag } from 'lucide-react-native';
import { fmt } from '@shared/crm/utils';
import type { PartnerBond, PartnerShare } from '@shared/partner/services/PartnerService';
import { bondEarnPerLakh, shareEarnPerLakh } from '@shared/partner/sell/sellMath';
import { font, radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { PartnerBondCard } from '../bonds/PartnerBondCard';

function EarnLine({ earn, margin }: { earn: number | null; margin: number | null }) {
  const p = usePalette();
  if (earn == null || earn <= 0) {
    return (
      <Text variant="caption" tone="faint">
        No spread set — client sees your base price
      </Text>
    );
  }
  return (
    <View
      style={{
        backgroundColor: `${p.state.successSoft}1A`,
        borderRadius: radius.md,
        paddingHorizontal: space[3],
        paddingVertical: space[2],
      }}
    >
      <Text variant="smallMedium" style={{ color: p.state.successSoft }}>
        Spread {fmt(earn)} / ₹1 L{margin != null ? ` · ${margin}%` : ''}
      </Text>
    </View>
  );
}

function Actions({ onOrder, onShare }: { onOrder: () => void; onShare: () => void }) {
  return (
    <View style={{ flexDirection: 'row', gap: space[2] }}>
      <Button
        label="Order for a client"
        icon={ShoppingBag}
        size="sm"
        onPress={onOrder}
        style={{ flex: 1 }}
      />
      <Button
        label="Share link"
        icon={Link2}
        size="sm"
        variant="secondary"
        onPress={onShare}
        style={{ flex: 1 }}
      />
    </View>
  );
}

export function PartnerBondSellCard({
  bond,
  onOpen,
  onOrder,
  onShare,
}: {
  bond: PartnerBond;
  onOpen: () => void;
  onOrder: () => void;
  onShare: () => void;
}) {
  return (
    <View style={{ gap: space[2] }}>
      <PartnerBondCard bond={bond} onPress={onOpen} />
      <EarnLine earn={bondEarnPerLakh(bond)} margin={bond.self_markup_percent} />
      <Actions onOrder={onOrder} onShare={onShare} />
    </View>
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
  const p = usePalette();
  const price = Number(share.partner_price) || 0;
  const base = Number(share.partner_base) || 0;
  return (
    <View style={{ gap: space[2] }}>
      <Card onPress={onOpen} padding={4}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
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
            <Gem size={18} color={p.accent.DEFAULT} strokeWidth={2} />
          </View>
          <View style={{ flex: 1 }}>
            <Text variant="bodyMedium" numberOfLines={2}>
              {share.short_name || share.company_name}
            </Text>
            <Text variant="caption" tone="faint" numberOfLines={1} style={{ marginTop: 1 }}>
              {[share.sector, share.isin].filter(Boolean).join(' · ')}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text variant="overline" tone="faint" caps>
              Your price
            </Text>
            <Text style={{ fontFamily: font.displayBold, fontSize: 17, color: p.accent.DEFAULT }}>
              {price > 0 ? `₹${price.toFixed(2)}` : '—'}
            </Text>
            {base > 0 ? (
              <Text variant="caption" tone="faint">
                your cost ₹{base.toFixed(2)}
              </Text>
            ) : null}
          </View>
        </View>
      </Card>
      <EarnLine earn={shareEarnPerLakh(share)} margin={share.self_markup_percent} />
      <Actions onOrder={onOrder} onShare={onShare} />
    </View>
  );
}
