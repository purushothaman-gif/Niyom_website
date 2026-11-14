// Phone notifications — the CRM half (the app half is
// mobile/src/features/push/pushNotifications.ts).
//
// Inside app 1.3.0+, the signed-in CRM asks the app for this phone's push
// token and saves it against the employee. Every nw_alerts row (the bell) is
// then also sent to that phone — supabase/migrations/20261114140000_push_notifications.sql.

import { useEffect } from 'react';
import { supabase } from '../../lib/supabase';

interface AppGlobal {
  __NIYOM_APP__?: { push?: boolean; pushToken?: string; version?: string };
  ReactNativeWebView?: { postMessage: (m: string) => void };
}

const w = () => (typeof window === 'undefined' ? null : (window as unknown as AppGlobal));

/** True inside an app build that can receive phone notifications. */
export function appSupportsPush(): boolean {
  const g = w();
  return !!(g?.__NIYOM_APP__?.push && g.ReactNativeWebView);
}

export function usePushRegistration(employeeId: string | null | undefined) {
  useEffect(() => {
    const g = w();
    if (!employeeId || !g || !appSupportsPush()) return;
    const onToken = (ev: Event) => {
      const d = (ev as CustomEvent<{ token?: string; device?: string; version?: string }>).detail;
      if (!d?.token) return;
      void supabase.rpc('nw_register_push_token', {
        p_token: d.token,
        p_platform: 'android',
        p_app_version: d.version ?? g.__NIYOM_APP__?.version ?? undefined,
        p_device: d.device ?? undefined,
      });
    };
    window.addEventListener('niyom-push-token', onToken);
    g.ReactNativeWebView!.postMessage(JSON.stringify({ type: 'push-register' }));
    return () => window.removeEventListener('niyom-push-token', onToken);
  }, [employeeId]);
}

/** Before signing out inside the app: stop this phone getting that employee's alerts. */
export async function unregisterPushToken(): Promise<void> {
  const token = w()?.__NIYOM_APP__?.pushToken;
  if (!token) return;
  try {
    await supabase.rpc('nw_unregister_push_token', { p_token: token });
  } catch {
    /* sign-out must never be blocked */
  }
}

export interface PushDevice {
  employee_id: string;
  full_name: string;
  app_version: string | null;
  device_name: string | null;
  last_seen_at: string;
}

export async function listPushDevices(): Promise<PushDevice[]> {
  const { data, error } = await supabase.rpc('nw_push_devices');
  if (error) throw error;
  return (data ?? []) as PushDevice[];
}

/** Bell + phone notification to all active employees, or the ones given. */
export async function sendStaffNotification(title: string, message: string, employeeIds: string[] | null): Promise<number> {
  const { data, error } = await supabase.rpc('nw_send_staff_notification', {
    p_title: title,
    p_message: message,
    p_employee_ids: employeeIds ?? undefined,
  });
  if (error) throw error;
  return (data as number) ?? 0;
}
