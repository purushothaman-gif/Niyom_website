/**
 * One unlisted share, as the partner sees it — the company, their pricing, and
 * what they can do with it: order for a client, or share an offer link.
 *
 * Sharing uses the OS share sheet rather than the web modal's Copy + WhatsApp
 * pair, for the same reason as partner bonds: the phone already knows which apps
 * the partner has. The link is the website's public `/share-offer?t=<token>`.
 *
 * Cost never travels: the token carries a share and a margin, and the public
 * page resolves ONE price server-side. The preview here comes from the shared
 * `partnerShareMath`, the same file the website and the order screen use.
 */
import { useMemo, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import {
  Check,
  Copy,
  ExternalLink,
  Gem,
  Link2,
  Percent,
  Share2,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { PartnerService, type PartnerShare } from '@shared/partner/services/PartnerService';
import {
  MAX_PARTNER_SHARE_MARGIN,
  clampShareMargin,
  isShareMarginValid,
  partnerSharePrice,
} from '@shared/partner/shares/partnerShareMath';
import { minQty, stepQty } from '@shared/portal/shares/shareMath';
import { PUBLIC_SITE_ORIGIN } from '@shared/marketing/marketingConstants';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { ShareLogo } from '@/features/partner/shares/ShareLogo';
import { pctLabel, rupee2, sharesLabel } from '@/features/partner/shares/format';
import { usePartnerShare } from '@/features/partner/shares/queries';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Input } from '@/ui/Input';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, SkeletonScreen, StatusPill } from '@/ui/kit';

export default function PartnerShareDetail() {
  const p = usePalette();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data: share, loading, error, refresh } = usePartnerShare(id);
  const [showLink, setShowLink] = useState(false);

  if (loading) {
    return (
      <Screen>
        <ScreenHeader title="Unlisted share" showBack />
        <SkeletonScreen rows={4} />
      </Screen>
    );
  }

  if (error || !share) {
    return (
      <Screen>
        <ScreenHeader title="Unlisted share" showBack />
        {error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : (
          <EmptyState
            icon={Gem}
            title="This share isn't available to you"
            message="It may have been withdrawn, or your pricing for it hasn't been approved. Your relationship manager can tell you what else you can offer."
          />
        )}
      </Screen>
    );
  }

  const name = share.short_name || share.company_name;
  const min = minQty(share);
  const step = stepQty(share);
  const website = share.website;

  const rows: Array<[string, string]> = [
    ['ISIN', share.isin || '—'],
    ['Company', share.company_name || '—'],
    ['Sector', share.sector || '—'],
    ['Face value', share.face_value != null ? rupee2(share.face_value) : '—'],
    ['Minimum quantity', sharesLabel(min)],
    ['Lot size', sharesLabel(step)],
  ];

  return (
    <Screen scroll={false}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[6] }}>
        <ScreenHeader title="Unlisted share" showBack />

        <Animated.View entering={FadeIn.duration(300)} style={{ gap: space[4] }}>
          {/* Hero */}
          <Card padding={5}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
              <ShareLogo name={name} url={share.logo_url} size={48} />
              <View style={{ flex: 1 }}>
                <Text variant="h3">{name}</Text>
                <Text variant="caption" tone="faint" style={{ marginTop: 3 }}>
                  {share.company_name} · {share.isin}
                </Text>
              </View>
            </View>
            {share.sector ? (
              <View style={{ flexDirection: 'row', marginTop: space[3] }}>
                <StatusPill label={share.sector} tone="accent" />
              </View>
            ) : null}
          </Card>

          {/* Your pricing — the partner-only block */}
          <Card padding={4} style={{ gap: space[3] }}>
            <Text variant="overline" tone="faint" caps>
              Your pricing
            </Text>
            <View
              style={{
                gap: space[2],
                borderRadius: radius.md,
                backgroundColor: p.bg.surface,
                padding: space[3],
              }}
            >
              <Row label="Your cost / share" value={rupee2(share.partner_base ?? 0)} />
              <Row label="Your markup" value={pctLabel(Number(share.self_markup_percent) || 0)} />
              <View style={{ borderTopWidth: 1, borderTopColor: p.border.subtle, paddingTop: space[2] }}>
                <Row label="Your price / share" value={rupee2(share.partner_price ?? 0)} strong accent />
              </View>
            </View>
            <Text variant="caption" tone="muted">
              Minimum {sharesLabel(min)} — about {rupee2((share.partner_price ?? 0) * min)} at your
              price.
            </Text>
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <ShieldCheck size={13} color={p.state.successSoft} style={{ marginTop: 1 }} />
              <Text variant="caption" tone="faint" style={{ flex: 1 }}>
                Your cost is never shown to a client — they only see your price.
              </Text>
            </View>
          </Card>

          {share.about ? (
            <Card padding={4} style={{ gap: space[2] }}>
              <Text variant="smallMedium">About the company</Text>
              <Text variant="small" tone="secondary">
                {share.about}
              </Text>
              {website ? (
                <Pressable
                  onPress={() => void Linking.openURL(website).catch(() => undefined)}
                  hitSlop={8}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space[1] + 2, marginTop: space[1] }}
                >
                  <Text variant="caption" tone="accent">
                    Visit website
                  </Text>
                  <ExternalLink size={12} color={p.accent.DEFAULT} />
                </Pressable>
              ) : null}
            </Card>
          ) : null}

          <Card padding={4}>
            <Text variant="smallMedium" style={{ marginBottom: space[1] }}>
              Security details
            </Text>
            {rows.map(([k, v], i) => (
              <View
                key={k}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: space[3],
                  paddingVertical: space[3],
                  borderBottomWidth: i === rows.length - 1 ? 0 : 1,
                  borderBottomColor: p.border.subtle,
                }}
              >
                <Text variant="small" tone="secondary" style={{ flex: 1 }}>
                  {k}
                </Text>
                <Text variant="smallMedium" style={{ flex: 1, textAlign: 'right' }}>
                  {v}
                </Text>
              </View>
            ))}
          </Card>

          <Text variant="caption" tone="faint">
            Unlisted shares are not exchange-traded. Prices are indicative, availability is
            confirmed by the client's relationship manager at the time of dealing, and settlement
            is off-market into the client's demat account. These instruments carry liquidity and
            valuation risk, and there is no assurance of a listing.
          </Text>
        </Animated.View>
      </ScrollView>

      {/* Pinned actions */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: p.border.DEFAULT,
          backgroundColor: p.bg.elevated,
          paddingTop: space[4],
          paddingBottom: space[2],
          gap: space[3],
          marginHorizontal: -space[5],
          paddingHorizontal: space[5],
        }}
      >
        <Button
          label="Order for a client"
          icon={UserPlus}
          fullWidth
          onPress={() => {
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            router.push(`/partner-share-order?id=${share.id}`);
          }}
        />
        <Button
          label="Share with a client"
          icon={Share2}
          variant="secondary"
          fullWidth
          onPress={() => setShowLink(true)}
        />
      </View>

      {showLink ? <LinkSheet share={share} onClose={() => setShowLink(false)} /> : null}
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/*  Offer link                                                                */
/* -------------------------------------------------------------------------- */

