/**
 * Placing an order — a lump sum, or a SIP.
 *
 * The money is not the last step. BSE requires the INVESTOR to approve the
 * order at a BSE-hosted link before it can even be paid for; until they do it
 * sits at `mem_2fa = 'p'` and nothing happens. So `twoFaUrl` on the result is
 * treated as the next action rather than a footnote — the confirmation screen
 * leads with it.
 *
 * ## Why the amount is a keypad and not a slider
 *
 * People invest round numbers they have decided on. The quick chips cover the
 * common ones; the field takes anything else.
 */
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import * as Haptics from 'expo-haptics';
import { ArrowRight, CalendarClock, CheckCircle2, ShieldCheck, TrendingUp } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { fmt, fmtDate } from '@shared/crm/utils';
import { useMfCatalog } from '@shared/portal/hooks/useMfCatalog';
import { usePlaceOrder } from '@shared/portal/hooks/usePlaceOrder';
import type { OrderType, SipFrequency } from '@shared/portal/types/funds';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Button } from '@/ui/Button';
import { Input } from '@/ui/Input';
import { ErrorState, Segmented, StatusPill } from '@/ui/kit';

const LUMPSUM_CHIPS = [5_000, 10_000, 25_000, 50_000, 100_000];
const SIP_CHIPS = [1_000, 2_500, 5_000, 10_000, 25_000];
/** BSE accepts a limited set of debit days; these are the common ones. */
const SIP_DAYS = [1, 5, 10, 15, 20, 25];

