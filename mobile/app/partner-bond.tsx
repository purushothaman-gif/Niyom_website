/**
 * One bond, as the partner sees it — the terms, their pricing, and what they can
 * do with it.
 *
 * ## Two of the web portal's three actions
 *
 * Order for a client and Share are here. The **marketing image is not**, and
 * cannot be until it is rebuilt: `src/crm/bonds/bondOutputs.ts` renders it by
 * building a DOM subtree and rasterising it with html2canvas, then handing the
 * data URL to an `<a download>`. None of `document`, html2canvas or that anchor
 * exists in React Native. Pretending otherwise with a half-working version would
 * be worse than pointing at the portal, so the card below says where to get it.
 *
 * ## Sharing is better here than on the web
 *
 * The web modal offers Copy and a WhatsApp deep link — a guess at where the
 * partner wants to send it. A phone has the real answer: the OS share sheet
 * lists every app the partner actually has, and it is one tap. So the generated
 * link goes straight into `Share.share` rather than into a link list.
 *
 * Cost never travels: the token carries a bond and a margin, and the public page
 * resolves the price server-side. See the `bm_public_analytics` invariant.
 */
import { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Share, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import {
  Check,
  Copy,
  ImageDown,
  Landmark,
  Link2,
  Share2,
  ShieldCheck,
  UserPlus,
  X,
} from 'lucide-react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { fmt, fmtDate, fmtFull } from '@shared/crm/utils';
import { PartnerService, type PartnerBond } from '@shared/partner/services/PartnerService';
import {
  clampMargin,
  isMarginValid,
  partnerPricePer100,
} from '@shared/partner/bonds/partnerBondMath';
import { tenureLabel } from '@shared/portal/bonds/bondMath';
import { PUBLIC_SITE_ORIGIN } from '@shared/marketing/marketingConstants';
import { font, radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { usePartnerBond } from '@/features/partner/bonds/queries';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Input } from '@/ui/Input';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, Segmented, SkeletonScreen, StatusPill } from '@/ui/kit';

type Section = 'summary' | 'details';

const pct = (v: number | null | undefined) => (v == null ? '—' : `${Number(v).toFixed(2)}%`);
const rupee2 = (v: number | null | undefined) => (v == null ? '—' : `₹${Number(v).toFixed(2)}`);

function cap(s: string | null | undefined): string {
  if (!s) return '—';
  return s.length <= 4 ? s.toUpperCase() : s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export default function PartnerBondDetail() {
  const p = usePalette();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { data: bond, loading, error, refresh } = usePartnerBond(id);
  const [showShare, setShowShare] = useState(false);

  if (loading) {
    return (
      <Screen>
        <ScreenHeader title="Bond" showBack />
        <SkeletonScreen rows={4} />
      </Screen>
    );
  }

  if (error || !bond) {
    return (
      <Screen>
        <ScreenHeader title="Bond" showBack />
        {error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : (
          <EmptyState
            icon={Landmark}
            title="This bond isn't available to you"
            message="It may have been withdrawn, or your pricing for it hasn't been approved. Your relationship manager can tell you what else you can offer."
          />
        )}
      </Screen>
    );
  }

  const summaryRows: Array<[string, string]> = [
    ['Coupon rate', pct(bond.coupon_rate)],
    ['Coupon type', cap(bond.coupon_type)],
    ['Interest payment', cap(bond.coupon_frequency)],
    ['Face value', fmtFull(Number(bond.face_value) || 0)],
    ['Maturity date', fmtDate(bond.maturity_date)],
    ['Next coupon', fmtDate(bond.next_coupon_date)],
    ['Yield to maturity', pct(bond.analytics?.ytm)],
    ['Tenure', tenureLabel(bond)],
  ];
  const detailRows: Array<[string, string]> = [
    ['ISIN', bond.isin || '—'],
    ['Issuer', bond.issuer_name || '—'],
    ['Security type', cap(bond.security_type)],
    ['Seniority', cap(bond.seniority)],
    ['Principal repayment', cap(bond.principal_repayment_structure)],
    ['Day-count convention', bond.day_count_convention || '—'],
    ['Rating', bond.rating ? `${bond.rating}${bond.rating_agency ? ` · ${bond.rating_agency}` : ''}` : '—'],
    ['Tax status', cap(bond.tax_status)],
    ['Trustee', bond.trustee || '—'],
    ['Issue date', fmtDate(bond.issue_date)],
  ];

  return (
    <Screen scroll={false}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: space[6] }}>
        <ScreenHeader title="Bond" showBack />

        <Animated.View entering={FadeIn.duration(300)} style={{ gap: space[4] }}>
          {/* Hero */}
          <Card padding={5} style={{ gap: space[4] }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: space[3] }}>
              <View
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: radius.lg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: p.accent.tint(0.12),
                }}
              >
                <Landmark size={21} color={p.accent.DEFAULT} strokeWidth={1.9} />
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="h3">{bond.bond_name || bond.issuer_name || bond.isin}</Text>
                <Text variant="caption" tone="faint" style={{ marginTop: 3 }}>
                  {bond.issuer_name ? `${bond.issuer_name} · ` : ''}
                  {bond.isin}
                </Text>
              </View>
              {bond.rating ? <StatusPill label={bond.rating} tone="accent" /> : null}
            </View>

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[4] }}>
              <HeroFigure
                label={bond.analytics?.ytm != null ? 'Yield (YTM)' : 'Coupon'}
                value={pct(bond.analytics?.ytm ?? bond.coupon_rate)}
                tone="positive"
              />
              <HeroFigure label="Coupon" value={pct(bond.coupon_rate)} />
              <HeroFigure label="Tenure" value={tenureLabel(bond)} />
              <HeroFigure
                label="Min. Investment"
                value={fmt(Number(bond.min_investment) || Number(bond.face_value) || 0)}
              />
            </View>
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
              <Row label="Your cost / ₹100" value={rupee2(bond.partner_base)} />
              <Row label="Your markup" value={pct(bond.self_markup_percent)} />
              <View style={{ borderTopWidth: 1, borderTopColor: p.border.subtle, paddingTop: space[2] }}>
                <Row label="Your price / ₹100" value={rupee2(bond.partner_price)} strong accent />
              </View>
            </View>
            <View style={{ flexDirection: 'row', gap: space[2] }}>
              <ShieldCheck size={13} color={p.state.successSoft} style={{ marginTop: 1 }} />
              <Text variant="caption" tone="faint" style={{ flex: 1 }}>
                Your cost is set by your relationship manager and is never shown to a client.
                Prices are indicative; final terms are confirmed on the deal confirmation.
              </Text>
            </View>
          </Card>

          {/* Terms */}
          <SectionRows summaryRows={summaryRows} detailRows={detailRows} />

          {/* The one action that stayed on the web */}
          <Card weight="surface" padding={4} style={{ flexDirection: 'row', gap: space[3] }}>
            <ImageDown size={16} color={p.text.faint} style={{ marginTop: 1 }} />
            <View style={{ flex: 1 }}>
              <Text variant="smallMedium">Marketing image</Text>
              <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                The brochure and promo images are generated in the browser, so they are still on
                the partner portal on niyomwealth.com — open this bond there to download one.
              </Text>
            </View>
          </Card>
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
            router.push(`/partner-bond-order?id=${bond.id}`);
          }}
        />
        <Button
          label="Share with a client"
          icon={Share2}
          variant="secondary"
          fullWidth
          onPress={() => setShowShare(true)}
        />
      </View>

      {showShare ? <ShareSheet bond={bond} onClose={() => setShowShare(false)} /> : null}
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */
/*  Share                                                                     */
/* -------------------------------------------------------------------------- */

