/**
 * The Partner Portal's tab navigator.
 *
 * Five tabs from the website's partner `NAV_GROUPS`: the dashboard, the two
 * things a DSA's business is made of (clients and leads), the one they are paid
 * by (payouts), and their own account.
 *
 * Guarded the same way the client group is — a partner session, or nothing.
 */
import { useEffect } from 'react';
import { Tabs, router } from 'expo-router';
import { ClipboardList, LayoutDashboard, Share2, UserRound, Users, Wallet } from 'lucide-react-native';
import { useAuth } from '@/features/auth/AuthContext';
import { makeTabBar, type TabSpec } from '@/ui/TabBar';

const TABS: TabSpec[] = [
  { name: 'dashboard', label: 'Home', icon: LayoutDashboard },
  { name: 'clients', label: 'Clients', icon: Users },
  { name: 'payouts', label: 'Payouts', icon: Wallet },
  { name: 'leads', label: 'Leads', icon: ClipboardList },
  { name: 'account', label: 'Account', icon: UserRound },
];

const TabBar = makeTabBar(TABS);

export default function PartnerLayout() {
  const { session, restoring } = useAuth();

  useEffect(() => {
    if (restoring) return;
    if (session?.surface !== 'partner') router.replace('/');
  }, [session, restoring]);

  if (session?.surface !== 'partner') return null;

  return (
    <Tabs tabBar={(props) => <TabBar {...props} />} screenOptions={{ headerShown: false }}>
      {TABS.map((t) => (
        <Tabs.Screen key={t.name} name={t.name} options={{ title: t.label }} />
      ))}
    </Tabs>
  );
}
