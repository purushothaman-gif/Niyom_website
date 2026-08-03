import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  deviceLabel, getDeviceId, maskEmail, saveSurfaceProfile, type PinSurface,
} from '../lib/pinDevice';
import { PinInput } from './PinInput';

interface Props {
  /** The auth instance that holds this surface's session (partnerSupabase / supabase). */
  supabase: SupabaseClient;
  surface: PinSurface;
  /** Edge function that stores the PIN for this surface. */
  setFn: 'partner-pin-set' | 'employee-pin-set';
  /** dsa_id or employee_id. */
  id: string;
  name: string;
  email: string;
  onDone: () => void;
  onCancel?: () => void;
}

/**
 * Choose a PIN, twice — the partner/employee analogue of the client PinSetup.
 * Requires a live session (the PIN is a second, device-bound factor set only
 * while already signed in). One implementation drives both surfaces.
 */
export function SurfacePinSetup({ supabase, surface, setFn, id, name, email, onDone, onCancel }: Props) {
  const [stage, setStage] = useState<'enter' | 'confirm'>('enter');
  const [firstPin, setFirstPin] = useState('');
  const [resetKey, setResetKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const restart = (message: string) => {
    setError(message);
    setStage('enter');
    setFirstPin('');
    setResetKey((n) => n + 1);
  };

  const handleEntry = async (pin: string) => {
    if (stage === 'enter') {
      setFirstPin(pin);
      setStage('confirm');
      setError('');
      setResetKey((n) => n + 1);
      return;
    }
    if (pin !== firstPin) {
      restart('Those two PINs didn’t match. Start again.');
      return;
    }

    setBusy(true);
    setError('');
    const { data: sess } = await supabase.auth.getSession();
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${setFn}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sess.session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ device_id: getDeviceId(), device_label: deviceLabel(), pin }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) { restart(data?.error || 'Could not save your PIN.'); return; }

    saveSurfaceProfile(surface, { id, name, maskedEmail: maskEmail(email) });
    onDone();
  };

  return (
    <div>
      <p className="mb-3 text-center text-xs font-semibold text-text-primary">
        {stage === 'enter' ? 'Choose a 4-digit PIN' : 'Enter it once more'}
      </p>
      <PinInput onComplete={handleEntry} disabled={busy} autoFocus resetKey={resetKey} />
      {busy && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-text-muted">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
        </p>
      )}
      {error && <p className="mt-3 text-center text-xs text-danger-soft">{error}</p>}
      {onCancel && (
        <div className="mt-3 text-center">
          <button type="button" onClick={onCancel} className="text-[11px] text-text-faint hover:text-accent">
            Not now
          </button>
        </div>
      )}
    </div>
  );
}
