/**
 * The native sheet shown while an app update downloads and installs.
 * Driven by crm.tsx when the CRM's pop-up posts `install-update`.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { Download, Settings2, X } from 'lucide-react-native';
import { usePalette } from '@/design/ThemeProvider';
import { radius, space } from '@/design/tokens';
import { Text } from '@/ui/Text';
import { downloadApk, openInstaller, openInstallPermissionSettings, type ApkDownload } from './apkUpdater';

export interface UpdateRequest {
  url: string;
  version: string;
}

type Phase =
  | { kind: 'downloading'; progress: number }
  | { kind: 'installing'; fileUri: string }
  | { kind: 'error'; message: string };

export function UpdateSheet({ request, onClose }: { request: UpdateRequest | null; onClose: () => void }) {
  const p = usePalette();
  const [phase, setPhase] = useState<Phase>({ kind: 'downloading', progress: 0 });
  const task = useRef<ApkDownload | null>(null);

  const install = useCallback(async (fileUri: string) => {
    setPhase({ kind: 'installing', fileUri });
    try {
      await openInstaller(fileUri);
      // Returns when the installer closes. If the update went through, Android
      // has already restarted the app; if we are still here it was cancelled
      // or blocked, and the sheet offers to try again.
    } catch (e) {
      setPhase({ kind: 'error', message: String((e as Error)?.message ?? e) });
    }
  }, []);

  const start = useCallback(() => {
    if (!request) return;
    setPhase({ kind: 'downloading', progress: 0 });
    const t = downloadApk(request.url, request.version, (f) =>
      setPhase((cur) => (cur.kind === 'downloading' ? { kind: 'downloading', progress: f } : cur)),
    );
    task.current = t;
    t.promise.then(install).catch((e) => {
      if (task.current !== t) return;
      setPhase({ kind: 'error', message: String((e as Error)?.message ?? e) });
    });
  }, [request, install]);

  useEffect(() => {
    if (request) start();
    return () => {
      void task.current?.cancel();
      task.current = null;
    };
  }, [request, start]);

  const close = () => {
    void task.current?.cancel();
    task.current = null;
    onClose();
  };

  if (!request) return null;

  const pct = phase.kind === 'downloading' ? Math.round(phase.progress * 100) : 100;

  return (
    <Modal transparent animationType="fade" visible onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: p.bg.elevated,
            borderTopLeftRadius: radius.lg,
            borderTopRightRadius: radius.lg,
            padding: space[6],
            paddingBottom: space[8],
            gap: space[4],
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space[3] }}>
            <Download size={20} color={p.accent.DEFAULT} />
            <Text variant="h3" style={{ flex: 1 }}>
              Updating to version {request.version}
            </Text>
            <Pressable onPress={close} hitSlop={12} accessibilityLabel="Close">
              <X size={20} color={p.text.muted} />
            </Pressable>
          </View>

          {phase.kind === 'error' ? (
            <>
              <Text variant="small" tone="danger">
                {phase.message}
              </Text>
              <SheetButton label="Try again" onPress={start} primary />
            </>
          ) : phase.kind === 'downloading' ? (
            <>
              <View style={{ height: 8, borderRadius: 4, backgroundColor: p.border.DEFAULT, overflow: 'hidden' }}>
                <View style={{ width: `${pct}%`, height: '100%', backgroundColor: p.accent.DEFAULT }} />
              </View>
              <Text variant="small" tone="muted">
                Downloading… {pct}%
              </Text>
            </>
          ) : (
            <>
              <Text variant="small" tone="secondary">
                Tap Update on the next screen. You stay signed in.
              </Text>
              <Text variant="caption" tone="muted">
                If Android says installs from this app are not allowed, turn on "Allow from this source" for Niyom
                Wealth, come back, and tap Install again.
              </Text>
              <SheetButton label="Install" onPress={() => install(phase.fileUri)} primary />
              <SheetButton label="Open install permission" icon onPress={() => void openInstallPermissionSettings()} />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

function SheetButton({ label, onPress, primary, icon }: { label: string; onPress: () => void; primary?: boolean; icon?: boolean }) {
  const p = usePalette();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: space[2],
        paddingVertical: space[4],
        borderRadius: radius.md,
        backgroundColor: primary ? p.accent.DEFAULT : 'transparent',
        borderWidth: primary ? 0 : 1,
        borderColor: p.border.DEFAULT,
        opacity: pressed ? 0.8 : 1,
      })}
    >
      {icon ? <Settings2 size={16} color={p.text.secondary} /> : null}
      <Text variant="bodyMedium" style={{ color: primary ? p.text.onAccent : p.text.secondary }}>
        {label}
      </Text>
    </Pressable>
  );
}