function LinkSheet({ share, onClose }: { share: PartnerShare; onClose: () => void }) {
  const p = usePalette();
  const [margin, setMargin] = useState(String(share.self_markup_percent ?? 0));
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const name = share.short_name || share.company_name;
  const preview = useMemo(() => partnerSharePrice(share, margin), [share, margin]);
  const valid = isShareMarginValid(margin);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await PartnerService.createShareLink(share.id, clampShareMargin(margin));
      setLink(`${PUBLIC_SITE_ORIGIN}/share-offer?t=${token}`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the link.');
    } finally {
      setBusy(false);
    }
  };

  const shareIt = async () => {
    if (!link) return;
    try {
      await Share.share({ message: `${name} (unlisted) — view details & invest: ${link}` });
    } catch {
      /* The user dismissing the share sheet is not an error worth reporting. */
    }
  };

  const copy = async () => {
    if (!link) return;
    await Clipboard.setStringAsync(link);
    setCopied(true);
    void Haptics.selectionAsync();
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal transparent animationType="slide" visible onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: p.bg.overlay, justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: p.bg.elevated,
            borderTopLeftRadius: radius.xl,
            borderTopRightRadius: radius.xl,
            padding: space[5],
            paddingBottom: space[8],
            gap: space[4],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="h3">Share with a client</Text>
            <Pressable onPress={onClose} hitSlop={12} accessibilityLabel="Close">
              <X size={20} color={p.text.muted} />
            </Pressable>
          </View>

          <Text variant="small" tone="secondary">
            A link for {name}. Your client sees the share at your price and can request to buy —
            the order reaches your RM.
          </Text>

          {!link ? (
            <>
              <View>
                <Text variant="overline" tone="faint" caps style={{ marginBottom: space[2] }}>
                  Your margin for this link (max {MAX_PARTNER_SHARE_MARGIN}%)
                </Text>
                <Input
                  icon={Percent}
                  placeholder="0"
                  value={margin}
                  onChangeText={setMargin}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
              </View>

              <View
                style={{
                  gap: space[1],
                  borderRadius: radius.md,
                  backgroundColor: p.bg.surface,
                  padding: space[3],
                }}
              >
                <Row label="Client sees / share" value={rupee2(preview)} strong accent />
                <Text variant="caption" tone="faint">
                  Your cost {rupee2(Number(share.partner_base) || 0)} + your margin{' '}
                  {pctLabel(clampShareMargin(margin))}. Your cost is never shown to the client.
                </Text>
              </View>

              {error ? (
                <Text variant="small" style={{ color: p.state.dangerSoft }}>
                  {error}
                </Text>
              ) : null}

              <Button
                label="Generate link"
                icon={Link2}
                fullWidth
                disabled={!valid}
                loading={busy}
                onPress={() => void generate()}
              />
            </>
          ) : (
            <>
              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: space[2],
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: p.border.DEFAULT,
                  backgroundColor: p.bg.surface,
                  padding: space[3],
                }}
              >
                <Link2 size={15} color={p.text.faint} />
                <Text variant="caption" tone="secondary" numberOfLines={1} style={{ flex: 1 }}>
                  {link}
                </Text>
              </View>

              <Button label="Share" icon={Share2} fullWidth onPress={() => void shareIt()} />
              <Button
                label={copied ? 'Copied' : 'Copy link'}
                icon={copied ? Check : Copy}
                variant="secondary"
                fullWidth
                onPress={() => void copy()}
              />

              <Text variant="caption" tone="faint" center>
                The link is valid for 30 days.
              </Text>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

/* -------------------------------------------------------------------------- */

function Row({
  label,
  value,
  strong,
  accent,
}: {
  label: string;
  value: string;
  strong?: boolean;
  accent?: boolean;
}) {
  const p = usePalette();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: space[3],
        paddingVertical: 2,
      }}
    >
      <Text variant="small" tone="secondary" style={{ flex: 1 }}>
        {label}
      </Text>
      <Text
        variant={strong ? 'moneySmall' : 'smallMedium'}
        style={{ textAlign: 'right', color: accent ? p.accent.DEFAULT : p.text.primary }}
      >
        {value}
      </Text>
    </View>
  );
}
