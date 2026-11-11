/**
 * An unlisted share as it appears in the marketplace list, plus the logo tile
 * the detail and review screens reuse.
 *
 * Same two figures, same wording as the website card (Price / share, Min.
 * quantity). The whole card is the tap target — a phone list does not need a
 * separate "View details" button under every row.
 */
import { useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { fmtFull } from '@shared/crm/utils';
import type { ClientShare } from '@shared/portal/services/ShareOrderService';
import { minQty } from '@shared/portal/shares/shareMath';
import { font, radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { StatusPill } from '@/ui/kit';

export const shareTitle = (s: Pick<ClientShare, 'short_name' | 'company_name' | 'isin'>) =>
  s.short_name || s.company_name || s.isin;

export const sharesLabel = (n: number) => `${n} share${n === 1 ? '' : 's'}`;

/** The company's logo, or its initial on a tinted tile when there is none (or it fails to load). */
export function ShareLogo({ name, url, size = 40 }: { name: string; url: string | null; size?: number }) {
  const p = usePalette();
  const [failed, setFailed] = useState(false);
  const box = {
    width: size,
    height: size,
    borderRadius: radius.sm + 2,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    overflow: 'hidden' as const,
  };

  if (url && !failed) {
    return (
      <View style={[box, { backgroundColor: '#FFFFFF' }]}>
        <Image
          source={{ uri: url }}
          style={{ width: size - 8, height: size - 8 }}
          contentFit="contain"
          onError={() => setFailed(true)}
        />
      </View>
    );
  }

  return (
    <View style={[box, { backgroundColor: p.accent.tint(0.12) }]}>
      <Text style={{ fontFamily: font.displayBold, fontSize: size * 0.42, color: p.accent.DEFAULT }}>
        {(name.trim().charAt(0) || '?').toUpperCase()}
      </Text>
    </View>
  );
}

export function ShareCard({ share, onPress }: { share: ClientShare; onPress: () => void }) {
  const p = usePalette();
  const min = minQty(share);
  const title = shareTitle(share);

  return (
    <Card onPress={onPress} padding={4} style={{ gap: space[3] }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
        <ShareLogo name={title} url={share.logo_url} />
        <View style={{ flex: 1 }}>
          <Text variant="bodyMedium" numberOfLines={2}>
            {title}
          </Text>
          <Text variant="caption" tone="faint" style={{ marginTop: 1 }} numberOfLines={1}>
            {share.isin}
          </Text>
        </View>
      </View>

      {share.sector ? <StatusPill label={share.sector} tone="accent" /> : null}

      {share.short_name && share.company_name !== share.short_name ? (
        <Text variant="small" tone="secondary" numberOfLines={1}>
          {share.company_name}
        </Text>
      ) : null}

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
            Min. quantity
          </Text>
          <Text style={{ fontFamily: font.displayBold, fontSize: 16, marginTop: 2, color: p.text.primary }}>
            {sharesLabel(min)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="overline" tone="faint" caps>
            Price / share
          </Text>
          <Text style={{ fontFamily: font.displayBold, fontSize: 18, marginTop: 2, color: p.accent.DEFAULT }}>
            {share.client_price != null ? fmtFull(Number(share.client_price)) : '—'}
          </Text>
        </View>
      </View>
    </Card>
  );
}
