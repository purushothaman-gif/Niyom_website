import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { NWEmployee } from './types';
import { fmtDate } from './utils';
import { User, Lock, Bell, CheckCircle2, AlertCircle, Eye, EyeOff, Shield, Smartphone } from 'lucide-react';
import {
  listVerifiedTotpFactors, startTotpEnrollment, verifyTotpCode, cancelEnrollment,
  disableTotp, mfaErrorMessage, isMfaUnavailable, employeeIsPrivileged,
  currentDeviceTrusted, forgetThisDevice, TRUSTED_DEVICE_DAYS,
  type TotpEnrollment,
} from './mfa';

interface Props { employee: NWEmployee; }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-secondary)' }}>{label}</label>
      {children}
    </div>
  );
}

function Input({ ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const [focused, setFocused] = useState(false);
  return (
    <input {...props}
      className="w-full px-3.5 py-2.5 rounded-xl text-sm text-text-primary outline-none transition-all"
      style={{ background: 'var(--bg-base)', border: `1px solid ${focused ? 'var(--accent)' : 'var(--border)'}` }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    />
  );
}

export default function Settings({ employee }: Props) {
  const [tab, setTab] = useState<'profile' | 'security' | 'notifications'>('profile');
  const [profile, setProfile] = useState({ full_name: employee.full_name, phone: employee.phone || '' });
  const [passwords, setPasswords] = useState({ next: '', confirm: '' });
  const [showPw, setShowPw] = useState(false);
  const [notifications, setNotifications] = useState({ email_alerts: true, txn_alerts: true, client_alerts: true });
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  // --- Two-factor (TOTP) ---
  // Opt-in: the login gate no longer forces enrolment, so this is the only place
  // a member turns their own second factor on or off.
  const [mfaOn, setMfaOn] = useState<boolean | null>(null);   // null = still loading
  const [mfaSupported, setMfaSupported] = useState(true);     // false = TOTP off project-wide
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [confirmDisable, setConfirmDisable] = useState(false);
  // Whether THIS browser is currently remembered (2FA skipped here).
  const [deviceTrusted, setDeviceTrusted] = useState(false);

  const refreshMfa = useCallback(async () => {
    try {
      setMfaOn((await listVerifiedTotpFactors()).length > 0);
    } catch (err) {
      if (isMfaUnavailable(err)) { setMfaSupported(false); setMfaOn(false); return; }
      setMfaOn(false);
    }
    try { setDeviceTrusted(await currentDeviceTrusted()); } catch { setDeviceTrusted(false); }
  }, []);

  useEffect(() => { refreshMfa(); }, [refreshMfa]);

  const forgetDevice = async () => {
    await forgetThisDevice();
    setDeviceTrusted(false);
    notify('This device will ask for your code at the next sign-in.');
  };

  const notify = (msg: string, isErr = false) => {
    if (isErr) setError(msg); else setSuccess(msg);
    setTimeout(() => { setSuccess(''); setError(''); }, 4000);
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    const { error: err } = await supabase.from('nw_employees').update({ full_name: profile.full_name, phone: profile.phone }).eq('id', employee.id);
    setSaving(false);
    if (err) notify(err.message, true); else notify('Profile updated successfully.');
  };

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passwords.next !== passwords.confirm) { notify('Passwords do not match.', true); return; }
    if (passwords.next.length < 8) { notify('Password must be at least 8 characters.', true); return; }
    setSaving(true);
    const { error: err } = await supabase.auth.updateUser({ password: passwords.next });
    setSaving(false);
    if (err) notify(err.message, true); else { notify('Password updated.'); setPasswords({ next: '', confirm: '' }); }
  };

  const beginEnroll = async () => {
    setMfaBusy(true);
    try {
      setEnrollment(await startTotpEnrollment());
      setMfaCode('');
    } catch (err) {
      notify(mfaErrorMessage(err), true);
    } finally { setMfaBusy(false); }
  };

  const confirmEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollment) return;
    setMfaBusy(true);
    try {
      await verifyTotpCode(enrollment.factorId, mfaCode);
      setEnrollment(null); setMfaCode('');
      await refreshMfa();
      notify('Two-factor authentication is on.');
    } catch (err) {
      notify(mfaErrorMessage(err), true);
    } finally { setMfaBusy(false); }
  };

  const abortEnroll = async () => {
    if (enrollment) await cancelEnrollment(enrollment.factorId);
    setEnrollment(null); setMfaCode('');
  };

  const turnOffMfa = async () => {
    setMfaBusy(true);
    try {
      await disableTotp();
      await forgetThisDevice(); // trusted-device markers are meaningless without a factor
      setConfirmDisable(false);
      await refreshMfa();
      notify('Two-factor authentication is off. Your password is now the only thing protecting this account.');
    } catch (err) {
      notify(mfaErrorMessage(err), true);
    } finally { setMfaBusy(false); }
  };

  const tabs = [
    { key: 'profile' as const, label: 'Profile', icon: User },
    { key: 'security' as const, label: 'Security', icon: Lock },
    { key: 'notifications' as const, label: 'Notifications', icon: Bell },
  ];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <p className="text-xs uppercase tracking-widest mb-1" style={{ color: 'var(--accent)' }}>Account</p>
        <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-secondary)' }}>Manage your profile and preferences</p>
      </div>

      {/* Badge */}
      <div className="rounded-2xl p-5 flex items-center gap-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold flex-shrink-0" style={{ background: 'rgba(var(--accent-rgb),0.15)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}>
          {employee.full_name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-base font-bold text-text-primary truncate">{employee.full_name}</p>
          <p className="text-sm mt-0.5 truncate" style={{ color: 'var(--text-secondary)' }}>{employee.email}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-xs font-mono px-2 py-0.5 rounded-lg" style={{ background: 'rgba(var(--accent-rgb),0.1)', color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb),0.2)' }}>
              {employee.employee_code}
            </span>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-lg" style={{ background: 'rgba(96,165,250,0.1)', color: 'rgb(var(--info-soft-rgb))', border: '1px solid rgba(96,165,250,0.2)' }}>
              {employee.designation ?? 'Relationship Manager'}
            </span>
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>Member since</p>
          <p className="text-sm font-medium text-text-primary mt-0.5">{employee.joining_date ? fmtDate(employee.joining_date) : '—'}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
        {tabs.map(t => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-semibold transition-all"
              style={{ background: active ? 'rgba(var(--accent-rgb),0.1)' : 'transparent', color: active ? 'var(--accent)' : 'var(--text-secondary)', border: active ? '1px solid rgba(var(--accent-rgb),0.2)' : '1px solid transparent' }}>
              <Icon className="w-4 h-4" />{t.label}
            </button>
          );
        })}
      </div>

      {success && (
        <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)' }}>
          <CheckCircle2 className="w-4 h-4 text-c-emerald" />
          <p className="text-sm text-c-emerald">{success}</p>
        </div>
      )}
      {error && (
        <div className="rounded-2xl p-4 flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
          <AlertCircle className="w-4 h-4 text-c-red" />
          <p className="text-sm text-c-red">{error}</p>
        </div>
      )}

      {tab === 'profile' && (
        <form onSubmit={saveProfile} className="rounded-2xl p-6 space-y-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2"><User className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Personal Information</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Full Name"><Input value={profile.full_name} onChange={e => setProfile(p => ({ ...p, full_name: e.target.value }))} /></Field>
            <Field label="Phone"><Input placeholder="+91 9876543210" value={profile.phone} onChange={e => setProfile(p => ({ ...p, phone: e.target.value }))} /></Field>
            <Field label="Email"><Input value={employee.email} disabled style={{ opacity: 0.5, cursor: 'not-allowed' }} /></Field>
            <Field label="Employee Code"><Input value={employee.employee_code || ''} disabled style={{ opacity: 0.5, cursor: 'not-allowed' }} /></Field>
          </div>
          <div className="flex justify-end">
            <button type="submit" disabled={saving} className="px-6 py-2.5 rounded-xl text-sm font-bold text-on-accent disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
              {saving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </form>
      )}

      {tab === 'security' && (
        <div className="space-y-5">
          {/* Two-factor. Opt-in — the login gate no longer forces enrolment, so
              this card is the only way it goes on or off. */}
          <div className="rounded-2xl p-6 space-y-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                  <Smartphone className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Two-Factor Authentication
                </h3>
                <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                  A 6-digit code from your authenticator app, asked for each time you sign in.
                </p>
              </div>
              {mfaOn !== null && mfaSupported && (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full shrink-0"
                  style={mfaOn
                    ? { background: 'rgba(16,185,129,0.12)', color: 'var(--success)' }
                    : { background: 'rgba(245,158,11,0.12)', color: 'var(--warning)' }}>
                  {mfaOn ? 'On' : 'Off'}
                </span>
              )}
            </div>

            {!mfaSupported ? (
              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                Two-factor is switched off for this Supabase project, so it cannot be enabled here.
              </p>
            ) : mfaOn === null ? (
              <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Checking…</p>
            ) : enrollment ? (
              /* --- enrolment in progress --- */
              <form onSubmit={confirmEnroll} className="space-y-4">
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Scan this with Google Authenticator, Authy or 1Password, then enter the 6-digit code it shows.
                </p>
                <div className="flex flex-col sm:flex-row gap-5 items-start">
                  <img src={enrollment.qrCode} alt="Two-factor QR code" width={160} height={160}
                    className="rounded-xl" style={{ background: '#fff', padding: 8 }} />
                  <div className="min-w-0">
                    <p className="text-xs mb-1" style={{ color: 'var(--text-faint)' }}>Or enter this key by hand:</p>
                    <code className="text-xs break-all" style={{ color: 'var(--accent)' }}>{enrollment.secret}</code>
                  </div>
                </div>
                <Field label="6-Digit Code">
                  <Input value={mfaCode} inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="000000"
                    onChange={e => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
                </Field>
                <div className="flex gap-3 justify-end">
                  <button type="button" onClick={abortEnroll} disabled={mfaBusy}
                    className="px-4 py-2.5 rounded-xl text-sm disabled:opacity-50"
                    style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Cancel</button>
                  <button type="submit" disabled={mfaBusy || mfaCode.length !== 6}
                    className="px-6 py-2.5 rounded-xl text-sm font-bold text-on-accent disabled:opacity-50"
                    style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                    {mfaBusy ? 'Verifying…' : 'Turn On'}
                  </button>
                </div>
              </form>
            ) : mfaOn ? (
              /* --- on: offer to turn off, with a confirmation --- */
              confirmDisable ? (
                <div className="rounded-xl p-4 space-y-3" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <p className="text-sm text-text-primary">Turn off two-factor authentication?</p>
                  <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    Your password becomes the only thing protecting this account — and this account can see every
                    client's PAN, Aadhaar, bank and demat details, and can raise payment links.
                  </p>
                  <div className="flex gap-3 justify-end">
                    <button onClick={() => setConfirmDisable(false)} disabled={mfaBusy}
                      className="px-4 py-2 rounded-xl text-sm disabled:opacity-50"
                      style={{ background: 'var(--bg-raised)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Keep it on</button>
                    <button onClick={turnOffMfa} disabled={mfaBusy}
                      className="px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-50"
                      style={{ background: 'var(--danger)', color: '#fff' }}>
                      {mfaBusy ? 'Turning off…' : 'Turn Off'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-end">
                  <button onClick={() => setConfirmDisable(true)}
                    className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                    style={{ color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.3)' }}>Turn Off</button>
                </div>
              )
            ) : (
              /* --- off: offer to turn on --- */
              <div className="flex items-center justify-between gap-4">
                <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
                  {employeeIsPrivileged(employee)
                    ? 'Strongly recommended — this account can see every client\'s financial details.'
                    : 'Recommended for anyone handling client data.'}
                </p>
                <button onClick={beginEnroll} disabled={mfaBusy}
                  className="px-6 py-2.5 rounded-xl text-sm font-bold text-on-accent disabled:opacity-50 shrink-0"
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                  {mfaBusy ? 'Starting…' : 'Turn On'}
                </button>
              </div>
            )}
          </div>

          {/* Trusted device — only relevant once a factor exists */}
          {mfaSupported && mfaOn && (
            <div className="rounded-2xl p-6 space-y-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                    <Shield className="w-4 h-4" style={{ color: 'var(--accent)' }} /> This Device
                  </h3>
                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                    {deviceTrusted
                      ? `Remembered — you won't be asked for a code on this device for up to ${TRUSTED_DEVICE_DAYS} days. Only leave it remembered on personal devices you control.`
                      : `Not remembered — you'll enter a code each time you sign in here. Tick "Trust this device" at sign-in to skip it for ${TRUSTED_DEVICE_DAYS} days.`}
                  </p>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full shrink-0"
                  style={deviceTrusted
                    ? { background: 'rgba(245,158,11,0.12)', color: 'var(--warning)' }
                    : { background: 'rgba(16,185,129,0.12)', color: 'var(--success)' }}>
                  {deviceTrusted ? 'Remembered' : 'Not remembered'}
                </span>
              </div>
              {deviceTrusted && (
                <div className="flex justify-end">
                  <button onClick={forgetDevice}
                    className="px-4 py-2.5 rounded-xl text-sm font-semibold"
                    style={{ color: 'var(--danger)', border: '1px solid rgba(239,68,68,0.3)' }}>
                    Forget this device
                  </button>
                </div>
              )}
            </div>
          )}

          <form onSubmit={savePassword} className="rounded-2xl p-6 space-y-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <h3 className="text-sm font-bold text-text-primary flex items-center gap-2"><Lock className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Change Password</h3>
            {[{ key: 'next' as const, label: 'New Password' }, { key: 'confirm' as const, label: 'Confirm Password' }].map(f => (
              <Field key={f.key} label={f.label}>
                <div className="relative">
                  <Input type={showPw ? 'text' : 'password'} placeholder="Min 8 characters" value={passwords[f.key]} onChange={e => setPasswords(p => ({ ...p, [f.key]: e.target.value }))} />
                  {f.key === 'next' && (
                    <button type="button" onClick={() => setShowPw(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-secondary)' }}>
                      {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  )}
                </div>
              </Field>
            ))}
            <div className="flex justify-end">
              <button type="submit" disabled={saving || !passwords.next} className="px-6 py-2.5 rounded-xl text-sm font-bold text-on-accent disabled:opacity-50" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>
                {saving ? 'Updating...' : 'Update Password'}
              </button>
            </div>
          </form>
          <div className="rounded-2xl p-6 space-y-4" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
            <h3 className="text-sm font-bold text-text-primary flex items-center gap-2"><Shield className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Account Security</h3>
            {[['Email Verified', true], ['Account Active', employee.status === 'active'], ['Password Set', employee.password_changed]].map(([label, ok]) => (
              <div key={label as string} className="flex items-center justify-between py-2 border-b last:border-0" style={{ borderColor: 'var(--border)' }}>
                <p className="text-sm text-text-primary">{label as string}</p>
                <span className={`text-xs font-semibold px-2 py-1 rounded-lg border ${ok ? 'text-c-emerald bg-c-emerald/10 border-c-emerald/20' : 'text-c-red bg-c-red/10 border-c-red/20'}`}>{ok ? 'Yes' : 'No'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'notifications' && (
        <div className="rounded-2xl p-6 space-y-5" style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)' }}>
          <h3 className="text-sm font-bold text-text-primary flex items-center gap-2"><Bell className="w-4 h-4" style={{ color: 'var(--accent)' }} /> Notification Preferences</h3>
          <div className="space-y-3">
            {[
              { key: 'email_alerts' as const, label: 'Email Alerts', desc: 'Receive important notifications via email' },
              { key: 'txn_alerts' as const, label: 'Transaction Alerts', desc: 'Get notified on new transactions' },
              { key: 'client_alerts' as const, label: 'Client Alerts', desc: 'Get notified on client updates' },
            ].map(item => (
              <div key={item.key} className="flex items-center justify-between p-4 rounded-xl" style={{ background: 'var(--bg-base)', border: '1px solid var(--border)' }}>
                <div>
                  <p className="text-sm font-semibold text-text-primary">{item.label}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{item.desc}</p>
                </div>
                <button onClick={() => setNotifications(n => ({ ...n, [item.key]: !n[item.key] }))}
                  className="relative w-11 h-6 rounded-full transition-all flex-shrink-0"
                  style={{ background: notifications[item.key] ? 'var(--accent)' : 'var(--border)' }}>
                  <div className="absolute w-4 h-4 bg-white rounded-full top-1 transition-all" style={{ left: notifications[item.key] ? '24px' : '4px' }} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex justify-end">
            <button onClick={() => notify('Notification preferences saved.')} className="px-6 py-2.5 rounded-xl text-sm font-bold text-on-accent" style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>Save Preferences</button>
          </div>
        </div>
      )}
    </div>
  );
}
