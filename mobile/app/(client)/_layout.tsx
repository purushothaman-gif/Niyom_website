/**
 * The client Wealth Portal's tab navigator.
 *
 * Four permanent tabs plus More, taken from `PRIMARY_VIEWS` in the website's
 * `src/portal/layout/navigation.ts` — chosen by what an investor opens
 * repeatedly (check the portfolio, invest, watch the SIP) rather than by
 * mirroring the desktop header. Everything else lives behind More, which is
 * where infrequent-but-necessary screens belong.
 *
 * A guard sits above it: a screen in this group can only render for a signed-in
 * client. Without that, a session expiring while the app is open would leave
 * the dashboard mounted, querying as nobody.
 */
import { useEffect, useMemo } from 'react';
import { Tabs, router } from 'expo-router';
import {
  CalendarClock,
  LayoutDashboard,
  Menu,
  TrendingUp,
  Wallet,
} from 'lucide-react-native';
import { useAuth } from '@/features/auth/AuthContext';
import { makeTabBar, type TabSpec } from '@/ui/TabBar';
import { mfSsoEnabled } from '@shared/platform/env';

const TABS: TabSpec[] = [
  { name: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { name: 'portfolio', label: 'Portfolio', icon: Wallet },
  { name: 'invest', label: 'Invest', icon: TrendingUp },
  { name: 'sip', label: 'SIP', icon: CalendarClock },
  { name: 'more', label: 'More', icon: Menu },
];

const TabBar = makeTabBar(TABS);
// SIPs live on the MF platform once the switch is on; the route stays (it
// redirects) but the tab goes.
const MF_PLATFORM_TAB_BAR = makeTabBar(TABS.filter((t) => t.name !== 'sip'));

export default function ClientLayout() {
  const { session, restoring } = useAuth();

  useEffect(() => {
    if (restoring) return;
    if (session?.surface !== 'client') router.replace('/');
  }, [session, restoring]);

  const Bar = useMemo(() => (mfSsoEnabled() ? MF_PLATFORM_TAB_BAR : TabBar), []);

  if (session?.surface !== 'client') return null;

  return (
    <Tabs
      tabBar={(props) => <Bar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
      ))}
    </Tabs>
  );
}
