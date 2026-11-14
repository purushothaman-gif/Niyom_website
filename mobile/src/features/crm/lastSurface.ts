/**
 * Remembers that this phone belongs to an employee.
 *
 * The CRM's session lives inside the WebView (the website's own storage), so
 * the app's AuthContext never sees it and the launch router would otherwise
 * send an employee to the client/partner welcome screen every morning. This
 * flag sends them straight back to the CRM instead. It holds no credential —
 * if the WebView's session has expired, the CRM shows its own sign-in.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'niyom.lastSurface';

export async function rememberCrm(): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, 'crm');
  } catch {
    /* a missing flag only means one extra tap tomorrow */
  }
}

export async function forgetCrm(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

export async function lastSurfaceIsCrm(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY)) === 'crm';
  } catch {
    return false;
  }
}
