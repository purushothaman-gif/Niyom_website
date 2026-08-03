import { useCallback, useEffect, useState } from 'react';
import { Check, Loader2, Smartphone, Trash2 } from 'lucide-react';
import { clientSupabase as supabase } from '../../../lib/supabase';
import {
  deviceLabel,
  getDeviceId,
  listProfiles,
  maskEmail,
  removeProfile,
  saveProfile,
} from '../../../lib/pinDevice';
import { PinInput } from '../../../components/PinInput';
import { StatusPill } from '../../components/StatusPill';

interface DeviceRow {
  device_id: string;
  device_label: string | null;
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
  revoked_at: string | null;
  locked_until: string | null;
}

interface Props {
  clientId: string;
  /** Shown above the keypad at sign-in, so a shared device names the account. */
  clientName: string;
  clientEmail: string;
}

async function callFn(name: string, payload: unknown) {
  const { data: sess } = await supabase.auth.getSession();
  const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${sess.session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(payload),
  });
  return { ok: res.ok, data: await res.json().catch(() => ({})) };
}

const fmtDate = (iso: string | null) =>
  !iso ? '—' : new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });

/**
 * PIN sign-in, from the client's side: set one for this device, see everywhere
 * it works, and switch any of them off.
 *
 * Two entries are deliberately plain about the trade-off. A PIN is quicker than
 * a password and weaker than one, so it is offered per-device, expires, and can
 * be revoked from here — including from a different device, which is the case
 * that matters when a phone goes missing.
 */
export function PinSection({ clientId, clientName, clientEmail }: Props) {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<'idle' | 'enter' | 'confirm'>('idle');
  const [firstPin, setFirstPin] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  const thisDevice = getDeviceId();

  const load = useCallback(async () => {
    setLoading(true);
    const { ok, data } = await callFn('client-pin-manage', { action: 'list' });
    setDevices(ok ? (data.devices ?? []) : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = devices.filter((d) => !d.revoked_at && new Date(d.expires_at) > new Date());
  const onThisDevice = active.some((d) => d.device_id === thisDevice);

  const start = () => {
    setStage('enter');
    setFirstPin('');
    setError('');
    setDone(false);
    setResetKey((n) => n + 1);
  };

  const handleEntry = async (pin: string) => {
    if (stage === 'enter') {
      setFirstPin(pin);
      setStage('confirm');
      setResetKey((n) => n + 1);
      return;
    }

    if (pin !== firstPin) {
      setError('Those two PINs didn’t match. Start again.');
      setStage('enter');
      setFirstPin('');
      setResetKey((n) => n + 1);
      return;
    }

    setBusy(true);
    setError('');
    const { ok, data } = await callFn('client-pin-set', {
      device_id: thisDevice,
      device_label: deviceLabel(),
      pin,
    });
    setBusy(false);

    if (!ok) {
      setError(data?.error || 'Could not save your PIN.');
      setStage('enter');
      setFirstPin('');
      setResetKey((n) => n + 1);
      return;
    }

    /* Remember who this PIN belongs to, so the keypad can greet them by name.
       Name + masked email only — never the PIN, never the full address. */
    saveProfile({ clientId, name: clientName, maskedEmail: maskEmail(clientEmail) });
    setStage('idle');
    setDone(true);
    void load();
  };

  const revoke = async (deviceId: string) => {
    setBusy(true);
    await callFn('client-pin-manage', { action: 'revoke', device_id: deviceId });
    if (deviceId === thisDevice) removeProfile(clientId);
    setBusy(false);
    void load();
  };

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-text-primary">
            PIN sign-in
            {onThisDevice && listProfiles().some((p) => p.clientId === clientId) && (
              <span className="ml-2 align-middle">
                <StatusPill tone="success">On for this device</StatusPill>
              </span>
            )}
          </p>
          <p className="mt-1 max-w-md text-[11px] leading-relaxed text-text-secondary">
            Sign in with 4 digits instead of your password — on this device only, for 30 days at a
            time. Your password still works everywhere, and five wrong tries locks the PIN.
          </p>
        </div>
        {stage === 'idle' && (
          <button
            type="button"
            onClick={start}
            className="shrink-0 rounded-token-md border border-border bg-bg-surface px-3 py-2 text-xs font-semibold text-text-primary transition-colors hover:text-accent"
          >
            {onThisDevice ? 'Change PIN' : 'Set a PIN'}
          </button>
        )}
      </div>

      {done && (
        <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-success">
          <Check className="h-3.5 w-3.5" /> PIN saved for {deviceLabel()}.
        </p>
      )}

      {stage !== 'idle' && (
        <div className="mt-4 rounded-token-lg border border-border-subtle bg-bg-surface p-4">
          <p className="mb-3 text-xs font-semibold text-text-primary">
            {stage === 'enter' ? 'Choose a 4-digit PIN' : 'Enter it once more'}
          </p>
          <PinInput onComplete={handleEntry} disabled={busy} autoFocus resetKey={resetKey} />
          {busy && (
            <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
            </p>
          )}
          {error && <p className="mt-3 text-center text-xs text-danger-soft">{error}</p>}
          <div className="mt-3 text-center">
            <button
              type="button"
              onClick={() => {
                setStage('idle');
                setError('');
              }}
              className="text-[11px] text-text-faint hover:text-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Where the PIN works. Revoking from another device is the point. */}
      {loading ? (
        <p className="mt-4 text-xs text-text-faint">Checking your devices…</p>
      ) : active.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {active.map((d) => (
            <li
              key={d.device_id}
              className="flex items-center gap-3 rounded-token-md bg-bg-surface px-3 py-2.5"
            >
              <Smartphone className="h-4 w-4 shrink-0 text-text-secondary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold text-text-primary">
                  {d.device_label || 'Unnamed device'}
                  {d.device_id === thisDevice && (
                    <span className="ml-1.5 text-[10px] font-normal text-text-faint">(this one)</span>
                  )}
                </p>
                <p className="text-[11px] text-text-faint">
                  {d.last_used_at ? `Last used ${fmtDate(d.last_used_at)}` : `Added ${fmtDate(d.created_at)}`}
                  {' · '}
                  Expires {fmtDate(d.expires_at)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => revoke(d.device_id)}
                disabled={busy}
                className="flex shrink-0 items-center gap-1.5 rounded-token-md border border-border px-2.5 py-1.5 text-[11px] font-semibold text-text-secondary transition-colors hover:text-danger-soft disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" /> Turn off
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
