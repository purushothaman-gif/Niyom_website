// A share-quantity control you can both TYPE into and step with − / +.
//
// Ordering 500 shares by pressing + five hundred times was the only option, so
// the number in the middle is now a real input. The − / + buttons still move by
// the lot step, from the minimum.
//
// The component deliberately does NOT correct what is typed. Silently turning
// "250" into "255" because of a lot rule would change an order the person
// thought they had placed; instead the parent checks the value with
// isValidQty() and says what is wrong. The one repair made here is on blur:
// an EMPTY box goes back to the minimum, because an empty quantity is not an
// order anyone meant to place.
//
// Used by the client portal, the partner order modal and the public offer page,
// so the three can never drift apart.

import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';

interface Props {
  value: number;
  onChange: (qty: number) => void;
  min: number;
  step: number;
  /** Larger variant for the public offer page. */
  size?: 'md' | 'lg';
  /** Caption under the number, e.g. "shares". */
  unitLabel?: string;
}

/** Nine digits is far beyond any real order and keeps the amount maths finite. */
const MAX_DIGITS = 9;

export function QuantityInput({ value, onChange, min, step, size = 'md', unitLabel }: Props) {
  // The box holds TEXT so it can be empty mid-edit; the parent holds the number.
  const [draft, setDraft] = useState(String(value));

  // Keep the box in step when − / + (or the parent) changes the value.
  useEffect(() => {
    setDraft((d) => (Number.parseInt(d, 10) === value ? d : String(value)));
  }, [value]);

  const type = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, MAX_DIGITS);
    setDraft(digits);
    // An empty box has no number yet — leave the parent's value alone until
    // there is one, rather than pushing 0 and flashing an error.
    if (digits !== '') onChange(Number.parseInt(digits, 10));
  };

  const commit = () => {
    if (draft === '' || Number.parseInt(draft, 10) === 0) {
      setDraft(String(min));
      onChange(min);
    }
  };

  const lg = size === 'lg';
  const btn = `flex ${lg ? 'h-9 w-9 rounded-token-md' : 'h-8 w-8 rounded-token-sm'} shrink-0 items-center justify-center border border-border bg-bg-elevated text-text-primary disabled:opacity-40`;
  const icon = lg ? 'h-4 w-4' : 'h-3.5 w-3.5';

  return (
    <div className={`flex items-center justify-between gap-2 border border-border bg-bg-surface ${lg ? 'rounded-token-lg p-2' : 'rounded-token-md p-1'}`}>
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - step))}
        disabled={value <= min}
        className={btn}
        aria-label="Decrease quantity"
      >
        <Minus className={icon} />
      </button>

      <div className="min-w-0 flex-1 text-center">
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          value={draft}
          onChange={(e) => type(e.target.value)}
          onBlur={commit}
          onFocus={(e) => e.target.select()}
          aria-label="Number of shares"
          className={`w-full bg-transparent text-center font-display font-bold tabular-nums text-text-primary outline-none ${lg ? 'text-2xl' : 'text-base'}`}
        />
        {unitLabel && <p className="text-[10px] text-text-faint">{unitLabel}</p>}
      </div>

      <button
        type="button"
        onClick={() => onChange(value + step)}
        className={btn}
        aria-label="Increase quantity"
      >
        <Plus className={icon} />
      </button>
    </div>
  );
}
