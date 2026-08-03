import { useEffect, useRef, useState } from 'react';

interface Props {
  /** Fires once four digits are entered. */
  onComplete: (pin: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  /** Bump to clear the boxes — e.g. after a wrong PIN. */
  resetKey?: number;
  label?: string;
}

/**
 * Four-box PIN entry. One real input holds the value (so password managers,
 * paste and mobile keyboards behave); the boxes are presentation.
 *
 * `inputMode="numeric"` rather than `type="number"`: a numeric keypad on a
 * phone, without the spinner, scroll-to-change and locale quirks that come with
 * a number field.
 */
export function PinInput({ onComplete, disabled, autoFocus, resetKey = 0, label }: Props) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  /*
   * The callback is held in a ref so the completion effect depends on `value`
   * ALONE.
   *
   * It used to depend on `onComplete` too, and callers rebuild that closure on
   * every render — so the effect re-ran in the same commit that cleared the
   * boxes, still holding the old four digits, and fired a second time. The
   * caller saw one entry as two: the "enter it again to confirm" step was
   * consumed by the first entry confirming itself, and a mistyped PIN would
   * have been saved without the client ever seeing the second prompt.
   */
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    setValue('');
    if (autoFocus) inputRef.current?.focus();
  }, [resetKey, autoFocus]);

  useEffect(() => {
    if (value.length === 4) onCompleteRef.current(value);
  }, [value]);

  return (
    <div>
      {label && (
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {label}
        </p>
      )}
      <button
        type="button"
        onClick={() => inputRef.current?.focus()}
        disabled={disabled}
        className="flex w-full justify-center gap-3"
        aria-label={label ?? 'Enter your 4-digit PIN'}
      >
        {[0, 1, 2, 3].map((i) => {
          const filled = value.length > i;
          const active = value.length === i && !disabled;
          return (
            <span
              key={i}
              className="flex h-14 w-12 items-center justify-center rounded-xl text-2xl font-bold transition-colors"
              style={{
                background: 'var(--bg-surface)',
                border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                color: 'var(--text-primary)',
              }}
            >
              {filled ? '•' : ''}
            </span>
          );
        })}
      </button>

      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/\D/g, '').slice(0, 4))}
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={4}
        disabled={disabled}
        aria-label={label ?? 'PIN'}
        /* Off-screen rather than hidden: a display:none input cannot hold
           focus, and the mobile keyboard would never open. */
        className="absolute h-px w-px opacity-0"
        style={{ left: -9999 }}
        autoFocus={autoFocus}
      />
    </div>
  );
}
