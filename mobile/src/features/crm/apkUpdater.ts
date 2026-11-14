/**
 * In-app update for the direct-download Android app.
 * -----------------------------------------------------------------------------
 * The CRM's update pop-up (src/crm/mobileApp/AppUpdatePrompt.tsx on the web
 * side) asks the app to install a new version instead of sending the person to
 * Chrome. The app downloads the APK into its own cache with a progress bar,
 * then opens Android's package installer on it.
 *
 * Android ALWAYS asks the person to confirm ("Do you want to update this
 * app?") — only the Play Store or device management can install silently. The
 * first time, Android also asks to allow installs from Niyom Wealth
 * (REQUEST_INSTALL_PACKAGES + the per-app "Install unknown apps" switch).
 * Android itself refuses an APK signed with a different key, so a stray file
 * cannot replace this app.
 *
 * NOT for a Play Store build: Google's policy forbids self-updating apps.
 * Drop REQUEST_INSTALL_PACKAGES and this path from that build.
 */
import { Platform } from 'react-native';
import * as LegacyFS from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

const APK_MIME = 'application/vnd.android.package-archive';
const FLAG_GRANT_READ_URI_PERMISSION = 1;
const FLAG_ACTIVITY_NEW_TASK = 0x10000000;

export const canInstallInApp = Platform.OS === 'android';

export interface ApkDownload {
  promise: Promise<string>;
  cancel: () => Promise<void>;
}

/** Downloads the APK into the cache. Resolves to the local file URI. */
export function downloadApk(url: string, version: string, onProgress: (fraction: number) => void): ApkDownload {
  const safe = version.replace(/[^0-9.]/g, '') || 'latest';
  const target = `${LegacyFS.cacheDirectory}NiyomWealth-${safe}.apk`;
  const task = LegacyFS.createDownloadResumable(url, target, {}, (p) => {
    if (p.totalBytesExpectedToWrite > 0) onProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
  });
  const promise = (async () => {
    await LegacyFS.deleteAsync(target, { idempotent: true });
    const res = await task.downloadAsync();
    if (!res) throw new Error('Download cancelled');
    if (res.status < 200 || res.status >= 300) {
      throw new Error(res.status === 400 || res.status === 403 ? 'The download link has expired. Try again.' : `Download failed (${res.status})`);
    }
    return res.uri;
  })();
  return {
    promise,
    cancel: async () => {
      try {
        await task.cancelAsync();
      } catch {
        /* already finished */
      }
    },
  };
}

/** Hands the downloaded APK to Android's installer. */
export async function openInstaller(fileUri: string): Promise<void> {
  const contentUri = await LegacyFS.getContentUriAsync(fileUri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    type: APK_MIME,
    flags: FLAG_GRANT_READ_URI_PERMISSION | FLAG_ACTIVITY_NEW_TASK,
  });
}

/** Android's per-app "Install unknown apps" switch for Niyom Wealth. */
export async function openInstallPermissionSettings(): Promise<void> {
  await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES, {
    data: 'package:com.niyomwealth.app',
  });
}
