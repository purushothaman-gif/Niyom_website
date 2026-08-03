import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { clientSupabase as supabase } from '../../../lib/supabase';
import { deviceLabel, getDeviceId, maskEmail, saveProfile } from '../../../lib/pinDevice';
import { PinInput } from '../../../components/PinInput';

interface Props {
  clientId: string;
  clientName: string;
  clientEmail: string;
  /** Fired after the PIN is saved. */
  onDone: () => void;
  onCancel?: () => void;
}

/**
 * Choose a PIN, twice. Shared by Profile → Settings and the prompt shown after
 * signing in, so there is one implementation of the thing that actually sets a
 * credential — two would eventually disagree about what a valid PIN is.
 *
 * Entered twice because a mistyped PIN is not discoverable: there is nothing to
 * read back, and the first sign-in that fails would be the first anyone knew.
 */
export function PinSetup({ clientId, clientName, clientEmail, onDone, onCancel }: Props) {
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
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/client-pin-set`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sess.session?.access_token ?? import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        Apikey: import.meta.env.VITE_SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({
        device_id: getDeviceId(),
        device_label: deviceLabel(),
        pin,
      }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);

    if (!res.ok) {
      restart(data?.error || 'Could not save your PIN.');
      return;
    }

    /* Remember who this PIN belongs to so the keypad can greet them by name.
       Name + masked email only — never the PIN, never the full address. */
    saveProfile({ clientId, name: clientName, maskedEmail: maskEmail(clientEmail) });
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
          <button
            type="button"
            onClick={onCancel}
            className="text-[11px] text-text-faint hover:text-accent"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