export default function InvestOrder() {
  const { code, mode } = useLocalSearchParams<{ code?: string; mode?: string }>();
  const clientId = useClientId();
  const p = usePalette();
  const { funds } = useMfCatalog();
  const { submit, placing, result, error } = usePlaceOrder();

  const orderType: OrderType = mode === 'sip' ? 'sip' : 'lumpsum';
  const fund = useMemo(() => funds.find((f) => f.amfiCode === code) ?? null, [funds, code]);

  const [amount, setAmount] = useState('');
  const [sipDay, setSipDay] = useState(5);
  const [frequency, setFrequency] = useState<SipFrequency>('Monthly');
  const [localError, setLocalError] = useState('');

  const value = Number(amount) || 0;
  const minimum = fund?.minInvestment ?? (orderType === 'sip' ? 500 : 5_000);
  const valid = value >= minimum;

  const place = async () => {
    setLocalError('');
    if (!fund) return;
    if (!valid) {
      setLocalError(`The minimum for this fund is ${fmt(minimum)}.`);
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await submit({
      schemeCode: fund.amfiCode,
      clientId,
      type: orderType,
      plan: 'Growth',
      amount: value,
      ...(orderType === 'sip' ? { sipDay, sipFrequency: frequency } : {}),
    });
  };

  if (!fund) {
    return (
      <Screen>
        <ScreenHeader title="Invest" showBack />
        <ErrorState message="That fund is no longer in the catalog." />
      </Screen>
    );
  }

  /* ------------------------------ confirmation ---------------------------- */

  if (result) {
    return (
      <Screen>
        <ScreenHeader title="Order placed" />
        <Animated.View entering={FadeIn.duration(300)} style={{ gap: space[5] }}>
          <Card padding={5} style={{ alignItems: 'center', gap: space[3] }}>
            <CheckCircle2 size={44} color={p.state.successSoft} strokeWidth={1.7} />
            <Text variant="h3" center>
              {result.type === 'sip' ? 'Your SIP is registered' : 'Your investment is placed'}
            </Text>
            <Text variant="money" tone="accent">
              {fmt(result.amount)}
            </Text>
            <Text variant="small" tone="muted" center>
              {result.schemeName}
            </Text>
            <Text variant="caption" tone="faint" center>
              Order {result.orderId} · units expected against the NAV of{' '}
              {fmtDate(result.expectedNavDate)}
            </Text>
            {result.isMock ? <StatusPill tone="warning" label="Illustrative — no money moved" /> : null}
          </Card>

          {/* The order does nothing until this is done. It leads. */}
          {result.twoFaUrl ? (
            <Card padding={5} style={{ borderColor: p.accent.tint(0.4) }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
                <ShieldCheck size={20} color={p.accent.DEFAULT} />
                <Text variant="h3" style={{ flex: 1 }}>
                  One more step
                </Text>
              </View>
              <Text variant="small" tone="secondary" style={{ marginTop: space[2] }}>
                BSE needs you to approve this order yourself. Until you do, it cannot be paid for
                and no units are bought.
              </Text>
              <View style={{ marginTop: space[4] }}>
                <Button
                  label="Approve with BSE"
                  icon={ArrowRight}
                  iconRight
                  onPress={() => void WebBrowser.openBrowserAsync(result.twoFaUrl!)}
                  fullWidth
                  size="lg"
                />
              </View>
            </Card>
          ) : null}

          <Button
            label={result.type === 'sip' ? 'See my plans' : 'See my portfolio'}
            variant="secondary"
            onPress={() =>
              router.replace(result.type === 'sip' ? '/(client)/sip' : '/(client)/portfolio')
            }
            fullWidth
          />
        </Animated.View>
      </Screen>
    );
  }

  /* --------------------------------- form --------------------------------- */

  const chips = orderType === 'sip' ? SIP_CHIPS : LUMPSUM_CHIPS;

  return (
    <Screen>
      <ScreenHeader
        title={orderType === 'sip' ? 'Start a SIP' : 'Invest a lump sum'}
        subtitle={fund.name}
        showBack
      />

      <View style={{ gap: space[5] }}>
        {localError || error ? (
          <View
            accessibilityLiveRegion="polite"
            style={{
              backgroundColor: `${p.state.dangerSoft}1A`,
              borderColor: `${p.state.dangerSoft}40`,
              borderWidth: 1,
              borderRadius: radius.md,
              paddingHorizontal: space[4],
              paddingVertical: space[3],
            }}
          >
            <Text variant="small" tone="danger">
              {localError || error}
            </Text>
          </View>
        ) : null}

        <Animated.View entering={FadeInDown.duration(400)}>
          <Card padding={5}>
            <Text variant="overline" tone="muted" caps>
              {orderType === 'sip' ? 'Amount per instalment' : 'Amount'}
            </Text>
            <Input
              format="amount"
              placeholder="0"
              value={amount}
              onChangeText={(v) => setAmount(v.replace(/\D/g, '').slice(0, 9))}
              keyboardType="number-pad"
              editable={!placing}
              containerStyle={{ marginTop: space[3] }}
              hint={`Minimum ${fmt(minimum)}`}
            />

            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginTop: space[4] }}>
              {chips.map((chip) => (
                <Text
                  key={chip}
                  variant="smallMedium"
                  accessibilityRole="button"
                  onPress={() => {
                    void Haptics.selectionAsync();
                    setAmount(String(chip));
                  }}
                  style={{
                    paddingHorizontal: space[3],
                    paddingVertical: space[2],
                    borderRadius: radius.full,
                    overflow: 'hidden',
                    borderWidth: 1,
                    borderColor: value === chip ? p.accent.DEFAULT : p.border.DEFAULT,
                    backgroundColor: value === chip ? p.accent.tint(0.14) : 'transparent',
                    color: value === chip ? p.accent.DEFAULT : p.text.secondary,
                  }}
                >
                  {fmt(chip)}
                </Text>
              ))}
            </View>
          </Card>
        </Animated.View>

        {orderType === 'sip' ? (
          <Animated.View entering={FadeInDown.duration(400).delay(60)} style={{ gap: space[4] }}>
            <View>
              <Text variant="overline" tone="muted" caps style={{ marginBottom: space[3] }}>
                How often
              </Text>
              <Segmented<SipFrequency>
                value={frequency}
                onChange={setFrequency}
                options={[
                  { value: 'Monthly', label: 'Monthly' },
                  { value: 'Quarterly', label: 'Quarterly' },
                ]}
              />
            </View>

            <View>
              <Text variant="overline" tone="muted" caps style={{ marginBottom: space[3] }}>
                Debit day
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space[2] }}>
                {SIP_DAYS.map((day) => (
                  <Text
                    key={day}
                    variant="smallMedium"
                    accessibilityRole="button"
                    accessibilityState={{ selected: sipDay === day }}
                    onPress={() => {
                      void Haptics.selectionAsync();
                      setSipDay(day);
                    }}
                    style={{
                      minWidth: 46,
                      textAlign: 'center',
                      paddingHorizontal: space[3],
                      paddingVertical: space[2],
                      borderRadius: radius.full,
                      overflow: 'hidden',
                      borderWidth: 1,
                      borderColor: sipDay === day ? p.accent.DEFAULT : p.border.DEFAULT,
                      backgroundColor: sipDay === day ? p.accent.tint(0.14) : 'transparent',
                      color: sipDay === day ? p.accent.DEFAULT : p.text.secondary,
                    }}
                  >
                    {day}
                  </Text>
                ))}
              </View>
              <Text variant="caption" tone="faint" style={{ marginTop: space[2] }}>
                Your bank is debited on this day each {frequency === 'Monthly' ? 'month' : 'quarter'}.
              </Text>
            </View>
          </Animated.View>
        ) : null}

        <Button
          label={orderType === 'sip' ? 'Start this SIP' : 'Invest now'}
          icon={orderType === 'sip' ? CalendarClock : TrendingUp}
          onPress={() => void place()}
          loading={placing}
          disabled={!valid || placing}
          fullWidth
          size="lg"
        />

        <Text variant="caption" tone="faint" center>
          Mutual fund investments are subject to market risk. Read all scheme-related documents
          carefully.
        </Text>
      </View>
    </Screen>
  );
}
