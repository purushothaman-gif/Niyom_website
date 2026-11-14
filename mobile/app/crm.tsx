/**
 * Employee (CRM) sign-in and workspace.
 *
 * The website's `/crm`, full-screen in a WebView — see
 * `src/features/crm/crmBridge.ts` for why it is not a native port. The CRM's
 * own login (email + password, admin TOTP 2FA, employee PIN, OTP reset) runs
 * unchanged, and its session persists in the WebView's storage between
 * launches, so an employee signs in once.
 *
 * What the app adds around it:
 *  - downloads (PDFs, Excel) arrive through the bridge and open the share sheet;
 *  - tel:, mailto:, WhatsApp and any non-CRM page open outside the WebView;
 *  - Android back walks the CRM's history, and from its first page leaves to
 *    the app's welcome screen;
 *  - signing out of the CRM (which sends the browser to the website home)
 *    returns to the welcome screen instead of showing the marketing site.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Linking, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import {
  onNotificationUrl,
  registerForPush,
  takePendingUrl,
} from '@/features/push/pushNotifications';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as WebBrowser from 'expo-web-browser';
import Constants from 'expo-constants';
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from 'react-native-webview';
import type { ShouldStartLoadRequest } from 'react-native-webview/lib/WebViewTypes';
import { RefreshCw, WifiOff } from 'lucide-react-native';
import { saveFile } from '@shared/platform/fileWriter';
import { usePalette } from '@/design/ThemeProvider';
import { radius, space } from '@/design/tokens';
import { Text } from '@/ui/Text';
import {
  CRM_BRIDGE_SCRIPT,
  CRM_HOSTS,
  CRM_URL,
  type BridgeMessage,
} from '@/features/crm/crmBridge';
import { forgetCrm, rememberCrm } from '@/features/crm/lastSurface';
import { canInstallInApp } from '@/features/crm/apkUpdater';
import { UpdateSheet, type UpdateRequest } from '@/features/crm/UpdateSheet';

function hostOf(url: string): string | null {
  const m = /^https?:\/\/([^/:?#]+)/i.exec(url);
  return m ? m[1].toLowerCase() : null;
}

function pathOf(url: string): string {
  const m = /^https?:\/\/[^/?#]+(\/[^?#]*)?/i.exec(url);
  return (m && m[1]) || '/';
}

/** The installed app's version, as the CRM's update pop-up compares it. */
const APP_VERSION = Constants.expoConfig?.version ?? '0.0.0';

/** Runs before the CRM page: tells it which app build it is inside. */
const APP_INFO_SCRIPT = `window.__NIYOM_APP__ = ${JSON.stringify({
  version: APP_VERSION,
  platform: 'android',
  // From 1.2.0: the CRM may post { type: 'install-update' } instead of
  // navigating to the APK, and the app downloads + installs it itself.
  installer: canInstallInApp,
  // From 1.3.0: the signed-in CRM may post { type: 'push-register' } and
  // gets this phone's push token back as a 'niyom-push-token' event.
  push: true,
})};\ntrue;`;

function openOutside(url: string) {
  // An app update (APK) must go to the phone's real browser, whose download
  // manager hands the file to Android's installer; an in-app tab would not.
  if (/\.apk(\?|$)|\/app-releases\//i.test(url)) {
    void Linking.openURL(url);
    return;
  }
  if (/^https?:/i.test(url)) {
    void WebBrowser.openBrowserAsync(url).catch(() => Linking.openURL(url));
  } else {
    void Linking.openURL(url).catch(() => {
      Alert.alert('Cannot open link', 'No app on this phone can open it.');
    });
  }
}

