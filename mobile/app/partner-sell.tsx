/**
 * Sell today — what a partner can offer right now, and what each earns them.
 *
 * The website shows these as two rails on the dashboard; on a phone they get a
 * screen of their own, switched by a segmented control, because a card carrying
 * cost, price, spread and two actions needs the full width.
 *
 * Order and Share both hand over to the existing detail / order screens rather
 * than repeating their sheets here: the share link is minted there, against the
 * spread the partner confirms at that moment.
 */
import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { Gem, Landmark } from 'lucide-react-native';
import { PARTNER_ACCESS_REVOKED, PartnerService } from '@shared/partner/services/PartnerService';
import { sellTodayBonds } from '@shared/partner/sell/sellMath';
import { space } from '@/design/tokens';
import { usePartnerQuery } from '@/features/partner/usePartnerData';
import { PartnerBondSellCard, PartnerShareSellCard } from '@/features/partner/sell/SellCards';
import { ScreenHeader } from '@/features/client/ScreenHeader';
import { Screen } from '@/ui/Screen';
import { Button } from '@/ui/Button';
import { EmptyState, ErrorState, Segmented, SkeletonScreen } from '@/ui/kit';

type Tab = 'bonds' | 'shares';

/** Routes of the partner unlisted-shares screens. */
const SHARE_DETAIL = '/partner-share';
const SHARE_ORDER = '/partner-share-order';
const SHARE_LIST = '/partner-shares';

export default function PartnerSell() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const [tab, setTab] = useState<Tab>(params.tab === 'shares' ? 'shares' : 'bonds');

  const load = useCallback(
    () =>
      Promise.all([
        PartnerService.getBonds().catch(rethrowRevoked),
        PartnerService.getShares().catch(rethrowRevoked),
      ]),
    [],
  );
  const { data, loading, error, refresh } = usePartnerQuery(load);
  const bonds = sellTodayBonds(data?.[0] ?? [], 6);
  const shares = (data?.[1] ?? []).slice(0, 6);

  const go = (pathname: string, id: string) =>
    router.push({ pathname, params: { id } } as never);

  return (
    <Screen onRefresh={refresh} refreshing={loading && !!data}>
      <ScreenHeader
        title="Sell today"
        subtitle="What you can offer now, and the spread each earns you."
        showBack
      />

      <View style={{ gap: space[5] }}>
        <Segmented<Tab>
          value={tab}
          onChange={setTab}
          options={[
            { value: 'bonds', label: 'Bonds' },
            { value: 'shares', label: 'Unlisted shares' },
          ]}
        />

        {loading && !data ? (
          <SkeletonScreen rows={3} />
        ) : error ? (
          <ErrorState message={error} onRetry={refresh} />
        ) : tab === 'bonds' ? (
          bonds.length === 0 ? (
            <EmptyState
              icon={Landmark}
              title="No bonds open"
              message="No bonds are open for you right now — your RM adds new offers regularly."
            />
          ) : (
            <View style={{ gap: space[5] }}>
              {bonds.map((b) => (
                <PartnerBondSellCard
                  key={b.id}
                  bond={b}
                  onOpen={() => go('/partner-bond', b.id)}
                  onOrder={() => go('/partner-bond-order', b.id)}
                  onShare={() => go('/partner-bond', b.id)}
                />
              ))}
              <Button
                label="All bonds"
                variant="secondary"
                fullWidth
                onPress={() => router.push('/partner-bonds')}
              />
            </View>
          )
        ) : shares.length === 0 ? (
          <EmptyState
            icon={Gem}
            title="No unlisted shares open"
            message="No unlisted shares are open right now."
          />
        ) : (
          <View style={{ gap: space[5] }}>
            {shares.map((s) => (
              <PartnerShareSellCard
                key={s.id}
                share={s}
                onOpen={() => go(SHARE_DETAIL, s.id)}
                onOrder={() => go(SHARE_ORDER, s.id)}
                onShare={() => go(SHARE_DETAIL, s.id)}
              />
            ))}
            <Button
              label="All unlisted shares"
              variant="secondary"
              fullWidth
              onPress={() => router.push(SHARE_LIST as never)}
            />
          </View>
        )}
      </View>
    </Screen>
  );
}

/**
 * One product failing to load should not blank the other, but the kill-switch
 * must still reach `usePartnerQuery`, which signs the partner out.
 */
function rethrowRevoked(err: unknown): [] {
  if (err instanceof Error && err.message === PARTNER_ACCESS_REVOKED) throw err;
  return [];
}
