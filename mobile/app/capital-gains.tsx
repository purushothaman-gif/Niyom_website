/**
 * Capital Gains — realised gains by financial year, from the client's own CAS.
 *
 * The whole engine is `summariseFinancialYear` in `shared/portal/services/cas/
 * gains.ts` — FIFO lots, s.55(2)(ac) grandfathering, the ₹1L/₹1.25L long-term
 * equity exemption, and the equity/non-equity split. None of it is recomputed
 * here; this screen only presents what that returns.
 *
 * ## Why it says "indicative"
 *
 * A statutory rate exists for equity and for non-equity long-term gains, so a
 * number can be given. Everything else is taxed at the client's own slab, which
 * this app has no way of knowing, and gains on funds whose equity composition
 * is not yet decided cannot be classified at all. Those are shown as GAINS with
 * no tax beside them rather than folded into a total that would look complete
 * and be wrong.
 *
 * ## Why a fund can be missing
 *
 * A truncated statement means the ledger cannot explain every unit, and a
 * disposal computed from a partial history is a wrong number, not an
 * approximate one. Those funds are excluded and named, with the reason.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { AlertTriangle, Receipt, Upload } from 'lucide-react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { fmt, fmtFull, fmtDate } from '@shared/crm/utils';
import { CasGainsService, type GainsStatement } from '@shared/portal/services/CasGainsService';
import { summariseFinancialYear } from '@shared/portal/services/cas/gains';
import { radius, space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useClientId } from '@/features/auth/AuthContext';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { Money } from '@/ui/Money';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, Segmented, SkeletonScreen } from '@/ui/kit';

export default function CapitalGains() {
  const clientId = useClientId();
  const p = usePalette();

  const [statement, setStatement] = useState<GainsStatement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fy, setFy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await CasGainsService.getStatement(clientId);
      setStatement(next);
      setFy((current) => current ?? next?.financialYears[0] ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not work out your capital gains.');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const year = useMemo(() => {
    if (!statement || !fy) return null;
    return summariseFinancialYear(statement.disposals, fy);
  }, [statement, fy]);

  const disposals = useMemo(
    () =>
      (statement?.disposals ?? [])
        .filter((d) => d.fy === fy)
        .sort((a, b) => b.sellDate.localeCompare(a.sellDate)),
    [statement, fy],
  );

  return (
    <Screen onRefresh={load} refreshing={loading && !!statement}>
      <ScreenHeader
        title="Capital Gains"
        subtitle="Realised gains by financial year, worked out from your own statement."
        showBack
      />

      {loading && !statement ? (
        <SkeletonScreen rows={3} />
      ) : error ? (
        <ErrorState message={error} onRetry={load} />
      ) : !statement || statement.financialYears.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title="Nothing to report yet"
          message="Capital gains are worked out from your Consolidated Account Statement. Import one — and if you have, you may simply not have sold anything yet."
          action={
            <Button
              label="Import my statement"
              icon={Upload}
              onPress={() => router.push('/import-portfolio')}
            />
          }
        />
      ) : (
        <View style={{ gap: space[5] }}>
          {statement.financialYears.length > 1 ? (
            <Segmented<string>
              value={fy ?? statement.financialYears[0]}
              onChange={setFy}
              options={statement.financialYears.slice(0, 4).map((y) => ({ value: y, label: y }))}
            />
          ) : null}

          {year ? (
            <Animated.View key={fy ?? 'fy'} entering={FadeIn.duration(240)}>
              <Card padding={5}>
                <Text variant="overline" tone="muted" caps>
                  Realised gain · FY {year.fy}
                </Text>
                <Money
                  value={year.totalGain}
                  variant="money"
                  animate
                  tone={year.totalGain >= 0 ? 'success' : 'danger'}
                  style={{ marginTop: space[2] }}
                />

                <View
                  style={{
                    marginTop: space[4],
                    paddingTop: space[4],
                    borderTopWidth: 1,
                    borderTopColor: p.border.subtle,
                    gap: space[3],
                  }}
                >
                  <Bucket
                    label="Equity · long term"
                    gain={year.equityLong.gain}
                    tax={year.equityLong.tax}
                  />
                  <Bucket
                    label="Equity · short term"
                    gain={year.equityShort.gain}
                    tax={year.equityShort.tax}
                  />
                  <Bucket
                    label="Non-equity · long term"
                    gain={year.nonEquityLong.gain}
                    tax={year.nonEquityLong.tax}
                  />
                  {year.slab.gain !== 0 ? (
                    <Bucket label="Taxed at your slab" gain={year.slab.gain} tax={null} />
                  ) : null}
                  {year.undecided.gain !== 0 ? (
                    <Bucket
                      label={`Not yet classified (${year.undecided.schemes.length})`}
                      gain={year.undecided.gain}
                      tax={null}
                    />
                  ) : null}
                </View>

                {year.exemptionUsed > 0 ? (
                  <Text variant="caption" tone="muted" style={{ marginTop: space[4] }}>
                    {fmtFull(year.exemptionUsed)} of long-term equity gain was exempt this year.
                  </Text>
                ) : null}

                <View
                  style={{
                    marginTop: space[4],
                    paddingTop: space[4],
                    borderTopWidth: 1,
                    borderTopColor: p.border.subtle,
                    flexDirection: 'row',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                  }}
                >
                  <Text variant="smallMedium" tone="secondary">
                    Indicative tax
                  </Text>
                  <Text variant="moneySmall">{fmtFull(year.indicativeTax)}</Text>
                </View>
                <Text variant="caption" tone="faint" style={{ marginTop: space[2] }}>
                  Where a statutory rate applies. Slab-rate and unclassified gains are excluded —
                  this is not tax advice, and your return is the authority.
                </Text>
              </Card>
            </Animated.View>
          ) : null}

          {/* --------------------------- caveats ---------------------------- */}
          {!statement.complete || statement.excluded.length > 0 ? (
            <View
              style={{
                flexDirection: 'row',
                gap: space[3],
                borderRadius: radius.lg,
                borderWidth: 1,
                borderColor: `${p.state.warningSoft}55`,
                backgroundColor: `${p.state.warningSoft}14`,
                padding: space[4],
              }}
            >
              <AlertTriangle size={17} color={p.state.warningSoft} style={{ marginTop: 1 }} />
              <View style={{ flex: 1, gap: space[2] }}>
                <Text variant="smallMedium">Some funds are not included</Text>
                <Text variant="small" tone="secondary">
                  Their purchase history is not complete in your statement, so a gain worked out
                  from it would be wrong rather than approximate.
                </Text>
                {statement.excluded.slice(0, 4).map((x) => (
                  <Text key={x.name} variant="caption" tone="muted">
                    • {x.name} — {x.reason}
                  </Text>
                ))}
                {statement.excluded.length > 4 ? (
                  <Text variant="caption" tone="faint">
                    …and {statement.excluded.length - 4} more.
                  </Text>
                ) : null}
              </View>
            </View>
          ) : null}

          {/* -------------------------- disposals --------------------------- */}
          {disposals.length > 0 ? (
            <View style={{ gap: space[3] }}>
              <Text variant="overline" tone="muted" caps>
                Sales in FY {fy}
              </Text>
              {disposals.map((d, i) => (
                <Animated.View
                  key={`${d.schemeId}-${d.sellDate}-${i}`}
                  entering={FadeInDown.duration(320).delay(Math.min(i, 10) * 35)}
                >
                  <Card padding={4}>
                    <View style={{ flexDirection: 'row', gap: space[3] }}>
                      <View style={{ flex: 1 }}>
                        <Text variant="smallMedium" numberOfLines={2}>
                          {d.schemeName}
                        </Text>
                        <Text variant="caption" tone="muted" style={{ marginTop: 2 }}>
                          Sold {fmtDate(d.sellDate)} · held {d.holdingDays} days
                          {d.grandfathered ? ' · grandfathered' : ''}
                        </Text>
                      </View>
                      <Text
                        variant="moneySmall"
                        style={{ color: d.gain >= 0 ? p.state.successSoft : p.state.dangerSoft }}
                      >
                        {d.gain >= 0 ? '+' : '−'}
                        {fmt(Math.abs(d.gain))}
                      </Text>
                    </View>
                    <View
                      style={{
                        flexDirection: 'row',
                        gap: space[4],
                        marginTop: space[3],
                        paddingTop: space[3],
                        borderTopWidth: 1,
                        borderTopColor: p.border.subtle,
                      }}
                    >
                      <Cell label="Cost" value={fmtFull(d.cost)} />
                      <Cell label="Proceeds" value={fmtFull(d.proceeds)} />
                      <Cell label="Treatment" value={String(d.treatment).replace(/_/g, ' ')} />
                    </View>
                  </Card>
                </Animated.View>
              ))}
            </View>
          ) : null}

          {statement.statementTo ? (
            <Text variant="caption" tone="faint" center>
              Worked out from statements good to {fmtDate(statement.statementTo)}.
            </Text>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

function Bucket({ label, gain, tax }: { label: string; gain: number; tax: number | null }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space[3] }}>
      <Text variant="small" tone="secondary" style={{ flex: 1 }} numberOfLines={1}>
        {label}
      </Text>
      <Text
        variant="smallMedium"
        style={{ color: gain >= 0 ? p.text.primary : p.state.dangerSoft }}
      >
        {fmtFull(gain)}
      </Text>
      {/* Null means "at slab" or "not classified" — an em dash, never a zero,
          because a zero here reads as "no tax due". */}
      <Text variant="caption" tone="faint" style={{ width: 78, textAlign: 'right' }}>
        {tax == null ? 'at slab' : fmtFull(tax)}
      </Text>
    </View>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text variant="caption" tone="faint" caps numberOfLines={1}>
        {label}
      </Text>
      <Text variant="smallMedium" numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}
