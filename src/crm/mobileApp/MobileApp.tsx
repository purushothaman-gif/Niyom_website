// CRM → My Workspace → Mobile App.
//
// Every employee: download the latest Android app + install steps.
// Admins: publish a new version (upload the APK or paste a link), withdraw or
// delete old ones. Publishing a higher version is what makes the update
// pop-up (AppUpdatePrompt) appear for employees on an older app.

import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Download, EyeOff, Eye, Loader2, Smartphone, Trash2, Upload } from 'lucide-react';
import type { NWEmployee } from '../types';
import {
  compareVersions, deleteRelease, detectInstalledApp, downloadRelease, formatSize, isAndroidDevice,
  latestOf, listReleases, publishRelease, setReleaseActive, type AppRelease,
} from './appReleases';
import PushPanel from './PushPanel';

const card = { background: 'var(--bg-surface)', border: '1px solid var(--border)' } as const;
const input = { background: 'var(--bg-input, var(--bg-base))', border: '1px solid var(--border)', color: 'var(--text-primary)' } as const;

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function MobileApp({ employee }: { employee: NWEmployee }) {
  const isAdmin = employee.role === 'admin' || employee.role === 'super_admin';
  const app = detectInstalledApp();
  const android = isAndroidDevice();

  const [releases, setReleases] = useState<AppRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setReleases(await listReleases());
    } catch (e) {
      setErr((e as Error)?.message || 'Could not load app versions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const latest = latestOf(releases);
  const upToDate = !!(latest && app.version && compareVersions(app.version, latest.version_name) >= 0);

  const onDownload = async (r: AppRelease) => {
    setBusyId(r.id);
    setErr(null);
    try {
      await downloadRelease(r);
    } catch (e) {
      setErr((e as Error)?.message || 'Could not start the download');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Mobile App</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          The Niyom Wealth app for Android. Employees sign in with "I'm an employee" and get the full CRM.
        </p>
      </div>

      {err && <p className="text-sm" style={{ color: 'var(--danger, #dc2626)' }}>{err}</p>}

      {/* ----------------------------- latest ----------------------------- */}
      <div className="rounded-2xl p-5" style={card}>
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--text-faint)' }} /></div>
        ) : !latest ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
            No version has been published yet.{isAdmin ? ' Publish one below.' : ' Ask an admin.'}
          </p>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center gap-3 flex-1">
              <div className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: 'rgba(200,164,93,0.15)' }}>
                <Smartphone className="h-6 w-6 text-accent-soft" />
              </div>
              <div>
                <p className="font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Android · version {latest.version_name}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Released {fmtDate(latest.published_at)}{latest.file_size ? ` · ${formatSize(latest.file_size)}` : ''}
                </p>
                {app.inApp && (
                  <p className="text-xs mt-1" style={{ color: upToDate ? 'var(--success, #16a34a)' : 'var(--text-secondary)' }}>
                    {upToDate
                      ? <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> You have the latest version</span>
                      : `This phone has version ${app.version ?? 'unknown'}`}
                  </p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => onDownload(latest)}
              disabled={busyId === latest.id}
              className="flex items-center justify-center gap-2 rounded-xl bg-accent px-5 py-3 text-sm font-semibold text-on-accent disabled:opacity-60"
            >
              {busyId === latest.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {upToDate ? 'Download again' : 'Download app'}
            </button>
          </div>
        )}
        {latest?.notes && (
          <p className="mt-4 text-sm whitespace-pre-line" style={{ color: 'var(--text-secondary)' }}>{latest.notes}</p>
        )}
      </div>

      {/* -------------------------- how to install -------------------------- */}
      <div className="rounded-2xl p-5" style={card}>
        <h2 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>How to install</h2>
        {!android && !app.inApp && (
          <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>
            Open <b>niyomwealth.com/crm</b> on your <b>Android phone</b>, sign in, and come to My Workspace → Mobile App.
            iPhone is not available yet.
          </p>
        )}
        <ol className="list-decimal pl-5 space-y-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <li>Tap <b>Download app</b>. Chrome downloads the file (about {formatSize(latest?.file_size ?? null) || '60–120 MB'}).</li>
          <li>Open the downloaded file. If Android asks, allow <b>Install unknown apps</b> for Chrome — this is a one-time setting.</li>
          <li>Tap <b>Install</b> (or <b>Update</b> if you already have the app). If Play Protect shows a warning, tap <b>More details → Install anyway</b>.</li>
          <li>Open Niyom Wealth, tap <b>I'm an employee</b> and sign in with your CRM email and password.</li>
        </ol>
        <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
          When a new version is released, the app will show a pop-up asking you to download it. Updating keeps you signed in.
        </p>
      </div>

      {isAdmin && <PublishForm employee={employee} latest={latest} onDone={load} />}

      {isAdmin && <PushPanel />}

      {/* ----------------------------- history ----------------------------- */}
      {releases.length > 0 && (
        <div className="rounded-2xl p-5" style={card}>
          <h2 className="font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>All versions</h2>
          <div className="divide-y" style={{ borderColor: 'var(--border)' }}>
            {[...releases].sort((a, b) => compareVersions(b.version_name, a.version_name)).map((r) => (
              <div key={r.id} className="py-3 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{ color: r.is_active ? 'var(--text-primary)' : 'var(--text-faint)' }}>
                    {r.version_name}
                    {r.is_mandatory && <span className="ml-2 text-xs text-accent-soft">required</span>}
                    {!r.is_active && <span className="ml-2 text-xs">withdrawn</span>}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {fmtDate(r.published_at)}{r.file_size ? ` · ${formatSize(r.file_size)}` : ''}{r.download_url ? ' · external link' : ''}
                  </p>
                </div>
                {r.is_active && (
                  <button type="button" onClick={() => onDownload(r)} className="p-2 rounded-lg" title="Download" style={{ color: 'var(--text-secondary)' }}>
                    {busyId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  </button>
                )}
                {isAdmin && (
                  <>
                    <button
                      type="button"
                      title={r.is_active ? 'Withdraw (hide from employees)' : 'Restore'}
                      className="p-2 rounded-lg"
                      style={{ color: 'var(--text-secondary)' }}
                      onClick={async () => {
                        try { await setReleaseActive(r.id, !r.is_active); await load(); }
                        catch (e) { setErr((e as Error)?.message || 'Could not update'); }
                      }}
                    >
                      {r.is_active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      title="Delete"
                      className="p-2 rounded-lg"
                      style={{ color: 'var(--danger, #dc2626)' }}
                      onClick={async () => {
                        if (!window.confirm(`Delete version ${r.version_name}? The file is removed permanently.`)) return;
                        try { await deleteRelease(r); await load(); }
                        catch (e) { setErr((e as Error)?.message || 'Could not delete'); }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PublishForm({ employee, latest, onDone }: { employee: NWEmployee; latest: AppRelease | null; onDone: () => Promise<void> }) {
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [mandatory, setMandatory] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const lower = !!(latest && /^\d+\.\d+\.\d+$/.test(version) && compareVersions(version, latest.version_name) <= 0);

  const submit = async () => {
    setBusy(true);
    setMsg(null);
    try {
      await publishRelease({ version, notes, mandatory, file, link, employeeId: employee.id });
      setMsg({ ok: true, text: `Version ${version} published. Employees on an older app will see the update pop-up.` });
      setVersion(''); setNotes(''); setMandatory(false); setFile(null); setLink('');
      await onDone();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error)?.message || 'Could not publish' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl p-5 space-y-4" style={card}>
      <div>
        <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Publish a new version <span className="text-xs font-normal" style={{ color: 'var(--text-muted)' }}>· admin</span></h2>
        <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
          The version must match the app build exactly (the "version" in mobile/app.json) — the app reports it and the pop-up compares against it.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm space-y-1">
          <span style={{ color: 'var(--text-secondary)' }}>Version</span>
          <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder={latest ? `newer than ${latest.version_name}` : '1.1.0'}
            className="w-full rounded-lg px-3 py-2 text-sm" style={input} />
          {lower && <span className="text-xs" style={{ color: 'var(--warning, #d97706)' }}>Not newer than {latest!.version_name} — nobody will be prompted.</span>}
        </label>
        <label className="text-sm space-y-1">
          <span style={{ color: 'var(--text-secondary)' }}>APK file</span>
          <input type="file" accept=".apk,application/vnd.android.package-archive"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm" style={{ color: 'var(--text-secondary)' }} />
        </label>
      </div>

      {!file && (
        <label className="text-sm space-y-1 block">
          <span style={{ color: 'var(--text-secondary)' }}>…or a download link instead of a file</span>
          <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…/NiyomWealth.apk"
            className="w-full rounded-lg px-3 py-2 text-sm" style={input} />
        </label>
      )}

      <label className="text-sm space-y-1 block">
        <span style={{ color: 'var(--text-secondary)' }}>What's new (shown in the pop-up)</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
          className="w-full rounded-lg px-3 py-2 text-sm" style={input} />
      </label>

      <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
        <input type="checkbox" checked={mandatory} onChange={(e) => setMandatory(e.target.checked)} />
        Required update — employees cannot dismiss the pop-up
      </label>

      {msg && <p className="text-sm" style={{ color: msg.ok ? 'var(--success, #16a34a)' : 'var(--danger, #dc2626)' }}>{msg.text}</p>}

      <button type="button" onClick={submit} disabled={busy || !version || (!file && !link)}
        className="flex items-center gap-2 rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-on-accent disabled:opacity-50">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
        {busy && file ? 'Uploading…' : 'Publish'}
      </button>
    </div>
  );
}
