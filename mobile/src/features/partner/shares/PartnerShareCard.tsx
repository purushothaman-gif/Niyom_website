/**
 * An unlisted share as the PARTNER sees it in the list: their cost and what they
 * sell at, side by side — the gap is their income. "Your cost" is labelled
 * rather than left as a bare number, so a partner showing this screen to a
 * client is in no doubt about what they are showing them.
 */
import { View } from 'react-native';
import type { PartnerShare } from '@shared/partner/services/PartnerService';
import { minQty } from '@shared/portal/shares/shareMath';
import { font, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { ShareLogo } from './ShareLogo';
import { rupee2, sharesLabel } from './format';

export function PartnerShareCard({ share, onPress }: { share: PartnerShare; onPress: () => void }) {
  const p = usePalette();
  const name = share.short_name || share.company_name;

  return (
    <Card onPress={onPress} padding={4} style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
        <ShareLogo name={name} url={share.logo_url} size={40} />
        <View style={{ flex: 1 }}>
          <Text variant="bodyMedium" numberOfLines={2}>
            {name}
          </Text>
          <Text variant="caption" tone="faint" style={{ marginTop: 1 }} numberOfLines={1}>
            {share.isin}
            {share.sector ? ` · ${share.sector}` : ''}
          </Text>
        </View>
      </View>

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
            Your cost
          </Text>
          <Text style={{ fontFamily: font.displayBold, fontSize: 17, marginTop: 2, color: p.text.primary }}>
            {rupee2(share.partner_base)}
          </Text>
          <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
            Minimum {sharesLabel(minQty(share))}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="overline" tone="faint" caps>
            Your price / share
          </Text>
          <Text
            style={{
              fontFamily: font.displayBold,
              fontSize: 18,
              marginTop: 2,
              color: p.accent.DEFAULT,
            }}
          >
            {rupee2(share.partner_price)}
          </Text>
        </View>
      </View>
    </Card>
  );
}
