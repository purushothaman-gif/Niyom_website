/**
 * Phone notifications (from 1.3.0) — the CRM bell, on the phone.
 * -----------------------------------------------------------------------------
 * The app never holds a CRM session, so it does not register itself. Instead:
 *
 *  1. the signed-in CRM page (inside the WebView) posts `push-register`;
 *  2. the app asks Android for permission, gets this install's Expo push
 *     token and hands it back to the page (`niyom-push-token` event);
 *  3. the page saves it against the employee (nw_register_push_token).
 *
 * The server side (nw_alerts trigger → send-push edge function → Expo → FCM)
 * is in supabase/migrations/20261114140000_push_notifications.sql.
 *
 * A tap opens the CRM page the alert points at (data.url), whether the app
 * was closed, in the background or open.
 */
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { CRM_HOSTS } from '@/features/crm/crmBridge';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export interface PushRegistration {
  token: string;
  device: string | null;
}

/** Ask once (Android 13+ shows the system prompt), then return the token. */
export async function registerForPush(): Promise<PushRegistration | null> {
  if (!Device.isDevice) return null;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Notifications',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 200, 120, 200],
      lightColor: '#C9A14A',
    });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const { data } = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
  return { token: data, device: Device.modelName ?? null };
}

/** Only CRM pages on our own site may be opened from a notification. */
export function safeCrmUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  const m = /^https:\/\/([^/:?#]+)(\/[^?#]*)?/i.exec(url);
  if (!m || !CRM_HOSTS.has(m[1].toLowerCase())) return null;
  if (!(m[2] ?? '').startsWith('/crm')) return null;
  return url;
}

// ── The page a tapped notification wants, handed to the CRM screen ─────────
let pending: string | null = null;
const listeners = new Set<(url: string) => void>();

export function openFromNotification(url: string) {
  if (listeners.size) listeners.forEach((l) => l(url));
  else pending = url;
}

/** For the CRM screen's first load: a page a cold-start tap asked for. */
export function takePendingUrl(): string | null {
  const u = pending;
  pending = null;
  return u;
}

export function onNotificationUrl(l: (url: string) => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}
