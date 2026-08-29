/**
 * Everything that did not earn a tab.
 *
 * The groups and their wording come from the website's `NAV_GROUPS` — Portfolio,
 * Invest, Activity, Account — including the one-line description under each
 * entry, so the menu teaches the product rather than just listing it. Keeping
 * the same shape means adding a product later is a change in one config on both
 * platforms, not a redesign of this screen.
 */
import { View } from 'react-native';
import { router } from 'expo-router';
import {
  ArrowLeftRight,
  Bell,
  FileText,
  FolderClosed,
  Gem,
  Landmark,
  LifeBuoy,
  LogOut,
  PieChart,
  PiggyBank,
  Receipt,
  ShieldCheck,
  UserRound,
  type LucideIcon,
} from 'lucide-react-native';
import { space } from '@/design/tokens';
import { usePalette } from '@/design/ThemeProvider';
import { useAuth } from '@/features/auth/AuthContext';
import { Screen } from '@/ui/Screen';
import { Card } from '@/ui/Card';
import { Text } from '@/ui/Text';
import { ListRow, StatusPill } from '@/ui/kit';
import { Button } from '@/ui/Button';
import { ScreenHeader } from '@/features/client/ScreenHeader';

interface Item {
  label: string;
  description: string;
  icon: LucideIcon;
  href?: string;
  comingSoon?: boolean;
}

const GROUPS: { heading: string; items: Item[] }[] = [
  {
    heading: 'Portfolio',
    items: [
      { label: 'Asset Allocation', description: 'How your money is spread', icon: PieChart, href: '/allocation' },
      { label: 'Capital Gains', description: 'What you owe tax on, year by year', icon: Receipt, href: '/capital-gains' },
      { label: 'Reports', description: 'Downloadable statements', icon: FileText, href: '/reports' },
    ],
  },
  {
    heading: 'Invest',
    items: [
      { label: 'Bonds', description: 'Fixed income, at your approved pricing', icon: Landmark, href: '/bonds' },
      { label: 'Fixed Deposits', description: 'Assured returns', icon: PiggyBank, comingSoon: true },
      { label: 'Insurance', description: 'Protection for your family', icon: ShieldCheck, comingSoon: true },
      { label: 'Alternate Investments', description: 'Unlisted shares and more', icon: Gem, comingSoon: true },
    ],
  },
  {
    heading: 'Activity',
    items: [
      {
        label: 'Transactions',
        description: 'Everything you have bought and sold',
        icon: ArrowLeftRight,
        href: '/transactions',
      },
      {
        label: 'Documents',
        description: 'Statements, KYC and confirmations',
        icon: FolderClosed,
        href: '/documents',
      },
    ],
  },
  {
    heading: 'Account',
    items: [
      { label: 'Profile', description: 'Your details and settings', icon: UserRound, href: '/profile' },
      { label: 'Notifications', description: 'Alerts from your RM', icon: Bell, href: '/notifications' },
      { label: 'Support', description: 'Raise a ticket, get help', icon: LifeBuoy, href: '/support' },
    ],
  },
];

export default function More() {
  const p = usePalette();
  const { signOut } = useAuth();

  return (
    <Screen tabBarInset>
      <ScreenHeader title="More" />

      <View style={{ gap: space[6] }}>
        {GROUPS.map((group) => (
          <View key={group.heading}>
            <Text variant="overline" tone="muted" caps style={{ marginBottom: space[3] }}>
              {group.heading}
            </Text>
            <Card padding={4}>
              {group.items.map((item, i) => (
                <ListRow
                  key={item.label}
                  icon={item.icon}
                  iconColor={item.comingSoon ? p.text.faint : undefined}
                  title={item.label}
                  subtitle={item.description}
                  showChevron={!item.comingSoon}
                  last={i === group.items.length - 1}
                  onPress={
                    item.comingSoon || !item.href
                      ? undefined
                      : () => router.push(item.href as never)
                  }
                />
              ))}
            </Card>
            {group.items.some((i) => i.comingSoon) ? (
              <View style={{ marginTop: space[3] }}>
                <StatusPill label="Greyed items are not open yet" />
              </View>
            ) : null}
          </View>
        ))}

        <Button
          label="Sign out"
          variant="danger"
          icon={LogOut}
          onPress={() => void signOut('user').then(() => router.replace('/'))}
          fullWidth
        />
      </View>
    </Screen>
  );
}