export default function CrmScreen() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const ref = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [update, setUpdate] = useState<UpdateRequest | null>(null);
  // A notification tapped while the app was closed opens straight on its page.
  const [startUrl] = useState(() => takePendingUrl() ?? CRM_URL);

  // …and one tapped while the CRM is open moves the CRM there.
  useEffect(
    () =>
      onNotificationUrl((url) => {
        ref.current?.injectJavaScript(`window.location.assign(${JSON.stringify(url)});true;`);
      }),
    [],
  );

  useEffect(() => {
    void rememberCrm();
  }, []);

  const leave = useCallback(() => {
    void forgetCrm();
    router.replace('/(auth)/welcome');
  }, []);

  // Android hardware back: CRM history first, then out to the welcome screen.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack.current) {
        ref.current?.goBack();
      } else {
        leave();
      }
      return true;
    });
    return () => sub.remove();
  }, [leave]);

  const onNav = useCallback((nav: WebViewNavigation) => {
    canGoBack.current = nav.canGoBack;
  }, []);

  const onShouldStart = useCallback(
    (req: ShouldStartLoadRequest) => {
      const { url } = req;
      if (/^(about|blob|data|javascript):/i.test(url)) return true;

      if (!/^https?:/i.test(url)) {
        // tel:, mailto:, whatsapp:, intent: …
        openOutside(url);
        return false;
      }

      // Sub-frames (embedded previews, payment widgets) load where they are.
      if (req.isTopFrame === false) return true;

      const host = hostOf(url);
      if (host && CRM_HOSTS.has(host)) {
        if (pathOf(url).startsWith('/crm')) return true;
        // Signing out of the CRM, or its "back to home" link, goes to the
        // marketing site. In the app that means: back to the welcome screen.
        leave();
        return false;
      }

      openOutside(url);
      return false;
    },
    [leave],
  );

  const onMessage = useCallback(async (e: WebViewMessageEvent) => {
    let msg: BridgeMessage;
    try {
      msg = JSON.parse(e.nativeEvent.data) as BridgeMessage;
    } catch {
      return;
    }
    if (msg.type === 'download') {
      try {
        await saveFile({ fileName: msg.fileName, base64: msg.base64, mimeType: msg.mimeType });
      } catch (err) {
        Alert.alert('Could not save the file', String((err as Error)?.message ?? err));
      }
    } else if (msg.type === 'install-update') {
      // Only the CRM itself may start an install, and only over https.
      const from = hostOf(e.nativeEvent.url ?? '');
      if (!canInstallInApp || !from || !CRM_HOSTS.has(from)) return;
      if (!/^https:\/\//i.test(msg.url) || !/^\d+\.\d+\.\d+$/.test(msg.version)) return;
      setUpdate({ url: msg.url, version: msg.version });
    } else if (msg.type === 'push-register') {
      const from = hostOf(e.nativeEvent.url ?? '');
      if (!from || !CRM_HOSTS.has(from)) return;
      try {
        const reg = await registerForPush();
        if (!reg) return;
        const detail = JSON.stringify({ token: reg.token, device: reg.device, version: APP_VERSION });
        ref.current?.injectJavaScript(
          `(function(){var d=${detail};window.__NIYOM_APP__=window.__NIYOM_APP__||{};window.__NIYOM_APP__.pushToken=d.token;` +
            `window.dispatchEvent(new CustomEvent('niyom-push-token',{detail:d}));})();true;`,
        );
      } catch {
        /* no Firebase / Play services, or offline — the bell still works */
      }
    } else if (msg.type === 'download-error') {
      Alert.alert('Could not save the file', msg.message);
    }
  }, []);

  return (
    <View style={{ flex: 1, backgroundColor: p.bg.base, paddingTop: insets.top }}>
      {failed ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space[6], gap: space[4] }}>
          <WifiOff size={36} color={p.text.muted} />
          <Text variant="h3" center>
            Can't reach the CRM
          </Text>
          <Text variant="small" tone="muted" center>
            Check your internet connection and try again.
          </Text>
          <Pressable
            onPress={() => {
              setFailed(false);
              setLoading(true);
              ref.current?.reload();
            }}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: space[2],
              paddingVertical: space[3],
              paddingHorizontal: space[5],
              borderRadius: radius.md,
              backgroundColor: p.accent.DEFAULT,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <RefreshCw size={16} color={p.text.onAccent} />
            <Text variant="bodyMedium" style={{ color: p.text.onAccent }}>
              Try again
            </Text>
          </Pressable>
          <Pressable onPress={leave} style={{ padding: space[3] }}>
            <Text variant="small" tone="muted">
              Back to sign-in options
            </Text>
          </Pressable>
        </View>
      ) : null}

      <WebView
        ref={ref}
        source={{ uri: startUrl }}
        style={{ flex: 1, backgroundColor: p.bg.base, display: failed ? 'none' : 'flex' }}
        injectedJavaScriptBeforeContentLoaded={APP_INFO_SCRIPT + CRM_BRIDGE_SCRIPT}
        onMessage={onMessage}
        onNavigationStateChange={onNav}
        onShouldStartLoadWithRequest={onShouldStart}
        onLoadEnd={() => setLoading(false)}
        onError={() => {
          setLoading(false);
          setFailed(true);
        }}
        onOpenWindow={(e) => openOutside(e.nativeEvent.targetUrl)}
        setSupportMultipleWindows
        javaScriptEnabled
        domStorageEnabled
        sharedCookiesEnabled
        thirdPartyCookiesEnabled={false}
        cacheEnabled
        allowsBackForwardNavigationGestures
        allowFileAccess={false}
        geolocationEnabled={false}
        mediaPlaybackRequiresUserAction
        applicationNameForUserAgent={`NiyomWealthApp/${APP_VERSION}`}
        originWhitelist={['https://*', 'about:*', 'blob:*', 'data:*']}
        pullToRefreshEnabled
        overScrollMode="never"
        textZoom={100}
      />

      <UpdateSheet request={update} onClose={() => setUpdate(null)} />

      {loading && !failed ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: insets.top,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: p.bg.base,
          }}
        >
          <ActivityIndicator color={p.accent.DEFAULT} />
        </View>
      ) : null}
    </View>
  );
}
