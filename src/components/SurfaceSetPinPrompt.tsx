import { useState } from 'react';
import { Check, KeyRound } from 'lucide-react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { deviceLabel, type PinSurface } from '../lib/pinDevice';
import { SurfacePinSetup } from './SurfacePinSetup';

interface Props {
  supabase: SupabaseClient;
  surface: PinSurface;
  setFn: 'partner-pin-set' | 'employee-pin-set';
  id: string;
  name: string;
  email: string;
  /** Where to change/remove it later, shown in the success note. */
  manageHint?: string;
  onSkip: () => void;
  onDone: () => void;
}

/**
 * Post-login "set a PIN?" offer for the partner and employee surfaces — the
 * analogue of the client SetPinPrompt. An offer, not a gate: "Not now" closes it.
 */
export function SurfaceSetPinPrompt({ supabase, surface, setFn, id, name, email, manageHint, onSkip, onDone }: Props) {
  const [setting, setSetting] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }} role="dialog" aria-modal="true" aria-label="Set a sign-in PIN">
      <div className="w-full max-w-sm rounded-token-xl border border-border bg-bg-elevated p-6 shadow-token-lg">
        {saved ? (
          <div className="text-center">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-success/10">
              <Check className="h-6 w-6 text-success" />
            </span>
            <h3 className="text-base font-bold text-text-primary">PIN set</h3>
            <p className="mt-2 text-sm text-text-secondary">
              Next time on {deviceLabel()}, just enter your 4 digits.{manageHint ? ` You can change or remove it from ${manageHint}.` : ''}
            </p>
            <button type="button" onClick={onDone} className="mt-5 w-full rounded-token-md bg-accent py-2.5 text-sm font-bold text-on-accent transition-opacity hover:opacity-90">Done</button>
          </div>
        ) : (
          <>
            <div className="text-center">
              <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/10">
                <KeyRound className="h-6 w-6 text-accent" />
              </span>
              <h3 className="text-base font-bold text-text-primary">Sign in faster next time</h3>
              <p className="mt-2 text-sm text-text-secondary">
                Set a 4-digit PIN for {deviceLabel()} and skip typing your PAN and password. Your password still works, here and everywhere else.
              </p>
            </div>

            {setting ? (
              <div className="mt-5">
                <SurfacePinSetup supabase={supabase} surface={surface} setFn={setFn} id={id} name={name} email={email}
                  onDone={() => setSaved(true)} onCancel={() => setSetting(false)} />
              </div>
            ) : (
              <div className="mt-5 space-y-2">
                <button type="button" onClick={() => setSetting(true)}
                  className="w-full rounded-token-md py-2.5 text-sm font-bold text-on-accent transition-opacity hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg, var(--accent), var(--accent-strong))' }}>Set a PIN</button>
                <button type="button" onClick={onSkip}
                  className="w-full rounded-token-md border border-border py-2.5 text-sm font-semibold text-text-secondary transition-colors hover:bg-bg-surface">Not now</button>
              </div>
            )}

            <p className="mt-4 text-center text-[11px] leading-relaxed text-text-faint">
              Only on this device, for 30 days at a time. Don’t set one on a shared or public computer.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
