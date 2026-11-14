/**
 * Sends a tapped notification to the CRM screen. Mounted once, in the root
 * layout. Covers a tap that launched the app (last response) and taps while
 * it is running.
 */
import { useEffect, useRef } from 'react';
import { router, usePathname } from 'expo-router';
import * as Notifications from 'expo-notifications';
import { openFromNotification, safeCrmUrl } from './pushNotifications';

export function PushTapRouter() {
  const pathname = usePathname();
  const onCrm = useRef(pathname === '/crm');
  onCrm.current = pathname === '/crm';
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const handle = (r: Notifications.NotificationResponse | null) => {
      if (!r) return;
      const id = r.notification.request.identifier;
      if (handled.current === id) return;
      handled.current = id;
      const url = safeCrmUrl(r.notification.request.content.data?.url);
      if (!url) return;
      Notifications.clearLastNotificationResponse();
      openFromNotification(url);
      if (!onCrm.current) setTimeout(() => router.navigate('/crm'), 0);
    };
    handle(Notifications.getLastNotificationResponse());
    const sub = Notifications.addNotificationResponseReceivedListener(handle);
    return () => sub.remove();
  }, []);

  return null;
}