function ShareSheet({ bond, onClose }: { bond: PartnerBond; onClose: () => void }) {
  const p = usePalette();
  const [margin, setMargin] = useState(String(bond.self_markup_percent ?? 0));
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const preview = useMemo(() => partnerPricePer100(bond, margin), [bond, margin]);
  const valid = isMarginValid(margin);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const token = await PartnerService.createBondShare(bond.id, clampMargin(margin));
      setLink(`${PUBLIC_SITE_ORIGIN}/bond-offer?t=${token}`);
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
      await Share.share({
        message: `${bond.bond_name || bond.isin} — view details & invest: ${link}`,
      });
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
            A link for {bond.bond_name || bond.isin}. Your client sees the bond at your price and
            can request to invest — the order reaches your RM.
          </Text>

          {!link ? (
            <>
              <View>
                <Text variant="overline" tone="faint" caps style={{ marginBottom: space[2] }}>
                  Your margin for this link
                </Text>
                <Input
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
                <Row label="Client sees / ₹100" value={rupee2(preview)} strong accent />
                <Text variant="caption" tone="faint">
                  Your cost {rupee2(bond.partner_base)} + your margin {pct(clampMargin(margin))}.
                  Your cost is never shown to the client.
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

function HeroFigure({ label, value, tone }: { label: string; value: string; tone?: 'positive' }) {
  const p = usePalette();
  return (
    <View style={{ minWidth: 78, flexGrow: 1, flexBasis: '40%' }}>
      <Text variant="caption" tone="faint" numberOfLines={1}>
        {label}
      </Text>
      <Text
        style={{
          fontFamily: font.displayBold,
          fontSize: 19,
          marginTop: 3,
          color: tone === 'positive' ? p.state.successSoft : p.text.primary,
        }}
      >
        {value}
      </Text>
    </View>
  );
}

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

function SectionRows({
  summaryRows,
  detailRows,
}: {
  summaryRows: Array<[string, string]>;
  detailRows: Array<[string, string]>;
}) {
  const p = usePalette();
  const [section, setSection] = useState<Section>('summary');
  const rows = section === 'summary' ? summaryRows : detailRows;

  return (
    <View style={{ gap: space[3] }}>
      <Segmented<Section>
        options={[
          { value: 'summary', label: 'Summary' },
          { value: 'details', label: 'Other details' },
        ]}
        value={section}
        onChange={setSection}
      />

      <Card padding={4}>
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
    </View>
  );
}
