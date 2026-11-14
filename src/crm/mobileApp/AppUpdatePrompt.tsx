// "A new version of the app is available" — shown inside the mobile app only.
//
// Mounted once in CRM.tsx. It does nothing in a desktop or phone browser; in
// the app's WebView it compares the installed version with the latest active
// employee release. "Later" hides it for 12 hours on this phone; a mandatory
// release cannot be dismissed.

import { useEffect, useState } from 'react';
import { Download, Loader2, Smartphone } from 'lucide-react';
import {
  compareVersions, detectInstalledApp, downloadRelease, fetchLatestRelease, formatSize, type AppRelease,
} from './appReleases';

const SNOOZE_KEY = 'niyom.appUpdateSnooze';
const SNOOZE_MS = 12 * 60 * 60 * 1000;

function snoozedFor(version: string): boolean {
  try {
    const raw = localStorage.getItem(SNOOZE_KEY);
    if (!raw) return false;
    const s = JSON.parse(raw) as { v: string; until: number };
    return s.v === version && s.until > Date.now();
  } catch {
    return false;
  }
}

function snooze(version: string) {
  try {
    localStorage.setItem(SNOOZE_KEY, JSON.stringify({ v: version, until: Date.now() + SNOOZE_MS }));
  } catch {
    /* ignore */
  }
}

export function AppUpdatePrompt() {
  const [release, setRelease] = useState<AppRelease | null>(null);
  const [installed, setInstalled] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const app = detectInstalledApp();
    if (!app.inApp || !app.version) return;
    let cancelled = false;
    fetchLatestRelease()
      .then((latest) => {
        if (cancelled || !latest) return;
        if (compareVersions(latest.version_name, app.version!) <= 0) return;
        if (!latest.is_mandatory && snoozedFor(latest.version_name)) return;
        setInstalled(app.version);
        setRelease(latest);
      })
      .catch(() => { /* never block the CRM on this */ });
    return () => { cancelled = true; };
  }, []);

  if (!release) return null;

  const onDownload = async () => {
    setBusy(true);
    setErr(null);
    try {
      await downloadRelease(release);
    } catch (e) {
      setErr((e as Error)?.message || 'Could not start the download');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
      <div
        className="w-full max-w-sm rounded-2xl p-5"
        style={{ background: 'var(--bg-elevated, var(--bg-base))', border: '1px solid var(--border)' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-update-title"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: "rgba(200,164,93,0.15)" }}>
            <Smartphone className="h-5 w-5 text-accent-soft" />
          </div>
          <div>
            <h2 id="app-update-title" className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {release.is_mandatory ? 'Update required' : 'New app version available'}
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Version {release.version_name} · you have {installed}
            </p>
          </div>
        </div>

        {release.notes && (
          <p className="mt-4 whitespace-pre-line text-sm" style={{ color: 'var(--text-secondary)' }}>
            {release.notes}
          </p>
        )}

        <p className="mt-4 text-xs" style={{ color: 'var(--text-muted)' }}>
          Tap Download, then open the file and tap <b>Update</b>. Your sign-in and data stay as they are.
        </p>

        {err && <p className="mt-3 text-sm" style={{ color: 'var(--danger, #dc2626)' }}>{err}</p>}

        <div className="mt-5 flex gap-2">
          {!release.is_mandatory && (
            <button
              type="button"
              onClick={() => { snooze(release.version_name); setRelease(null); }}
              className="flex-1 rounded-xl px-4 py-3 text-sm font-semibold"
              style={{ border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              Later
            </button>
          )}
          <button
            type="button"
            onClick={onDownload}
            disabled={busy}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-semibold text-on-accent disabled:opacity-60"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Download{release.file_size ? ` (${formatSize(release.file_size)})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
