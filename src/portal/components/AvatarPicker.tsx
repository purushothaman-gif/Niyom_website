import { useRef, useState } from 'react';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import { ProfileService } from '../services/ProfileService';
import { ClientAvatar } from './ClientAvatar';

interface Props {
  clientId: string;
  clientCode: string;
  name: string;
  url: string | null | undefined;
  /** Called after a successful upload/removal so the caller can refresh. */
  onChanged: () => void;
  size?: number;
  /** Copy under the control. Onboarding and Settings frame this differently. */
  hint?: string;
}

/**
 * Set or remove a profile photo. Shared by the onboarding wizard and Profile →
 * Settings so a client meets the same control in both places.
 *
 * Optional everywhere it appears: a photo is decoration on a financial account,
 * and making it a step people have to clear would cost more onboardings than
 * it is worth.
 */
export function AvatarPicker({
  clientId,
  clientCode,
  name,
  url,
  onChanged,
  size = 72,
  hint,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /* Shown immediately from the chosen file so the new photo appears before the
     upload finishes and the parent refetches. */
  const [preview, setPreview] = useState<string | null>(null);

  const pick = async (file: File | null) => {
    if (!file) return;
    setError('');
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    const r = await ProfileService.uploadAvatar(clientId, clientCode, file);
    setBusy(false);
    if (!r.ok) {
      setPreview(null);
      setError(r.error || 'That upload did not go through. Please try again.');
      return;
    }
    onChanged();
  };

  const remove = async () => {
    setError('');
    setBusy(true);
    const r = await ProfileService.removeAvatar(clientId);
    setBusy(false);
    if (!r.ok) return setError(r.error || 'Could not remove the photo.');
    setPreview(null);
    onChanged();
  };

  const shown = preview ?? url ?? null;

  return (
    <div>
      <div className="flex items-center gap-4">
        <div className="relative">
          <ClientAvatar name={name} url={shown} size={size} />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            aria-label={shown ? 'Change profile photo' : 'Add a profile photo'}
            className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-bg-elevated text-text-secondary shadow-token-card transition-colors hover:text-accent disabled:opacity-60"
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Camera className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className="rounded-token-md border border-border bg-bg-surface px-3 py-1.5 text-xs font-semibold text-text-primary transition-colors hover:text-accent disabled:opacity-60"
            >
              {shown ? 'Change photo' : 'Add photo'}
            </button>
            {shown && (
              <button
                type="button"
                onClick={remove}
                disabled={busy}
                className="flex items-center gap-1.5 rounded-token-md border border-border px-3 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:text-danger-soft disabled:opacity-60"
              >
                <Trash2 className="h-3.5 w-3.5" /> Remove
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-text-faint">
            {hint ?? 'JPG, PNG or WEBP, up to 5 MB. Optional — your initials are used otherwise.'}
          </p>
        </div>
      </div>

      {error && <p className="mt-2 text-xs text-danger-soft">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          void pick(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
    </div>
  );
}
