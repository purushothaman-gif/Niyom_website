/**
 * Invite a client to import their outside holdings.
 *
 * A partner cannot run the import for a client, and should not be able to: the
 * statement is locked to the client's PAN and a demat fetch is authorised by an
 * OTP on the client's own phone. What the partner can do is send the client to
 * the right door — the link signs them in and opens the import hub.
 *
 * The copy promises only what is true: the client sees everything in their own
 * portal. Imported holdings are NOT in the partner's client book, so nothing
 * here says they will be.
 */
import { useState } from 'react';
import { Share, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Check, Copy, PackagePlus, Share2 } from 'lucide-react-native';
import { PUBLIC_SITE_ORIGIN } from '@shared/marketing/marketingConstants';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';

const LINK = `${PUBLIC_SITE_ORIGIN}/client-login?import=1`;
const MESSAGE = `See all your investments in one place on Niyom Wealth. Sign in and import your mutual funds, shares, bonds and NPS held elsewhere — it takes a few minutes:\n${LINK}`;

export function InviteImportCard() {
  const p = usePalette();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(LINK);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the link is on screen to copy by hand */
    }
  };

  const share = async () => {
    try {
      await Share.share({ message: MESSAGE });
    } catch {
      /* share sheet dismissed */
    }
  };

  return (
    <Card padding={4} style={{ borderColor: p.accent.tint(0.3), gap: space[3] }}>
      <View style={{ flexDirection: 'row', gap: space[3] }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: radius.md,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: p.accent.tint(0.12),
          }}
        >
          <PackagePlus size={19} color={p.accent.DEFAULT} />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="bodyMedium">Help your clients see everything they own in one place</Text>
          <Text variant="small" tone="muted" style={{ marginTop: 4 }}>
            Send this link to a client. They sign in and import the mutual funds, shares, bonds and
            NPS they hold elsewhere, alongside what they bought through you.
          </Text>
          <Text variant="caption" tone="faint" numberOfLines={1} style={{ marginTop: 6 }}>
            {LINK}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', gap: space[2] }}>
        <Button
          label={copied ? 'Copied' : 'Copy link'}
          icon={copied ? Check : Copy}
          variant="secondary"
          size="sm"
          onPress={() => void copy()}
          style={{ flex: 1 }}
        />
        <Button label="Share" icon={Share2} size="sm" onPress={() => void share()} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}
