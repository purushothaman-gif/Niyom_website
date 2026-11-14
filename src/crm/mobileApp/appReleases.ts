// Mobile app releases (CRM → My Workspace → Mobile App + the update pop-up).
// Table + bucket: supabase/migrations/20261114100000_app_releases.sql.

import { supabase } from '../../lib/supabase';

export const APP_BUCKET = 'app-releases';

export interface AppRelease {
  id: string;
  platform: 'android';
  audience: 'employee' | 'partner' | 'client';
  version_name: string;
  notes: string | null;
  is_mandatory: boolean;
  storage_path: string | null;
  download_url: string | null;
  file_size: number | null;
  is_active: boolean;
  published_by: string | null;
  published_at: string;
}

/** "1.10.0" > "1.9.3". Missing parts count as 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export interface InstalledApp {
  /** True when this page is running inside the Niyom Wealth mobile app. */
  inApp: boolean;
  /** The installed app's version, when it reports one. */
  version: string | null;
}

/**
 * The app's WebView sets `window.__NIYOM_APP__ = { version, platform }` before
 * the page runs, and appends `NiyomWealthApp/<version>` to the user agent.
 * v1.1.0 shipped with a fixed `NiyomWealthApp/1.0` and no global — that exact
 * string means 1.1.0 (the only build that ever sent it).
 */
export function detectInstalledApp(): InstalledApp {
  if (typeof window === 'undefined') return { inApp: false, version: null };
  const g = (window as unknown as { __NIYOM_APP__?: { version?: string } }).__NIYOM_APP__;
  if (g?.version) return { inApp: true, version: g.version };
  const m = /NiyomWealthApp\/([\d.]+)/.exec(navigator.userAgent || '');
  if (!m) return { inApp: false, version: null };
  return { inApp: true, version: m[1] === '1.0' ? '1.1.0' : m[1] };
}

export function isAndroidDevice(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
}

export async function listReleases(): Promise<AppRelease[]> {
  const { data, error } = await supabase
    .from('nw_app_releases')
    .select('*')
    .eq('platform', 'android')
    .eq('audience', 'employee')
    .order('published_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as AppRelease[];
}

/** Highest active version — by version number, not upload date. */
export function latestOf(releases: AppRelease[]): AppRelease | null {
  return (
    releases
      .filter((r) => r.is_active)
      .sort((a, b) => compareVersions(b.version_name, a.version_name))[0] ?? null
  );
}

export async function fetchLatestRelease(): Promise<AppRelease | null> {
  return latestOf(await listReleases());
}

/** A link that downloads the APK. Signed for one hour for uploaded files. */
export async function releaseDownloadUrl(r: AppRelease): Promise<string> {
  if (r.download_url) return r.download_url;
  const { data, error } = await supabase.storage
    .from(APP_BUCKET)
    .createSignedUrl(r.storage_path!, 3600, { download: `NiyomWealth-${r.version_name}.apk` });
  if (error || !data?.signedUrl) throw error ?? new Error('Could not create a download link');
  return data.signedUrl;
}

/**
 * Start the download. Navigating (rather than window.open) works in a phone
 * browser AND in the app, whose WebView hands any non-CRM address to the
 * phone's browser, where Android's download + install flow takes over.
 */
export async function downloadRelease(r: AppRelease): Promise<'in-app' | 'browser'> {
  const url = await releaseDownloadUrl(r);
  // App 1.2.0+ downloads and installs the update itself (progress bar, then
  // Android's "Update this app?" screen) — see mobile/src/features/crm/apkUpdater.ts.
  const w = window as unknown as {
    __NIYOM_APP__?: { installer?: boolean };
    ReactNativeWebView?: { postMessage: (m: string) => void };
  };
  if (w.__NIYOM_APP__?.installer && w.ReactNativeWebView) {
    w.ReactNativeWebView.postMessage(JSON.stringify({ type: 'install-update', url, version: r.version_name }));
    return 'in-app';
  }
  window.location.href = url;
  return 'browser';
}

export async function publishRelease(input: {
  version: string;
  notes: string;
  mandatory: boolean;
  file: File | null;
  link: string;
  employeeId: string;
}): Promise<void> {
  const version = input.version.trim();
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Version must look like 1.2.0');

  let storage_path: string | null = null;
  let download_url: string | null = null;
  let file_size: number | null = null;

  if (input.file) {
    if (!/\.apk$/i.test(input.file.name)) throw new Error('Choose the .apk file');
    storage_path = `android/employee/NiyomWealth-${version}-${Date.now()}.apk`;
    file_size = input.file.size;
    const { error } = await supabase.storage.from(APP_BUCKET).upload(storage_path, input.file, {
      contentType: 'application/vnd.android.package-archive',
      upsert: false,
    });
    if (error) {
      const msg = String(error.message || error);
      if (/exceed|too large|413|maximum allowed size/i.test(msg)) {
        throw new Error(
          `The file (${formatSize(file_size)}) is over the storage upload limit. Raise "Upload file size limit" ` +
            'in Supabase → Storage → Settings, or paste a download link instead.',
        );
      }
      throw error;
    }
  } else {
    const link = input.link.trim();
    if (!/^https:\/\//i.test(link)) throw new Error('Choose the APK file or paste an https:// download link');
    download_url = link;
  }

  const { error } = await supabase.from('nw_app_releases').insert({
    platform: 'android',
    audience: 'employee',
    version_name: version,
    notes: input.notes.trim() || null,
    is_mandatory: input.mandatory,
    storage_path,
    download_url,
    file_size,
    published_by: input.employeeId,
  });
  if (error) {
    if (storage_path) await supabase.storage.from(APP_BUCKET).remove([storage_path]);
    if (error.code === '23505') throw new Error(`Version ${version} is already published`);
    throw error;
  }
}

export async function setReleaseActive(id: string, active: boolean): Promise<void> {
  const { error } = await supabase.from('nw_app_releases').update({ is_active: active }).eq('id', id);
  if (error) throw error;
}

export async function deleteRelease(r: AppRelease): Promise<void> {
  const { error } = await supabase.from('nw_app_releases').delete().eq('id', r.id);
  if (error) throw error;
  if (r.storage_path) await supabase.storage.from(APP_BUCKET).remove([r.storage_path]);
}

export function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
}
